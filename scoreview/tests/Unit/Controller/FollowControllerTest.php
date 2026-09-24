<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Controller;

use OCA\ScoreView\Controller\FollowController;
use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCA\ScoreView\Service\FeatureConfig;
use OCA\ScoreView\Service\FollowException;
use OCA\ScoreView\Service\FollowService;
use OCA\ScoreView\Service\UserFileResolver;
use OCP\AppFramework\Http;
use OCP\Files\Node;
use OCP\IAppConfig;
use OCP\IL10N;
use OCP\IRequest;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * Was die HTTP-Schicht von „Folgt mir" zusagt - die Regeln selbst stehen in
 * FollowServiceTest:
 *
 * 1. **Schalter aus → 404** auf jedem Endpunkt.
 * 2. **Ohne Dateizugriff 404**, ohne Leitungsrolle 403.
 * 3. **204, wenn sich nichts geaendert hat**, mit dem Abfrageintervall im
 *    Kopf; sonst der Zustand samt `serverNow` und `pollMs`.
 * 4. **Keine Kennung der Leitung** in der Antwort, nur Name und `me`.
 * 5. **Alle Routen auch mit Token** (E8).
 */
class FollowControllerTest extends TestCase {
	private UserFileResolver&MockObject $fileResolver;
	private FollowService&MockObject $follow;
	private bool $eingeschaltet = true;

	private const AKTIV = [
		'version' => '101',
		'active' => true,
		'leaderUid' => 'anna',
		'leaderName' => 'Anna A.',
		'heartbeat' => 1790000000,
		'state' => ['session' => 100, 'position' => ['seq' => 1, 'measure' => 47, 'mark' => 'C']],
	];

	protected function setUp(): void {
		$this->fileResolver = $this->createMock(UserFileResolver::class);
		$this->follow = $this->createMock(FollowService::class);
		$this->follow->method('nowMs')->willReturn(1790000000123);
	}

	private function controller(): FollowController {
		$l = $this->createMock(IL10N::class);
		$l->method('t')->willReturnArgument(0);
		$config = $this->createMock(IAppConfig::class);
		$config->method('getValueBool')->willReturnCallback(fn (string $app, string $key, bool $default) => $key === FeatureConfig::FOLLOW_SESSION ? $this->eingeschaltet : $default);
		$config->method('getValueInt')->willReturnCallback(fn (string $app, string $key, int $default) => $key === FeatureConfig::FOLLOW_POLL_MS ? 1200 : $default);
		return new FollowController($this->createMock(IRequest::class), $this->fileResolver, $this->follow, new FeatureConfig($config), $l);
	}

	private function angemeldet(string $uid, bool $sichtbar = true): Node {
		$node = $this->createMock(Node::class);
		$this->fileResolver->method('currentUserId')->willReturn($uid);
		$this->fileResolver->method('resolveOwnNode')->willReturn($sichtbar ? $node : null);
		return $node;
	}

	/**
	 * @return array<string, array{callable(FollowController): mixed}>
	 */
	public static function endpunkte(): array {
		return [
			'GET' => [fn (FollowController $c) => $c->show(42)],
			'POST' => [fn (FollowController $c) => $c->create(42)],
			'PATCH' => [fn (FollowController $c) => $c->update(42, tone: true)],
			'DELETE' => [fn (FollowController $c) => $c->destroy(42)],
			'join' => [fn (FollowController $c) => $c->join(42)],
		];
	}

	#[DataProvider('endpunkte')]
	public function testSchalterAusHeisst404UndKeinDienstaufruf(callable $aufruf): void {
		$this->eingeschaltet = false;
		$this->angemeldet('anna');
		$this->follow->expects($this->never())->method($this->anything());
		$this->fileResolver->expects($this->never())->method('resolveOwnNode');

		$this->assertSame(Http::STATUS_NOT_FOUND, $aufruf($this->controller())->getStatus());
	}

	#[DataProvider('endpunkte')]
	public function testOhneDateizugriff404(callable $aufruf): void {
		$this->angemeldet('dora', sichtbar: false);
		$this->follow->expects($this->never())->method('read');

		$this->assertSame(Http::STATUS_NOT_FOUND, $aufruf($this->controller())->getStatus());
	}

	public function testAlleRoutenNehmenDasTokenAn(): void {
		$methoden = ['GET' => 'show', 'POST' => 'create', 'PATCH' => 'update', 'DELETE' => 'destroy', 'join' => 'join'];
		foreach ($methoden as $methode) {
			$attribute = (new \ReflectionMethod(FollowController::class, $methode))->getAttributes(DirectTokenOrSession::class);
			$this->assertCount(1, $attribute, $methode);
		}
	}

