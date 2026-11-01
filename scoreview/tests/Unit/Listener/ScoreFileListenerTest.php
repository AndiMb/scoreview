<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Listener;

use OCA\ScoreView\BackgroundJob\ConvertScoreJob;
use OCA\ScoreView\Listener\ScoreFileListener;
use OCA\ScoreView\Service\ClientFallback;
use OCP\BackgroundJob\IJobList;
use OCP\EventDispatcher\Event;
use OCP\Files\Events\Node\NodeCreatedEvent;
use OCP\Files\File;
use OCP\IAppConfig;
use OCP\IUser;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * Eager conversion on upload. The listener hangs on every write of the
 * instance, so what matters most is what it leaves alone - and that it asks
 * the costly ClientFallback only for a .mscz with eager conversion on.
 */
class ScoreFileListenerTest extends TestCase {
	private IJobList&MockObject $jobList;
	private ClientFallback&MockObject $fallback;

	protected function setUp(): void {
		$this->jobList = $this->createMock(IJobList::class);
		$this->fallback = $this->createMock(ClientFallback::class);
	}

	private function listener(bool $eager = true): ScoreFileListener {
		$config = $this->createMock(IAppConfig::class);
		$config->method('getValueBool')->willReturn($eager);
		return new ScoreFileListener($this->jobList, $config, $this->fallback, $this->createMock(LoggerInterface::class));
	}

	private function created(string $name, ?string $owner = 'anna'): NodeCreatedEvent {
		$node = $this->createMock(File::class);
		$node->method('getName')->willReturn($name);
		$node->method('getId')->willReturn(42);
		$user = null;
		if ($owner !== null) {
			$user = $this->createMock(IUser::class);
			$user->method('getUID')->willReturn($owner);
		}
		$node->method('getOwner')->willReturn($user);
		return new NodeCreatedEvent($node);
	}

	public function testAnUploadedScoreIsQueuedForItsOwner(): void {
		$this->jobList->expects($this->once())->method('add')
			->with(ConvertScoreJob::class, ['userId' => 'anna', 'fileId' => 42]);

		$this->listener()->handle($this->created('Ave.MSCZ'));
	}

	public function testOtherFilesDoNotEvenAskTheFallback(): void {
		$this->fallback->expects($this->never())->method('applies');
		$this->jobList->expects($this->never())->method('add');

		$this->listener()->handle($this->created('notes.txt'));
	}

	public function testWithoutEagerConversionNothingHappens(): void {
		$this->fallback->expects($this->never())->method('applies');
		$this->jobList->expects($this->never())->method('add');

		$this->listener(eager: false)->handle($this->created('Ave.mscz'));
	}

	public function testWhereTheBrowserConvertsThereIsNothingToWarm(): void {
		$this->fallback->method('applies')->willReturn(true);
		$this->jobList->expects($this->never())->method('add');

		$this->listener()->handle($this->created('Ave.mscz'));
	}

	public function testAScoreWithoutOwnerIsSkipped(): void {
		$this->jobList->expects($this->never())->method('add');

		$this->listener()->handle($this->created('Ave.mscz', owner: null));
	}

	public function testOtherEventsAreIgnored(): void {
		$this->jobList->expects($this->never())->method('add');

		$this->listener()->handle(new Event());
	}
}
