<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Controller;

use OCA\ScoreView\Controller\MyPartController;
use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCA\ScoreView\Service\UserFileResolver;
use OCA\ScoreView\Service\ViewerPreferences;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\Files\Node;
use OCP\IL10N;
use OCP\IRequest;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * „Meine Stimme" ist eine Nutzereinstellung, haengt aber an einer Datei -
 * und damit an deren Zugriffsrecht. Zwei Zusagen:
 *
 * 1. **Wer die Datei nicht sieht, bekommt 404**, lesend wie schreibend. Sonst
 *    liessen sich fremde fileIds abtasten, und jemand koennte fuer eine
 *    Partitur, die er nicht kennt, Eintraege in seinen Einstellungen
 *    anhaeufen.
 * 2. **Beide Wege sind auch mit Token offen** (E8): Die Mobil-App braucht die
 *    Wahl, damit das Folgen Stimmnotizen richtig filtert. Die Pruefung des
 *    Tokens selbst sitzt in der Middleware (DirectAccessMiddlewareTest);
 *    hier wird festgehalten, dass die Routen sie ueberhaupt anbieten.
 */
class MyPartControllerTest extends TestCase {
	private UserFileResolver&MockObject $fileResolver;
	private ViewerPreferences&MockObject $preferences;

	protected function setUp(): void {
		$this->fileResolver = $this->createMock(UserFileResolver::class);
		$this->preferences = $this->createMock(ViewerPreferences::class);
	}

	private function controller(): MyPartController {
		$l = $this->createMock(IL10N::class);
		$l->method('t')->willReturnArgument(0);
		return new MyPartController(
			$this->createMock(IRequest::class),
			$this->fileResolver,
			$this->preferences,
			$l,
		);
	}

	private function angemeldet(?Node $datei): void {
		$this->fileResolver->method('currentUserId')->willReturn('anna');
		$this->fileResolver->method('resolveOwnNode')->willReturn($datei);
	}

	public function testLiestDieGespeicherteStimme(): void {
		$this->angemeldet($this->createMock(Node::class));
		$this->preferences->expects($this->once())->method('getMyPart')->with('anna', 42)->willReturn('3');

		$antwort = $this->controller()->show(42);

		$this->assertSame(Http::STATUS_OK, $antwort->getStatus());
		$this->assertSame(['partId' => '3'], $antwort->getData());
	}

	public function testSpeichertUndAntwortetMitDemGeltenden(): void {
		$this->angemeldet($this->createMock(Node::class));
		$this->preferences->expects($this->once())->method('setMyPart')->with('anna', 42, 'x')->willReturn(null);

		$antwort = $this->controller()->update(42, 'x');

		$this->assertSame(['partId' => null], $antwort->getData());
	}

	public function testFremdeDateiLesendEineVierNullVier(): void {
		$this->angemeldet(null);
		$this->preferences->expects($this->never())->method('getMyPart');

		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->show(99)->getStatus());
	}

	public function testFremdeDateiSchreibendEineVierNullVier(): void {
		$this->angemeldet(null);
		$this->preferences->expects($this->never())->method('setMyPart');

		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->update(99, '1')->getStatus());
	}

	public function testOhneNutzerinEineVierNullVier(): void {
		$this->fileResolver->method('currentUserId')->willReturn(null);
		$this->preferences->expects($this->never())->method('setMyPart');

		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->update(42, '1')->getStatus());
	}

	/**
	 * Ohne #[PublicPage] liesse Nextclouds SecurityMiddleware die
	 * sitzungslose Anfrage der App gar nicht bis zur eigenen Middleware
	 * durch; ohne #[DirectTokenOrSession] wiese diese sie ab.
	 */
	#[DataProvider('methoden')]
	public function testBietetDenTokenwegAn(string $methode): void {
		$reflection = new \ReflectionMethod(MyPartController::class, $methode);

		$this->assertNotEmpty($reflection->getAttributes(DirectTokenOrSession::class));
		$this->assertNotEmpty($reflection->getAttributes(PublicPage::class));
		// Im Sitzungsfall bleibt die CSRF-Pruefung (Vorgabe des Attributs).
		$this->assertTrue($reflection->getAttributes(DirectTokenOrSession::class)[0]->newInstance()->csrfInSession);
	}

	public static function methoden(): array {
		return [['show'], ['update']];
	}
}