	public function testUnveraendert204MitIntervallImKopf(): void {
		$this->angemeldet('carla');
		$this->follow->expects($this->once())->method('read')->with(42, '101')->willReturn(null);

		$antwort = $this->controller()->show(42, '101');

		$this->assertSame(Http::STATUS_NO_CONTENT, $antwort->getStatus());
		// Ueber die Eigenschaft statt getHeaders(): Das fragt den Server-
		// Container nach der Request-ID, den es im Unit-Test nicht gibt.
		$kopf = (new \ReflectionProperty($antwort, 'headers'))->getValue($antwort);
		$this->assertSame('1200', $kopf[FollowController::POLL_HEADER]);
	}

	public function testZustandMitServerzeitUndOhneKennung(): void {
		$this->angemeldet('carla');
		$this->follow->method('read')->with(42, null)->willReturn(self::AKTIV);

		$antwort = $this->controller()->show(42);

		$this->assertSame(Http::STATUS_OK, $antwort->getStatus());
		$this->assertSame([
			'version' => '101',
			'active' => true,
			'serverNow' => 1790000000123,
			'pollMs' => 1200,
			'leader' => ['displayName' => 'Anna A.', 'me' => false],
			'state' => self::AKTIV['state'],
		], $antwort->getData());
		$this->assertStringNotContainsString('"anna"', json_encode($antwort->getData()));
	}

	public function testDieLeitungErkenntSichSelbst(): void {
		$this->angemeldet('anna');
		$this->follow->method('read')->willReturn(self::AKTIV);

		$this->assertTrue($this->controller()->show(42)->getData()['leader']['me']);
	}

	public function testPushGeraetErneuertBeimAbfragenSeineAnmeldung(): void {
		$this->angemeldet('carla');
		$this->follow->expects($this->once())->method('refreshMember')->with(42, 'carla');
		$this->follow->method('read')->willReturn(null);

		$this->controller()->show(42, '101', true);
	}

	public function testStartGibtDenStandMit201(): void {
		$node = $this->angemeldet('anna');
		$this->follow->expects($this->once())->method('start')->with($node, 'anna', 47, 'C')->willReturn(self::AKTIV);

		$antwort = $this->controller()->create(42, 47, 'C');

		$this->assertSame(Http::STATUS_CREATED, $antwort->getStatus());
		$this->assertTrue($antwort->getData()['leader']['me']);
	}

	public function testPatchReichtDieAngabenWeiter(): void {
		$node = $this->angemeldet('anna');
		$this->follow->expects($this->once())->method('change')->with($node, 'anna', [
			'clearLoop' => false,
			'tone' => true,
			'heartbeat' => false,
			'position' => ['measure' => 12, 'mark' => null],
			'loop' => ['from' => 1, 'to' => 4],
		])->willReturn(self::AKTIV);

		$antwort = $this->controller()->update(42, ['measure' => 12, 'mark' => null], ['from' => 1, 'to' => 4], tone: true);

		$this->assertSame(Http::STATUS_OK, $antwort->getStatus());
	}

	public function testEndeAntwortetOhneSitzung(): void {
		$this->angemeldet('anna');
		$this->follow->method('end')->willReturn(['version' => '0', 'active' => false]);

		$daten = $this->controller()->destroy(42)->getData();

		$this->assertFalse($daten['active']);
		$this->assertArrayNotHasKey('leader', $daten);
	}

	public function testJoinNenntObPushGreift(): void {
		$this->angemeldet('carla');
		$this->follow->method('join')->with(42, 'carla')->willReturn(false);

		$this->assertSame(['push' => false], $this->controller()->join(42)->getData());
	}

	public static function abgelehnt(): array {
		return [
			'ohne Rolle' => [FollowException::NOT_LEADER, Http::STATUS_FORBIDDEN],
			'keine Sitzung' => [FollowException::NO_SESSION, Http::STATUS_CONFLICT],
			'andere Leitung' => [FollowException::OTHER_LEADER, Http::STATUS_CONFLICT],
			'unsinnig' => [FollowException::INVALID, Http::STATUS_BAD_REQUEST],
			'gleichzeitig' => [FollowException::CONFLICT, Http::STATUS_CONFLICT],
		];
	}

	#[DataProvider('abgelehnt')]
	public function testAblehnungenWerdenZuStatuscodes(string $grund, int $status): void {
		$this->angemeldet('carla');
		$this->follow->method('start')->willThrowException(new FollowException($grund));
		$this->follow->method('change')->willThrowException(new FollowException($grund));
		$this->follow->method('end')->willThrowException(new FollowException($grund));

		$this->assertSame($status, $this->controller()->create(42)->getStatus());
		$this->assertSame($status, $this->controller()->update(42, tone: true)->getStatus());
		$this->assertSame($status, $this->controller()->destroy(42)->getStatus());
	}
}
