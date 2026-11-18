<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Service\ClientFallback;
use OCA\ScoreView\Service\ConversionBackend;
use OCA\ScoreView\Service\LocalConverter;
use OCA\ScoreView\Service\SidecarClient;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IAppConfig;
use OCP\ICache;
use OCP\ICacheFactory;
use OCP\IMemcache;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Die eine Stelle, die entscheidet, ob der Browser konvertieren muss.
 *
 * Zwei Eigenschaften sind hier wichtiger als die reine Wahrheitstabelle:
 *
 * 1. **Was NICHT ausloest.** Ein Rueckfall bei einer kaputten Partitur waere
 *    kein Rueckfall, sondern ein zweiter, langsamerer Fehlschlag - mit
 *    derselben Engine, nur 14 MB spaeter.
 * 2. **Dass die teure Pruefung wirklich selten laeuft.** `describe()` startet
 *    einen Prozess, `checkHealth()` macht eine HTTP-Anfrage, und gefragt wird
 *    aus dem Statusendpunkt, den der Viewer im Sekundentakt pollt. Ein
 *    kaputter Cache faellt im Betrieb nicht als Fehler auf, sondern als Last -
 *    deshalb steht er hier als Zusicherung.
 */
class ClientFallbackTest extends TestCase {
	private const JETZT = 1_700_000_000;

	/** @var array<string, string> */
	private array $gespeichert = [];

	private function appConfig(): IAppConfig {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->method('getValueString')
			->willReturnCallback(fn (string $app, string $key, string $default = '') => $this->gespeichert[$key] ?? $default);
		$appConfig->method('getValueInt')
			->willReturnCallback(fn (string $app, string $key, int $default = 0) => (int)($this->gespeichert[$key] ?? $default));
		$appConfig->method('setValueString')
			->willReturnCallback(function (string $app, string $key, string $wert) {
				$this->gespeichert[$key] = $wert;
				return true;
			});
		$appConfig->method('setValueInt')
			->willReturnCallback(function (string $app, string $key, int $wert) {
				$this->gespeichert[$key] = (string)$wert;
				return true;
			});
		$appConfig->method('deleteKey')
			->willReturnCallback(function (string $app, string $key): void {
				unset($this->gespeichert[$key]);
			});
		return $appConfig;
	}

	private function fallback(
		string $backend = ConversionBackend::LOCAL,
		bool $lokalVerfuegbar = true,
		bool $sidecarErreichbar = true,
		?LocalConverter $lokal = null,
		?SidecarClient $sidecar = null,
		int $jetzt = self::JETZT,
		?ICache $cache = null,
	): ClientFallback {
		$conversionBackend = $this->createMock(ConversionBackend::class);
		$conversionBackend->method('isLocal')->willReturn($backend === ConversionBackend::LOCAL);

		if ($lokal === null) {
			$lokal = $this->createMock(LocalConverter::class);
			$lokal->method('describe')->willReturn(['available' => $lokalVerfuegbar]);
		}
		if ($sidecar === null) {
			$sidecar = $this->createMock(SidecarClient::class);
			$sidecar->method('checkHealth')->willReturn(['reachable' => $sidecarErreichbar]);
		}

		$time = $this->createMock(ITimeFactory::class);
		$time->method('getTime')->willReturn($jetzt);

		$cacheFactory = $this->createMock(ICacheFactory::class);
		$cacheFactory->method('isAvailable')->willReturn($cache !== null);
		$cacheFactory->method('createDistributed')->willReturn($cache ?? $this->createMock(ICache::class));

		return new ClientFallback($this->appConfig(), $conversionBackend, $lokal, $sidecar, $time, $cacheFactory);
	}

	/** @param array<string, mixed> $eintraege */
	private function cache(array &$eintraege): ICache {
		$cache = $this->createMock(ICache::class);
		$cache->method('get')->willReturnCallback(function (string $key) use (&$eintraege) {
			return $eintraege[$key] ?? null;
		});
		$cache->method('set')->willReturnCallback(function (string $key, mixed $value) use (&$eintraege) {
			$eintraege[$key] = $value;
			return true;
		});
		$cache->method('remove')->willReturnCallback(function (string $key) use (&$eintraege) {
			unset($eintraege[$key]);
			return true;
		});
		return $cache;
	}

	public function testWithADistributedCacheTheVerdictLeavesTheAppConfigAlone(): void {
		$eintraege = [];
		$lokal = $this->createMock(LocalConverter::class);
		$lokal->expects($this->once())->method('describe')->willReturn(['available' => false]);
		$fallback = $this->fallback(lokal: $lokal, cache: $this->cache($eintraege));

		$this->assertSame(ScoreConversion::ERROR_LOCAL_UNAVAILABLE, $fallback->reason());
		// Asked again: from the cache, without a second process start.
		$this->assertSame(ScoreConversion::ERROR_LOCAL_UNAVAILABLE, $fallback->reason());
		$this->assertSame([], $this->gespeichert, 'no IAppConfig write, which would invalidate its cache instance-wide');
		$this->assertSame([ScoreConversion::ERROR_LOCAL_UNAVAILABLE, self::JETZT], $eintraege['verdict']);
	}

