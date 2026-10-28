<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Controller;

use OCA\ScoreView\Controller\PracticeLogController;
use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCA\ScoreView\Service\FeatureConfig;
use OCA\ScoreView\Service\LeaderService;
use OCA\ScoreView\Service\PracticeLogService;
use OCA\ScoreView\Service\UserFileResolver;
use OCP\AppFramework\Http;
use OCP\Files\Node;
use OCP\IL10N;
use OCP\IRequest;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * The practice log's promises at the door (E20):
 *
 * 1. Switched off or no file access: 404 on every route.
 * 2. Only the singer's own log - the routes take no user from the request.
 * 3. The goal is for leaders only, enforced here (E9).
 * 4. Nonsense from the browser is a 400, not a stored number.
 */
class PracticeLogControllerTest extends TestCase {
	private UserFileResolver&MockObject $fileResolver;
	private PracticeLogService&MockObject $practice;
	private LeaderService&MockObject $leaders;
	private FeatureConfig&MockObject $features;

	protected function setUp(): void {
		$this->fileResolver = $this->createMock(UserFileResolver::class);
		$this->practice = $this->createMock(PracticeLogService::class);
		$this->leaders = $this->createMock(LeaderService::class);
		$this->features = $this->createMock(FeatureConfig::class);
		$this->features->method('isEnabled')->willReturn(true);
	}

	private function controller(): PracticeLogController {
		$l = $this->createMock(IL10N::class);
		$l->method('t')->willReturnArgument(0);
		return new PracticeLogController(
			$this->createMock(IRequest::class),
			$this->fileResolver,
			$this->practice,
			$this->leaders,
			$this->features,
			$l,
		);
	}

	private function signedIn(?Node $file): void {
		$this->fileResolver->method('currentUserId')->willReturn('anna');
		$this->fileResolver->method('resolveOwnNode')->willReturn($file);
	}

	public function testShowsTheOwnSummary(): void {
		$this->signedIn($this->createMock(Node::class));
		$this->practice->expects($this->once())->method('summary')->with(42, 'anna')
			->willReturn(['days' => [], 'activeDays' => [], 'goal' => null]);

		$response = $this->controller()->show(42);

		$this->assertSame(Http::STATUS_OK, $response->getStatus());
	}

	public function testAddsAReport(): void {
		$this->signedIn($this->createMock(Node::class));
		$this->practice->expects($this->once())->method('add')->with(42, 'anna', '2026-10-27', 60)->willReturn(120);

		$response = $this->controller()->create(42, '2026-10-27', 60);

		$this->assertSame(['day' => '2026-10-27', 'seconds' => 120], $response->getData());
	}

	public function testNonsenseIsABadRequest(): void {
		$this->signedIn($this->createMock(Node::class));
		$this->practice->method('add')->willThrowException(new \InvalidArgumentException());

		$this->assertSame(Http::STATUS_BAD_REQUEST, $this->controller()->create(42, 'x', 60)->getStatus());
	}

	public function testForeignFileIsNotFound(): void {
		$this->signedIn(null);
		$this->practice->expects($this->never())->method('summary');
		$this->practice->expects($this->never())->method('add');

		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->show(42)->getStatus());
		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->create(42, '2026-10-27', 60)->getStatus());
		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->updateGoal(42, 60)->getStatus());
	}

	public function testSwitchedOffIsNotFound(): void {
		$this->features = $this->createMock(FeatureConfig::class);
		$this->features->method('isEnabled')->with(FeatureConfig::PRACTICE_LOG)->willReturn(false);
		$this->signedIn($this->createMock(Node::class));
		$this->practice->expects($this->never())->method('summary');

		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->show(42)->getStatus());
	}

	public function testOnlyLeadersSetTheGoal(): void {
		$this->signedIn($this->createMock(Node::class));
		$this->leaders->method('isLeader')->willReturn(false);
		$this->practice->expects($this->never())->method('setGoal');

		$this->assertSame(Http::STATUS_FORBIDDEN, $this->controller()->updateGoal(42, 60)->getStatus());
	}

	public function testALeaderSetsTheGoal(): void {
		$this->signedIn($this->createMock(Node::class));
		$this->leaders->method('isLeader')->willReturn(true);
		$this->practice->expects($this->once())->method('setGoal')->with(42, 'anna', 60)->willReturn(60);

		$this->assertSame(['minutesPerWeek' => 60], $this->controller()->updateGoal(42, 60)->getData());
	}

	public function testAllRoutesTakeTheToken(): void {
		foreach (['show', 'create', 'updateGoal'] as $method) {
			$attributes = (new \ReflectionMethod(PracticeLogController::class, $method))->getAttributes(DirectTokenOrSession::class);
			$this->assertCount(1, $attributes, $method);
		}
	}
}
