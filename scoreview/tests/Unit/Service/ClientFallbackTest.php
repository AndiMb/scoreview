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

		return new ClientFallback($this->appConfig(), $conversionBackend, $lokal, $sidecar, $time);
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
	 *
	 * @dataProvider inhaltsfehler
	 */
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
