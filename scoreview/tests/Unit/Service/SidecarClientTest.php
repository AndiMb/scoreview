<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

require_once __DIR__ . '/../../stubs/GuzzleServerException.php';
require_once __DIR__ . '/../../stubs/GuzzleClientException.php';

use GuzzleHttp\Exception\ClientException;
use GuzzleHttp\Exception\ServerException;
use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Db\ScoreVariant;
use OCA\ScoreView\Service\ConversionBackend;
use OCA\ScoreView\Service\SidecarBusyException;
use OCA\ScoreView\Service\SidecarClient;
use OCA\ScoreView\Service\SidecarException;
use OCP\Http\Client\IClient;
use OCP\Http\Client\IClientService;
use OCP\Http\Client\IResponse;
use OCP\IAppConfig;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Wie das Einreichen ein 5xx des Sidecars einordnet. Der Unterschied ist
 * folgenreich: "nicht erreichbar" schaltet ueber ClientFallback fuer alle
 * auf den Browser um, "ausgelastet" (503, volle Warteschlange) soll nur zu
 * einem spaeteren Neuversuch fuehren.
 */
class SidecarClientTest extends TestCase {
	private function client(\Throwable $fehler): SidecarClient {
		$http = $this->createMock(IClient::class);
		$http->method('post')->willThrowException($fehler);
		$service = $this->createMock(IClientService::class);
		$service->method('newClient')->willReturn($http);
		$config = $this->createMock(IAppConfig::class);
		$config->method('getValueString')->willReturnCallback(
			static fn (string $app, string $key) => ['sidecar_url' => 'http://sidecar:8765', 'sidecar_secret' => 'geheim'][$key] ?? '',
		);
		return new SidecarClient($service, $config);
	}

	private function einreichen(SidecarClient $client): SidecarException {
		try {
			$client->submitConversion(fopen('php://memory', 'rb'), 'probe.mscz');
		} catch (SidecarException $e) {
			return $e;
		}
		$this->fail('SidecarException erwartet');
	}

	public function testVolleWarteschlangeIstAusgelastetMitWartezeit(): void {
		$e = $this->einreichen($this->client(new ServerException(503, ['Retry-After' => '45'])));

		$this->assertInstanceOf(SidecarBusyException::class, $e);
		$this->assertSame(ScoreConversion::ERROR_SIDECAR_BUSY, $e->getErrorCode());
		$this->assertSame(45, $e->getRetryAfterSeconds());
	}

	public function testAnderes5xxBleibtNichtErreichbar(): void {
		$e = $this->einreichen($this->client(new ServerException(500)));

		$this->assertNotInstanceOf(SidecarBusyException::class, $e);
		$this->assertSame(ScoreConversion::ERROR_SIDECAR_UNREACHABLE, $e->getErrorCode());
	}

	/**
	 * @return array<string, array{string, int}>
	 */
	public static function kopfzeilen(): array {
		return [
			'Zahl' => ['30', 30],
			'mit Leerraum' => [' 12 ', 12],
			'fehlt' => ['', 30],
			'HTTP-Datum' => ['Wed, 21 Oct 2026 07:28:00 GMT', 30],
			'negativ' => ['-5', 30],
		];
	}

	#[DataProvider('kopfzeilen')]
	public function testLiestRetryAfter(string $kopf, int $sekunden): void {
		$this->assertSame($sekunden, SidecarClient::retryAfterSeconds($kopf));
	}

	/**
	 * A client whose HTTP calls answer from $antworten (URL → body) and are
	 * recorded in $this->anfragen.
	 *
	 * @param array<string, string> $antworten
	 */
	private function antwortender(array $antworten, ?\Throwable $postFehler = null): SidecarClient {
		$this->anfragen = [];
		$antwort = function (string $url) use ($antworten): IResponse {
			$response = $this->createMock(IResponse::class);
			$response->method('getBody')->willReturn($antworten[$url] ?? '');
			return $response;
		};
		$http = $this->createMock(IClient::class);
		$http->method('post')->willReturnCallback(function (string $url, array $options) use ($antwort, $postFehler) {
			$this->anfragen[] = ['POST', $url, $options];
			if ($postFehler !== null) {
				throw $postFehler;
			}
			return $antwort($url);
		});
		$http->method('get')->willReturnCallback(function (string $url, array $options = []) use ($antwort) {
			$this->anfragen[] = ['GET', $url, $options];
			return $antwort($url);
		});
		$service = $this->createMock(IClientService::class);
		$service->method('newClient')->willReturn($http);
		$config = $this->createMock(IAppConfig::class);
		$config->method('getValueString')->willReturnCallback(
			static fn (string $app, string $key) => ['sidecar_url' => 'http://sidecar:8765', 'sidecar_secret' => 'geheim'][$key] ?? '',
		);
		return new SidecarClient($service, $config);
	}

	/** @var list<array{string, string, array}> */
	private array $anfragen = [];

	public function testReichtDenRendererMitEin(): void {
		$client = $this->antwortender(['http://sidecar:8765/convert' => '{"jobId":"j1","renderer":"musescore"}']);

		$this->assertSame('j1', $client->submitConversion(fopen('php://memory', 'rb'), 'probe.mscz', ConversionBackend::RENDERER_MUSESCORE));

		$felder = array_column($this->anfragen[0][2]['multipart'], 'contents', 'name');
		$this->assertSame('musescore', $felder['renderer']);
	}

	public function testSelbsttestFragtDenGewaehltenRenderer(): void {
		$client = $this->antwortender(['http://sidecar:8765/selftest?renderer=engine' => '{"ok":true,"renderer":"engine","details":{}}']);

		$this->assertTrue($client->runSelfTest(ConversionBackend::RENDERER_ENGINE)['ok']);
	}

