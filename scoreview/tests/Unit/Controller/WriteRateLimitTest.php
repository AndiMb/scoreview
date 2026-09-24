<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Controller;

use OCA\ScoreView\Controller\AnnotationController;
use OCA\ScoreView\Controller\FollowController;
use OCA\ScoreView\Controller\RecordingController;
use OCA\ScoreView\Controller\SetlistController;
use OCP\AppFramework\Http\Attribute\AnonRateLimit;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Die schreibenden Routen, die auch ohne Sitzung erreichbar sind, tragen
 * beide Drosseln: Anfragen mit Token sind fuer Nextclouds
 * RateLimitingMiddleware anonym (sie laeuft vor der eigenen Middleware, die
 * den Nutzer erst setzt) - ohne #[AnonRateLimit] liefen sie ungebremst.
 */
class WriteRateLimitTest extends TestCase {
	/** @return array<string, array{0: class-string, 1: string, 2: int, 3: int}> */
	public static function routen(): array {
		return [
			'Aufnahme hochladen' => [RecordingController::class, 'create', 10, 60],
			'Mitverfolgen steuern' => [FollowController::class, 'update', 120, 60],
			'Setliste speichern' => [SetlistController::class, 'update', 30, 60],
			'Setliste anlegen' => [SetlistController::class, 'create', 30, 60],
			'Mitverfolgen starten' => [FollowController::class, 'create', 30, 60],
			'Mitverfolgen beenden' => [FollowController::class, 'destroy', 30, 60],
			'Fuer Push anmelden' => [FollowController::class, 'join', 30, 60],
			'Notiz anlegen' => [AnnotationController::class, 'create', 60, 60],
			'Notiz aendern' => [AnnotationController::class, 'update', 60, 60],
		];
	}

	#[DataProvider('routen')]
	public function testSchreibendeRouteIstGedrosselt(string $controller, string $methode, int $limit, int $periode): void {
		$reflection = new \ReflectionMethod($controller, $methode);
		foreach ([UserRateLimit::class, AnonRateLimit::class] as $klasse) {
			$attribute = $reflection->getAttributes($klasse);
			$this->assertCount(1, $attribute, $klasse);
			$grenze = $attribute[0]->newInstance();
			$this->assertSame($limit, $grenze->getLimit(), $klasse);
			$this->assertSame($periode, $grenze->getPeriod(), $klasse);
		}
	}
}
