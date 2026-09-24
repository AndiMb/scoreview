<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Service\CompanionTokenException;
use OCA\ScoreView\Service\CompanionTokenService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IAppConfig;
use OCP\IConfig;
use OCP\Lock\ILockingProvider;
use OCP\Lock\LockedException;
use OCP\Security\ISecureRandom;
use PHPUnit\Framework\TestCase;

/**
 * Das Format der Begleit-Token (S1 in docs/architecture.md) und ihr Geheimnis. Was
 * die Middleware mit einem gueltigen Token anfaengt, steht in
 * DirectAccessMiddlewareTest.
 */
class CompanionTokenServiceTest extends TestCase {
	private string $gespeichert = '';
	/** @var list<array{string, bool, bool}> Wert, lazy, sensitive je Schreibzugriff */
	private array $geschrieben = [];
	private int $jetzt = 1_800_000_000;
	/** @var array<string, string> */
	private array $nutzerwerte = [];
	private int $zufall = 0;
	/** Laeuft beim frischen Lesen unter der Sperre - dort schreibt „ein anderer Prozess". */
	private ?\Closure $nebenlaeufig = null;

	private function dienst(?ILockingProvider $sperre = null): CompanionTokenService {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->method('getValueString')->willReturnCallback(function (string $app, string $key, string $default, bool $lazy) {
			$this->assertSame(Application::APP_ID, $app);
			$this->assertSame(CompanionTokenService::SECRET_KEY, $key);
			$this->assertTrue($lazy, 'lazy: nicht bei jedem Seitenaufruf laden');
			return $this->gespeichert;
		});
		$appConfig->method('clearCache')->willReturnCallback(function (): void {
			if ($this->nebenlaeufig !== null) {
				($this->nebenlaeufig)();
			}
		});
		$appConfig->method('setValueString')->willReturnCallback(function (string $app, string $key, string $value, bool $lazy, bool $sensitive) {
			$this->gespeichert = $value;
			$this->geschrieben[] = [$value, $lazy, $sensitive];
			return true;
		});
		$config = $this->createMock(IConfig::class);
		$config->method('getUserValue')->willReturnCallback(fn (string $uid, string $app, string $key, $default) => $this->nutzerwerte["$uid/$key"] ?? $default);
		$config->method('setUserValue')->willReturnCallback(function (string $uid, string $app, string $key, string $value): void {
			$this->nutzerwerte["$uid/$key"] = $value;
		});
		$random = $this->createMock(ISecureRandom::class);
		$random->method('generate')->willReturnCallback(function (int $laenge, string $zeichen) {
			$this->zufall++;
			$this->assertSame(64, $laenge);
			$this->assertSame('0123456789abcdef', $zeichen);
			return str_repeat(dechex($this->zufall % 16), 64);
		});
		$zeit = $this->createMock(ITimeFactory::class);
		$zeit->method('getTime')->willReturnCallback(fn () => $this->jetzt);
		return new CompanionTokenService($appConfig, $config, $random, $zeit, $sperre);
	}

	private function ausgeben(CompanionTokenService $dienst, int $fileId = 43, string $zweck = CompanionTokenService::PURPOSE_SCORE): string {
		return $dienst->issue('anna', $fileId, $zweck, CompanionTokenService::digest('de-token'));
	}

	public function testRundreise(): void {
		$dienst = $this->dienst();
		$token = $this->ausgeben($dienst, 43, CompanionTokenService::PURPOSE_SETLIST);

		$this->assertMatchesRegularExpression('/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/', $token);
		$this->assertSame([
			'uid' => 'anna',
			'fid' => 43,
			'purpose' => 'setlist',
			'exp' => $this->jetzt + 43200,
			'dt' => CompanionTokenService::digest('de-token'),
			'ep' => 0,
		], $dienst->verify($token));
	}

	/** Das Direct-Editing-Token selbst steht nie im Begleiter - nur sein gekuerzter Fingerabdruck. */
	public function testEnthaeltDasDirectEditingTokenNicht(): void {
		$token = $this->ausgeben($this->dienst());
		$inhalt = base64_decode(strtr(explode('.', $token)[1], '-_', '+/'));

		$this->assertStringNotContainsString('de-token', $inhalt);
		$this->assertSame(32, strlen(CompanionTokenService::digest('de-token')));
		$this->assertSame(substr(hash('sha256', 'de-token'), 0, 32), CompanionTokenService::digest('de-token'));
	}

