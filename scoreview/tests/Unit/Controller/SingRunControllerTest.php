<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Controller;

use OCA\ScoreView\Controller\SingRunController;
use OCA\ScoreView\Service\FeatureConfig;
use OCA\ScoreView\Service\SingRunService;
use OCA\ScoreView\Service\UserFileResolver;
use OCP\AppFramework\Http;
use OCP\Files\Node;
use OCP\IL10N;
use OCP\IRequest;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * Scored runs at the door (E24):
 *
 * 1. Scoring or intonation switched off, no file access: 404 on every route.
 * 2. Only the singer's own runs - the routes take no user from the request.
 * 3. Nonsense from the browser is a 400, not a stored run.
 */
class SingRunControllerTest extends TestCase {
	private UserFileResolver&MockObject $fileResolver;
	private SingRunService&MockObject $runs;
	private FeatureConfig&MockObject $features;
	/** @var array<string, bool> */
	private array $switches = [];

	protected function setUp(): void {
		$this->fileResolver = $this->createMock(UserFileResolver::class);
		$this->runs = $this->createMock(SingRunService::class);
		$this->features = $this->createMock(FeatureConfig::class);
		$this->switches = [FeatureConfig::SING_SCORE => true, FeatureConfig::INTONATION => true];
		$this->features->method('isEnabled')->willReturnCallback(fn (string $s) => $this->switches[$s] ?? false);
	}

	private function controller(): SingRunController {
		$l = $this->createMock(IL10N::class);
		$l->method('t')->willReturnArgument(0);
		return new SingRunController(
			$this->createMock(IRequest::class),
			$this->fileResolver,
			$this->runs,
			$this->features,
			$l,
		);
	}

	private function signedIn(?Node $file): void {
		$this->fileResolver->method('currentUserId')->willReturn('anna');
		$this->fileResolver->method('resolveOwnNode')->willReturn($file);
	}

	public function testListsTheOwnRuns(): void {
		$this->signedIn($this->createMock(Node::class));
		$this->runs->expects($this->once())->method('list')->with(42, 'anna', 5, 12, 'strict')
			->willReturn(['runs' => [], 'best' => []]);

		$response = $this->controller()->index(42, 5, 12, 'strict');

		$this->assertSame(Http::STATUS_OK, $response->getStatus());
	}

	public function testStoresARun(): void {
		$this->signedIn($this->createMock(Node::class));
		$this->runs->expects($this->once())->method('add')->with(42, 'anna', $this->callback(
			fn (array $in) => $in['level'] === 'choir' && $in['totalPct'] === 78 && $in['from'] === null && $in['notesScored'] === 9,
		))->willReturn(['totalPct' => 78]);

		$response = $this->controller()->create(42, null, null, 'choir', 100, 78, 80, 70, null, 9);

		$this->assertSame(Http::STATUS_CREATED, $response->getStatus());
	}

	public function testNonsenseIsABadRequest(): void {
		$this->signedIn($this->createMock(Node::class));
		$this->runs->method('add')->willThrowException(new \InvalidArgumentException('no'));

		$response = $this->controller()->create(42, null, null, 'hard', 100, 78);

		$this->assertSame(Http::STATUS_BAD_REQUEST, $response->getStatus());
	}

	public function testDeletesOnlyTheOwnRuns(): void {
		$this->signedIn($this->createMock(Node::class));
		$this->runs->expects($this->once())->method('clear')->with(42, 'anna')->willReturn(2);

		$this->assertSame(['deleted' => 2], $this->controller()->destroy(42)->getData());
	}

	public function testNoFileAccessIsNotFound(): void {
		$this->signedIn(null);
		$this->runs->expects($this->never())->method('list');
		$this->runs->expects($this->never())->method('add');

		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->index(42)->getStatus());
		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->create(42, null, null, 'choir', 100, 50, null, null, null, 3)->getStatus());
		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->destroy(42)->getStatus());
	}

	public function testScoringSwitchedOffIsNotFound(): void {
		$this->signedIn($this->createMock(Node::class));
		$this->switches[FeatureConfig::SING_SCORE] = false;
		$this->runs->expects($this->never())->method('add');

		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->create(42, null, null, 'choir', 100, 50, null, null, null, 3)->getStatus());
	}

	public function testIntonationSwitchedOffIsNotFound(): void {
		$this->signedIn($this->createMock(Node::class));
		$this->switches[FeatureConfig::INTONATION] = false;

		$this->assertSame(Http::STATUS_NOT_FOUND, $this->controller()->index(42)->getStatus());
	}
}
