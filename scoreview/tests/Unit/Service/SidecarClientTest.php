<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

require_once __DIR__ . '/../../stubs/GuzzleServerException.php';

use GuzzleHttp\Exception\ServerException;
use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Service\SidecarBusyException;
use OCA\ScoreView\Service\SidecarClient;
use OCA\ScoreView\Service\SidecarException;
use OCP\Http\Client\IClient;
use OCP\Http\Client\IClientService;
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
}
