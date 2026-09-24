<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Controller;

use OCA\ScoreView\Controller\LeaderController;
use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCA\ScoreView\Service\LeaderException;
use OCA\ScoreView\Service\LeaderService;
use OCA\ScoreView\Service\UserFileResolver;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\AnonRateLimit;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use OCP\Files\Node;
use OCP\IL10N;
use OCP\IRequest;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * Was die HTTP-Schicht der Leitungsrolle zusagt - die Regeln selbst stehen in
 * LeaderServiceTest:
 *
 * 1. **Ohne Dateizugriff 404** auf jedem Endpunkt, damit sich fileIds nicht
 *    abtasten lassen.
 * 2. **Ohne Rolle 403** beim Aendern und bei der Suche.
 * 3. **UIDs nur an Leitungen**: Alle anderen sehen, wer leitet, aber
 *    nicht unter welcher Kennung.
 * 4. **Alle Routen auch mit Token** (E8).
 */
class LeaderControllerTest extends TestCase {
	private UserFileResolver&MockObject $fileResolver;
	private LeaderService&MockObject $leaders;

	protected function setUp(): void {
		$this->fileResolver = $this->createMock(UserFileResolver::class);
		$this->leaders = $this->createMock(LeaderService::class);
		$this->leaders->method('listLeaders')->willReturn([
			['userId' => 'anna', 'displayName' => 'Anna A.', 'isOwner' => true],
			['userId' => 'bert', 'displayName' => 'Bert B.', 'isOwner' => false],
		]);
	}

	private function controller(): LeaderController {
		$l = $this->createMock(IL10N::class);
		$l->method('t')->willReturnArgument(0);
		return new LeaderController($this->createMock(IRequest::class), $this->fileResolver, $this->leaders, $l);
	}

	private function angemeldet(string $uid, bool $sichtbar = true, bool $leitung = false): Node {
		$node = $this->createMock(Node::class);
		$this->fileResolver->method('currentUserId')->willReturn($uid);
		$this->fileResolver->method('resolveOwnNode')->willReturn($sichtbar ? $node : null);
		$this->leaders->method('isLeader')->willReturn($leitung);
		return $node;
	}

	public function testLeitungBekommtKennungenUndAbberufbarkeit(): void {
		$this->angemeldet('bert', leitung: true);

		$antwort = $this->controller()->index(42);

		$this->assertSame(Http::STATUS_OK, $antwort->getStatus());
		$this->assertSame([
			'isLeader' => true,
			'leaders' => [
				['displayName' => 'Anna A.', 'isOwner' => true, 'me' => false, 'userId' => 'anna', 'canRevoke' => false],
				['displayName' => 'Bert B.', 'isOwner' => false, 'me' => true, 'userId' => 'bert', 'canRevoke' => true],
			],
		], $antwort->getData());
	}

	public function testNichtLeitungSiehtNurAnzeigenamen(): void {
		$this->angemeldet('carla');

		$daten = $this->controller()->index(42)->getData();

		$this->assertFalse($daten['isLeader']);
		$this->assertSame(['Anna A.', 'Bert B.'], array_column($daten['leaders'], 'displayName'));
		// Nicht nur das Feld fehlt - keine Kennung steht irgendwo in der Antwort.
		$json = json_encode($daten);
		$this->assertStringNotContainsString('"anna"', $json);
		$this->assertStringNotContainsString('"bert"', $json);
		$this->assertStringNotContainsString('userId', $json);
	}

	public function testErnennenAntwortetMitDerNeuenListe(): void {
		$node = $this->angemeldet('anna', leitung: true);
		$this->leaders->expects($this->once())->method('appoint')->with($node, 'anna', 'carla');

		$antwort = $this->controller()->create(42, 'carla');

		$this->assertSame(Http::STATUS_CREATED, $antwort->getStatus());
		$this->assertTrue($antwort->getData()['isLeader']);
	}