	/** A memcache with an atomic add() - the refresh lock (issue #64). */
	private function memcache(array &$eintraege): IMemcache {
		$cache = $this->createMock(IMemcache::class);
		$cache->method('get')->willReturnCallback(function (string $key) use (&$eintraege) {
			return $eintraege[$key] ?? null;
		});
		$cache->method('set')->willReturnCallback(function (string $key, mixed $value) use (&$eintraege) {
			$eintraege[$key] = $value;
			return true;
		});
		$cache->method('add')->willReturnCallback(function (string $key, mixed $value) use (&$eintraege) {
			if (array_key_exists($key, $eintraege)) {
				return false;
			}
			$eintraege[$key] = $value;
			return true;
		});
		$cache->method('remove')->willReturnCallback(function (string $key) use (&$eintraege) {
			unset($eintraege[$key]);
			return true;
		});
		return $cache;
	}

	/**
	 * An expired verdict is renewed by one process, not by every viewer that
	 * polls at that moment: whoever finds the lock taken answers with the
	 * old one instead of starting a check of its own.
	 */
	public function testWhileAnotherProcessRenewsTheOldVerdictAnswers(): void {
		$eintraege = ['verdict' => [ScoreConversion::ERROR_LOCAL_UNAVAILABLE, self::JETZT - 301], 'refresh' => 1];
		$lokal = $this->createMock(LocalConverter::class);
		$lokal->expects($this->never())->method('describe');

		$this->assertSame(ScoreConversion::ERROR_LOCAL_UNAVAILABLE, $this->fallback(lokal: $lokal, cache: $this->memcache($eintraege))->reason());
	}

	public function testTheLockHolderRenewsAnExpiredVerdict(): void {
		$eintraege = ['verdict' => [ScoreConversion::ERROR_LOCAL_UNAVAILABLE, self::JETZT - 301]];
		$lokal = $this->createMock(LocalConverter::class);
		$lokal->expects($this->once())->method('describe')->willReturn(['available' => true]);
		$cache = $this->memcache($eintraege);

		$this->assertNull($this->fallback(lokal: $lokal, cache: $cache)->reason());
		// The next process finds the renewed verdict, fresh again.
		$this->assertNull($this->fallback(lokal: $lokal, cache: $cache)->reason());
		$this->assertSame([null, self::JETZT], [$this->fallback(lokal: $lokal, cache: $cache)->reason(), $eintraege['verdict'][1]]);
	}

	public function testWithoutAStoredVerdictEveryoneChecks(): void {
		$eintraege = ['refresh' => 1];
		$lokal = $this->createMock(LocalConverter::class);
		$lokal->expects($this->once())->method('describe')->willReturn(['available' => false]);

		// Even with the lock taken: there is nothing old to answer with.
		$this->assertSame(ScoreConversion::ERROR_LOCAL_UNAVAILABLE, $this->fallback(lokal: $lokal, cache: $this->memcache($eintraege))->reason());
	}

	public function testTheCacheKeepsAVerdictBeyondItsFreshness(): void {
		$ttl = null;
		$cache = $this->createMock(IMemcache::class);
		$cache->method('set')->willReturnCallback(function (string $key, mixed $value, int $seconds) use (&$ttl) {
			$ttl = $seconds;
			return true;
		});
		$this->fallback(cache: $cache)->reason();

		$this->assertGreaterThan(300, $ttl, 'an expired verdict must still be there to answer with');
	}

	public function testForgetClearsTheCachedVerdict(): void {
		$eintraege = ['verdict' => [ScoreConversion::ERROR_LOCAL_UNAVAILABLE, self::JETZT]];
		$fallback = $this->fallback(lokalVerfuegbar: true, cache: $this->cache($eintraege));

		$fallback->forget();

		$this->assertNull($fallback->reason());
	}

	public function testLaesstDenServerArbeitenWennErKann(): void {
		$fallback = $this->fallback(lokalVerfuegbar: true);
		$this->assertFalse($fallback->applies());
		$this->assertNull($fallback->reason());
	}

	public function testSchicktDenBrowserRanWennKeineNodeLaufzeitDaIst(): void {
		$fallback = $this->fallback(lokalVerfuegbar: false);
		$this->assertTrue($fallback->applies());
		// Als Code, nicht als Satz: uebersetzt wird erst im Browser (E4).
		$this->assertSame(ScoreConversion::ERROR_LOCAL_UNAVAILABLE, $fallback->reason());
	}

