<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Controller;

use OCA\ScoreView\Controller\SoundFontController;
use OCA\ScoreView\Service\ConverterException;
use OCA\ScoreView\Service\SidecarException;
use OCA\ScoreView\Service\SoundFontService;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * Die Zusage dieses Controllers: eine nicht beschaffbare Klangbank endet als
 * 503 mit lesbarer Meldung, nicht als 500 - der Viewer zeigt sie an und
 * bleibt ohne Ton benutzbar (ScoreViewer.vue).
 *
 * Geprueft wird das je Quelle getrennt, und das ist der ganze Punkt: Der
 * Sidecar-Weg wirft SidecarException, die URL-Quelle die BASISKLASSE
 * ConverterException (Service\SoundFontService::getOrFetchFromUrl). Ein
 * catch auf die Unterklasse fing deshalb nur die eine Haelfte - und zwar
 * die Haelfte, die es auf dem lokalen Konvertierungsweg gar nicht gibt.
 *
 * Warum der Test hier steht und nicht bei SoundFontServiceTest: dort ist ein
 * `expectException(ConverterException::class)` auch dann erfuellt, wenn eine
 * Unterklasse fliegt - die Diskrepanz zwischen Wurf und Fang ist von der
 * Service-Seite aus grundsaetzlich nicht sichtbar.
 */
class SoundFontControllerTest extends TestCase {
	private SoundFontService&MockObject $soundFontService;

	protected function setUp(): void {
		$this->soundFontService = $this->createMock(SoundFontService::class);
	}

	private function controller(): SoundFontController {
		return new SoundFontController(
			$this->createMock(IRequest::class),
			$this->soundFontService,
			$this->createMock(LoggerInterface::class),
		);
	}

	/**
	 * @return array<string, array{\Throwable}>
	 */
	public static function quellen(): array {
		return [
			'Sidecar nicht erreichbar' => [new SidecarException('Verbindung abgelehnt')],
			// Der Fall, den der fruehere catch durchliess: konfigurierte
			// `soundfont_fetch_url`, nichts im Cache, Download gescheitert.
			'URL-Quelle nicht erreichbar' => [new ConverterException('SoundFont-Download von https://example.invalid/sf3 fehlgeschlagen')],
		];
	}

	#[\PHPUnit\Framework\Attributes\DataProvider('quellen')]
	public function testMeldetEineNichtBeschaffbareKlangbankAls503(\Throwable $fehler): void {
		$this->soundFontService->method('getOrFetch')->willThrowException($fehler);

		$response = $this->controller()->get();

		$this->assertInstanceOf(JSONResponse::class, $response);
		$this->assertSame(Http::STATUS_SERVICE_UNAVAILABLE, $response->getStatus());
		$this->assertSame(['error' => $fehler->getMessage()], $response->getData());
	}
}