	public function testAbberufen(): void {
		$node = $this->angemeldet('anna', leitung: true);
		$this->leaders->expects($this->once())->method('revoke')->with($node, 'anna', 'bert');

		$this->assertSame(Http::STATUS_OK, $this->controller()->destroy(42, 'bert')->getStatus());
	}

	public function testVorschlaege(): void {
		$node = $this->angemeldet('anna', leitung: true);
		$this->leaders->expects($this->once())->method('candidates')->with($node, 'anna', 'car')
			->willReturn([['userId' => 'carla', 'displayName' => 'Carla C.']]);

		$this->assertSame([['userId' => 'carla', 'displayName' => 'Carla C.']], $this->controller()->candidates(42, 'car')->getData());
	}

	public static function abgelehnt(): array {
		return [
			'ohne Rolle' => [LeaderException::NOT_LEADER, Http::STATUS_FORBIDDEN],
			'Ziel ohne Zugriff' => [LeaderException::NOT_APPOINTABLE, Http::STATUS_BAD_REQUEST],
			'Eigentuemerin' => [LeaderException::OWNER, Http::STATUS_BAD_REQUEST],
			'nicht ernannt' => [LeaderException::NOT_APPOINTED, Http::STATUS_NOT_FOUND],
		];
	}

	#[DataProvider('abgelehnt')]
	public function testAblehnungenWerdenZuStatuscodes(string $grund, int $status): void {
		$this->angemeldet('carla');
		$this->leaders->method('appoint')->willThrowException(new LeaderException($grund));
		$this->leaders->method('revoke')->willThrowException(new LeaderException($grund));
		$this->leaders->method('candidates')->willThrowException(new LeaderException($grund));

		$this->assertSame($status, $this->controller()->create(42, 'dora')->getStatus());
		$this->assertSame($status, $this->controller()->destroy(42, 'anna')->getStatus());
		$this->assertSame($status, $this->controller()->candidates(42, 'ann')->getStatus());
	}

	public function testOhneDateizugriffUeberall404UndKeinDienstaufruf(): void {
		$this->angemeldet('dora', sichtbar: false);
		foreach (['appoint', 'revoke', 'candidates', 'listLeaders', 'isLeader'] as $methode) {
			$this->leaders->expects($this->never())->method($methode);
		}
		$c = $this->controller();

		$this->assertSame(Http::STATUS_NOT_FOUND, $c->index(42)->getStatus());
		$this->assertSame(Http::STATUS_NOT_FOUND, $c->create(42, 'dora')->getStatus());
		$this->assertSame(Http::STATUS_NOT_FOUND, $c->destroy(42, 'bert')->getStatus());
		$this->assertSame(Http::STATUS_NOT_FOUND, $c->candidates(42, 'be')->getStatus());
	}

	public function testOhneAnmeldung404(): void {
		$this->fileResolver->method('currentUserId')->willReturn(null);
		$this->fileResolver->expects($this->never())->method('resolveOwnNode');

		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->index(42)->getStatus());
	}

	public static function routen(): array {
		return [['index'], ['create'], ['destroy'], ['candidates']];
	}

	#[DataProvider('routen')]
	public function testRouteIstMitTokenOffen(string $methode): void {
		$this->assertNotEmpty(
			(new \ReflectionMethod(LeaderController::class, $methode))->getAttributes(DirectTokenOrSession::class),
			$methode . ' muss #[DirectTokenOrSession] tragen (E8)',
		);
	}

	/**
	 * S4: Die Suche ist teuer. Beide Grenzen, weil eine Anfrage mit Token fuer
	 * Nextclouds RateLimitingMiddleware anonym ist.
	 */
	public function testSucheIstGedrosselt(): void {
		$methode = new \ReflectionMethod(LeaderController::class, 'candidates');
		foreach ([UserRateLimit::class, AnonRateLimit::class] as $klasse) {
			$attribute = $methode->getAttributes($klasse);
			$this->assertCount(1, $attribute, $klasse);
			$grenze = $attribute[0]->newInstance();
			$this->assertSame(30, $grenze->getLimit(), $klasse);
			$this->assertSame(60, $grenze->getPeriod(), $klasse);
		}
	}
}