	public function testFragtAufDemSidecarWegDenSidecarUndNichtDieNodeLaufzeit(): void {
		// Ein Server ohne node ist auf dem Sidecar-Weg vollkommen in Ordnung -
		// wuerde hier trotzdem `describe()` befragt, faende der Rueckfall auf
		// jeder Sidecar-Instanz ohne Node-Laufzeit statt.
		$lokal = $this->createMock(LocalConverter::class);
		$lokal->expects($this->never())->method('describe');

		$fallback = $this->fallback(backend: ConversionBackend::SIDECAR, lokal: $lokal, sidecarErreichbar: true);
		$this->assertFalse($fallback->applies());
	}

	public function testSchicktDenBrowserRanWennDerSidecarNichtAntwortet(): void {
		$fallback = $this->fallback(backend: ConversionBackend::SIDECAR, sidecarErreichbar: false);
		$this->assertSame(ScoreConversion::ERROR_SIDECAR_UNREACHABLE, $fallback->reason());
	}

	public function testErhebtDasUrteilNurEinmalInnerhalbDerFrist(): void {
		$lokal = $this->createMock(LocalConverter::class);
		$lokal->expects($this->once())->method('describe')->willReturn(['available' => true]);

		$fallback = $this->fallback(lokal: $lokal);
		$fallback->applies();
		$fallback->applies();
		$fallback->reason();
	}

	public function testErhebtDasUrteilNachAblaufNeu(): void {
		$this->gespeichert = [
			ClientFallback::CONFIG_VERDICT => ScoreConversion::ERROR_LOCAL_UNAVAILABLE,
			ClientFallback::CONFIG_VERDICT_AT => (string)(self::JETZT - 301),
		];
		// Inzwischen wurde node nachinstalliert - ohne Neuerhebung bliebe die
		// Instanz auf dem Rueckfall stehen, obwohl sie laengst selbst kann.
		$this->assertFalse($this->fallback(lokalVerfuegbar: true)->applies());
	}

	public function testHaeltSichAnEinFrischesGespeichertesUrteil(): void {
		$this->gespeichert = [
			ClientFallback::CONFIG_VERDICT => ScoreConversion::ERROR_SIDECAR_UNREACHABLE,
			ClientFallback::CONFIG_VERDICT_AT => (string)(self::JETZT - 1),
		];
		$this->assertSame(ScoreConversion::ERROR_SIDECAR_UNREACHABLE, $this->fallback()->reason());
	}

	public function testNimmtEinenInfrastrukturfehlerAlsUrteil(): void {
		$fallback = $this->fallback(lokalVerfuegbar: true);
		$this->assertFalse($fallback->applies());

		$this->assertTrue($fallback->noteConversionError(ScoreConversion::ERROR_SIDECAR_UNREACHABLE));
		$this->assertSame(ScoreConversion::ERROR_SIDECAR_UNREACHABLE, $fallback->reason());
	}

	/**
	 * Der Kern der Entscheidung: Eine Partitur, die der Server nicht setzen
	 * konnte, setzt der Browser auch nicht - er hat dieselbe Engine.
	 */
	#[DataProvider('inhaltsfehler')]
	public function testIgnoriertFehlerDerPartitur(?string $code): void {
		$fallback = $this->fallback(lokalVerfuegbar: true);
		$this->assertFalse($fallback->noteConversionError($code));
		$this->assertFalse($fallback->applies());
	}

	/** @return array<string, array{0: ?string}> */
	public static function inhaltsfehler(): array {
		return [
			'kaputte Partitur' => [ScoreConversion::ERROR_CONVERSION_FAILED],
			'keine Seiten' => [ScoreConversion::ERROR_NO_PAGES],
			'zu gross' => [ScoreConversion::ERROR_TOO_LARGE],
			'Zeitgrenze' => [ScoreConversion::ERROR_TIMEOUT],
			'unbekannt' => [ScoreConversion::ERROR_UNKNOWN],
			// Ausgelastet ist nicht kaputt: Ein Stapel-Upload ueber die
			// Warteschlange hinaus darf nicht alle auf den Browser schicken.
			'Sidecar ausgelastet' => [ScoreConversion::ERROR_SIDECAR_BUSY],
			'gar keiner' => [null],
		];
	}

	public function testVergisstDasUrteilAufVerlangen(): void {
		$this->gespeichert = [
			ClientFallback::CONFIG_VERDICT => ScoreConversion::ERROR_LOCAL_UNAVAILABLE,
			ClientFallback::CONFIG_VERDICT_AT => (string)self::JETZT,
		];
		$this->fallback()->forget();
		$this->assertSame([], $this->gespeichert);
	}
}