	/**
	 * Signiert wird mit Domaenentrennung: Ein HMAC ueber den blossen Inhalt
	 * - ohne das Praefix - gilt nicht.
	 */
	public function testSignaturMitDomaenentrennung(): void {
		$dienst = $this->dienst();
		$token = $this->ausgeben($dienst);
		[, $inhalt] = explode('.', $token);
		$ohnePraefix = rtrim(strtr(base64_encode(hash_hmac('sha256', $inhalt, (string)hex2bin($this->gespeichert), true)), '+/', '-_'), '=');
		$mitPraefix = rtrim(strtr(base64_encode(hash_hmac('sha256', 'scoreview-companion-v1|' . $inhalt, (string)hex2bin($this->gespeichert), true)), '+/', '-_'), '=');

		$this->assertSame("v1.$inhalt.$mitPraefix", $token);
		$this->expectExceptionObject(new CompanionTokenException(CompanionTokenException::SIGNATURE));
		$dienst->verify("v1.$inhalt.$ohnePraefix");
	}

	public function testGeheimnisEntstehtBeimErstenGebrauchSensitivUndLazy(): void {
		$dienst = $this->dienst();
		$this->ausgeben($dienst);
		$this->ausgeben($dienst);

		$this->assertCount(1, $this->geschrieben, 'nur einmal erzeugt');
		[$wert, $lazy, $sensitive] = $this->geschrieben[0];
		$this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $wert, '32 Byte, hexadezimal');
		$this->assertTrue($lazy);
		$this->assertTrue($sensitive);
	}

	/** Ein von Hand gesetztes, zu kurzes Geheimnis waere schlimmer als ein neues. */
	public function testSchwachesGeheimnisWirdErsetzt(): void {
		$this->gespeichert = 'geheim';
		$this->ausgeben($this->dienst());

		$this->assertCount(1, $this->geschrieben);
		$this->assertNotSame('geheim', $this->gespeichert);
	}

	/** Widerruf per occ: Nach dem Loeschen entsteht ein neues Geheimnis, alte Token gelten nicht. */
	public function testNeuesGeheimnisWiderruftAlleToken(): void {
		$alt = $this->ausgeben($this->dienst());
		$this->gespeichert = '';

		$this->expectExceptionObject(new CompanionTokenException(CompanionTokenException::SIGNATURE));
		$this->dienst()->verify($alt);
	}

	public function testAblaufNachZwoelfStunden(): void {
		$dienst = $this->dienst();
		$token = $this->ausgeben($dienst);

		$this->jetzt += 43199;
		$this->assertSame(43, $dienst->verify($token)['fid']);

		$this->jetzt += 1;
		$this->expectExceptionObject(new CompanionTokenException(CompanionTokenException::EXPIRED));
		$dienst->verify($token);
	}

	/** Einen Ablauf weiter als 12 h stellt der Server nie aus - auch nicht, wenn die Signatur passt. */
	public function testZuLangeLaufzeitGiltNicht(): void {
		$dienst = $this->dienst();
		$this->jetzt += 3600;
		$token = $this->ausgeben($dienst);
		$this->jetzt -= 3600;

		$this->expectExceptionObject(new CompanionTokenException(CompanionTokenException::EXPIRED));
		$dienst->verify($token);
	}

	public function testUnbrauchbarerAufbau(): void {
		$dienst = $this->dienst();
		$echt = $this->ausgeben($dienst);
		[, $inhalt, $mac] = explode('.', $echt);
		$faelle = [
			'leer' => '',
			'zwei Teile' => "v1.$inhalt",
			'vier Teile' => "$echt.x",
			'andere Fassung' => "v0.$inhalt.$mac",
			'fremde Zeichen im Inhalt' => "v1.$inhalt+.$mac",
			'Signatur zu kurz' => "v1.$inhalt." . substr($mac, 1),
			'zu lang' => 'v1.' . str_repeat('A', CompanionTokenService::MAX_TOKEN_LENGTH) . '.' . $mac,
			'Inhalt zu lang' => 'v1.' . str_repeat('A', CompanionTokenService::MAX_PAYLOAD_LENGTH + 1) . '.' . $mac,
		];
		foreach ($faelle as $fall => $token) {
			try {
				$dienst->verify($token);
				$this->fail($fall);
			} catch (CompanionTokenException $e) {
				$this->assertSame(CompanionTokenException::MALFORMED, $e->getReason(), $fall);
			}
		}
	}

	/**
	 * Auch ein korrekt signierter Inhalt wird auf Typen geprueft - eine
	 * spaetere Fassung, die anders kodiert, soll nicht halb verstanden werden.
	 */
	public function testSigniertAberFalscheTypen(): void {
		$dienst = $this->dienst();
		$this->ausgeben($dienst);
		$schluessel = (string)hex2bin($this->gespeichert);
		$gueltig = ['uid' => 'anna', 'fid' => 43, 'purpose' => 'score', 'exp' => $this->jetzt + 60, 'dt' => str_repeat('a', 32), 'ep' => 0];
		$faelle = [
			'fid als Text' => ['fid' => '43'] + $gueltig,
			'fid null' => ['fid' => 0] + $gueltig,
			'Zweck unbekannt' => ['purpose' => 'admin'] + $gueltig,
			'uid leer' => ['uid' => ''] + $gueltig,
			'dt zu kurz' => ['dt' => 'abc'] + $gueltig,
			'ep fehlt' => array_diff_key($gueltig, ['ep' => true]),
			'verschachtelt' => ['uid' => ['anna']] + $gueltig,
		];
		foreach ($faelle as $fall => $claims) {
			$inhalt = rtrim(strtr(base64_encode(json_encode($claims)), '+/', '-_'), '=');
			$mac = rtrim(strtr(base64_encode(hash_hmac('sha256', 'scoreview-companion-v1|' . $inhalt, $schluessel, true)), '+/', '-_'), '=');
			try {
				$dienst->verify("v1.$inhalt.$mac");
				$this->fail($fall);
			} catch (CompanionTokenException $e) {
				$this->assertSame(CompanionTokenException::MALFORMED, $e->getReason(), $fall);
			}
		}
	}

	public function testEpocheSteigt(): void {
		$dienst = $this->dienst();
		$this->assertSame(0, $dienst->epoch('anna'));

		$dienst->bumpEpoch('anna');
		$dienst->bumpEpoch('anna');

		$this->assertSame(2, $dienst->epoch('anna'));
		$this->assertSame(0, $dienst->epoch('bert'), 'je Nutzerin');
		$this->assertSame(2, $dienst->verify($this->ausgeben($dienst))['ep']);
	}

	public function testUnbekannterZweckWirdNichtAusgegeben(): void {
		$this->expectException(\InvalidArgumentException::class);
		$this->dienst()->issue('anna', 1, 'alles', str_repeat('a', 32));
	}

	public function testRepairStepLegtDasGeheimnisEinmalAn(): void {
		$dienst = $this->dienst();

		$this->assertTrue($dienst->ensureSecret());
		$this->assertFalse($this->dienst()->ensureSecret(), 'ein Update widerruft keine laufenden Token');
		$this->assertCount(1, $this->geschrieben);
	}

	public function testUnterDerSperreGewinntDasSchonGeschriebene(): void {
		// Ein anderer Prozess hat das Geheimnis angelegt, waehrend dieser auf
		// die Sperre wartete: Er uebernimmt es, statt es zu ueberschreiben.
		$fremd = str_repeat('c', 64);
		$this->nebenlaeufig = function () use ($fremd): void {
			$this->gespeichert = $fremd;
		};
		$gesperrt = [];
		$sperre = $this->createMock(ILockingProvider::class);
		$sperre->method('acquireLock')->willReturnCallback(function (string $pfad, int $art) use (&$gesperrt): void {
			$gesperrt[] = ['an', $pfad, $art];
		});
		$sperre->method('releaseLock')->willReturnCallback(function (string $pfad, int $art) use (&$gesperrt): void {
			$gesperrt[] = ['ab', $pfad, $art];
		});
		$dienst = $this->dienst($sperre);

		$token = $this->ausgeben($dienst);

		$this->assertSame([], $this->geschrieben);
		$this->assertSame(['an', 'ab'], array_column($gesperrt, 0));
		$this->assertSame(ILockingProvider::LOCK_EXCLUSIVE, $gesperrt[0][2]);
		$this->nebenlaeufig = null;
		$this->assertSame('anna', $this->dienst()->verify($token)['uid'], 'mit dem fremden Geheimnis signiert');
	}

	public function testOhneSperreTrotzdemEinGeheimnis(): void {
		$sperre = $this->createMock(ILockingProvider::class);
		$sperre->method('acquireLock')->willThrowException(new LockedException('scoreview/companion_secret'));
		$sperre->expects($this->never())->method('releaseLock');

		$this->ausgeben($this->dienst($sperre));

		$this->assertCount(1, $this->geschrieben);
	}
}