	public function testSelbsttestErkenntEinZuAltesImage(): void {
		// An image from before the renderer choice ignores the parameter and
		// answers for MuseScore, without naming a renderer. A green self-test
		// there would hide that the setting has no effect.
		$client = $this->antwortender(['http://sidecar:8765/selftest?renderer=engine' => '{"ok":true,"details":{}}']);

		$ergebnis = $client->runSelfTest(ConversionBackend::RENDERER_ENGINE);

		$this->assertFalse($ergebnis['ok']);
		$this->assertStringContainsString('Rebuild the image', $ergebnis['error']);
	}

	public function testVarianteHoltSeitenUndMetaUeberDieArtefaktroute(): void {
		$client = $this->antwortender([
			'http://sidecar:8765/variant' => json_encode([
				'status' => 'ready',
				'engine' => '4.7.5-engine.6',
				'files' => [
					'pages' => ['/convert/v1/artifact/page-1', '/convert/v1/artifact/page-2'],
					'timingJson' => '/convert/v1/artifact/timing',
					'measuresJson' => '/convert/v1/artifact/measures',
					'metaJson' => '/convert/v1/artifact/meta',
				],
			]),
			'http://sidecar:8765/convert/v1/artifact/page-1' => '<svg>1</svg>',
			'http://sidecar:8765/convert/v1/artifact/page-2' => '<svg>2</svg>',
			'http://sidecar:8765/convert/v1/artifact/timing' => 'T',
			'http://sidecar:8765/convert/v1/artifact/measures' => 'M',
			'http://sidecar:8765/convert/v1/artifact/meta' => '{}',
		]);

		$ergebnis = $client->convertVariant(fopen('php://memory', 'rb'), 'probe.mscz', 'ex1~orig~w~0', '{"t":1}', '{"m":1}');

		$this->assertSame(['pages' => ['<svg>1</svg>', '<svg>2</svg>'], 'timing' => 'T', 'measures' => 'M', 'meta' => '{}', 'engine' => '4.7.5-engine.6'], $ergebnis);
		$felder = array_column($this->anfragen[0][2]['multipart'], 'contents', 'name');
		$this->assertSame('ex1~orig~w~0', $felder['key']);
		$this->assertSame('{"t":1}', $felder['timing']);
		$this->assertSame('{"m":1}', $felder['measures']);
	}

	public function testVarianteDieImSidecarScheitertIstEinKonvertierungsfehler(): void {
		$client = $this->antwortender(['http://sidecar:8765/variant' => '{"status":"error","error":"fails its invariants"}']);
		try {
			$client->convertVariant(fopen('php://memory', 'rb'), 'probe.mscz', 'ex1~orig~w~0', '{}', '{}');
			$this->fail('SidecarException erwartet');
		} catch (SidecarException $e) {
			$this->assertSame(ScoreConversion::ERROR_CONVERSION_FAILED, $e->getErrorCode());
			$this->assertStringContainsString('fails its invariants', $e->getMessage());
		}
	}

	public function testEineVarianteOhneSeitenTraegtDenCodeDesSidecars(): void {
		// The same code as on the local path and for a base conversion (E3).
		$client = $this->antwortender(['http://sidecar:8765/variant' => '{"status":"error","error":"the engine returned no SVG page","errorCode":"no_pages"}']);
		try {
			$client->convertVariant(fopen('php://memory', 'rb'), 'probe.mscz', 'ex1~orig~w~0', '{}', '{}');
			$this->fail('SidecarException erwartet');
		} catch (SidecarException $e) {
			$this->assertSame(ScoreConversion::ERROR_NO_PAGES, $e->getErrorCode());
		}
	}

	public function testNimmtNurCodesDerPartiturVomSidecar(): void {
		$this->assertSame(ScoreConversion::ERROR_NO_PAGES, SidecarClient::jobErrorCode('no_pages'));
		$this->assertSame(ScoreConversion::ERROR_TIMEOUT, SidecarClient::jobErrorCode('timeout'));
		$this->assertSame(ScoreConversion::ERROR_CONVERSION_FAILED, SidecarClient::jobErrorCode(null));
		$this->assertSame(ScoreConversion::ERROR_CONVERSION_FAILED, SidecarClient::jobErrorCode(ScoreConversion::ERROR_LOCAL_UNAVAILABLE));
		$this->assertSame(ScoreConversion::ERROR_CONVERSION_FAILED, SidecarClient::jobErrorCode(['no_pages']));
	}

	/** @return array<string, array{\Throwable, string}> */
	public static function variantenFehler(): array {
		return [
			// No /variant route: an image from before the engine renderer.
			'404' => [new ClientException(404), ScoreVariant::ERROR_UNSUPPORTED],
			'401' => [new ClientException(401), ScoreConversion::ERROR_SIDECAR_REJECTED],
			'503' => [new ServerException(503), ScoreConversion::ERROR_SIDECAR_BUSY],
			'500' => [new ServerException(500), ScoreConversion::ERROR_SIDECAR_UNREACHABLE],
		];
	}

	#[DataProvider('variantenFehler')]
	public function testOrdnetFehlerDerVarianteEin(\Throwable $fehler, string $code): void {
		$client = $this->antwortender([], $fehler);
		try {
			$client->convertVariant(fopen('php://memory', 'rb'), 'probe.mscz', 'ex1~orig~w~0', '{}', '{}');
			$this->fail('SidecarException erwartet');
		} catch (SidecarException $e) {
			$this->assertSame($code, $e->getErrorCode());
		}
	}
}
