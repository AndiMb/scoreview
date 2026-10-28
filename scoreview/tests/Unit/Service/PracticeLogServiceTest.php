<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Db\PracticeGoalMapper;
use OCA\ScoreView\Db\PracticeLogMapper;
use OCA\ScoreView\Service\PracticeLogService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IUser;
use OCP\IUserManager;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * The practice log adds up what the browser reports - bounded, because the
 * server cannot see whether anyone sang (E20):
 *
 * 1. A report covers 1..MAX_REPORT_SECONDS; the day is a real date within
 *    one day of the server's (time zones from -12 to +14 hours).
 * 2. The goal is bounded to 5..1200 minutes; 0 removes it.
 * 3. A goal from a deleted account carries no name - and no raw user id.
 */
class PracticeLogServiceTest extends TestCase {
	private PracticeLogMapper&MockObject $log;
	private PracticeGoalMapper&MockObject $goals;
	private IUserManager&MockObject $users;

	protected function setUp(): void {
		$this->log = $this->createMock(PracticeLogMapper::class);
		$this->goals = $this->createMock(PracticeGoalMapper::class);
		$this->users = $this->createMock(IUserManager::class);
	}

	private function service(): PracticeLogService {
		$time = $this->createMock(ITimeFactory::class);
		$time->method('getDateTime')->willReturnCallback(
			fn () => new \DateTime('2026-10-27 13:00:00', new \DateTimeZone('UTC')),
		);
		return new PracticeLogService($this->log, $this->goals, $time, $this->users);
	}

	public function testAddsToTheDayWithTheCap(): void {
		$this->log->expects($this->once())->method('addSeconds')
			->with('anna', 42, '2026-10-27', 60, PracticeLogService::MAX_SECONDS_PER_DAY)
			->willReturn(180);

		$this->assertSame(180, $this->service()->add(42, 'anna', '2026-10-27', 60));
	}

	public static function acceptedDays(): array {
		return [
			'yesterday (west of UTC)' => ['2026-10-26'],
			'today' => ['2026-10-27'],
			'tomorrow (east of UTC)' => ['2026-10-28'],
		];
	}

	#[DataProvider('acceptedDays')]
	public function testAcceptsDaysNearToday(string $day): void {
		$this->log->expects($this->once())->method('addSeconds')->willReturn(1);
		$this->service()->add(42, 'anna', $day, 1);
	}

	public static function refusedReports(): array {
		return [
			'two days ago' => ['2026-10-25', 60],
			'in two days' => ['2026-10-29', 60],
			'no date' => ['yesterday', 60],
			'impossible date' => ['2026-02-30', 60],
			'zero seconds' => ['2026-10-27', 0],
			'negative seconds' => ['2026-10-27', -5],
			'too long a report' => ['2026-10-27', PracticeLogService::MAX_REPORT_SECONDS + 1],
		];
	}

	#[DataProvider('refusedReports')]
	public function testRefusesNonsense(string $day, int $seconds): void {
		$this->log->expects($this->never())->method('addSeconds');
		$this->expectException(\InvalidArgumentException::class);
		$this->service()->add(42, 'anna', $day, $seconds);
	}

	public function testSummaryReadsOnlyTheOwnLog(): void {
		$this->log->expects($this->once())->method('findDays')
			->with('anna', 42, '2026-09-01')
			->willReturn(['2026-10-26' => 300]);
		$this->log->method('findActiveDays')->with('anna', $this->anything())->willReturn(['2026-10-26']);
		$this->goals->method('find')->willReturn(null);

		$summary = $this->service()->summary(42, 'anna');

		$this->assertSame(['2026-10-26' => 300], $summary['days']);
		$this->assertSame(['2026-10-26'], $summary['activeDays']);
		$this->assertNull($summary['goal']);
	}

	public function testGoalCarriesTheLeadersName(): void {
		$this->log->method('findDays')->willReturn([]);
		$this->log->method('findActiveDays')->willReturn([]);
		$this->goals->method('find')->willReturn(['minutesPerWeek' => 60, 'userId' => 'lea', 'updatedAt' => '']);
		$user = $this->createMock(IUser::class);
		$user->method('getDisplayName')->willReturn('Lea Leitung');
		$this->users->method('get')->with('lea')->willReturn($user);

		$this->assertSame(['minutesPerWeek' => 60, 'setBy' => 'Lea Leitung'], $this->service()->summary(42, 'anna')['goal']);
	}

	public function testGoalOfADeletedAccountHasNoName(): void {
		$this->log->method('findDays')->willReturn([]);
		$this->log->method('findActiveDays')->willReturn([]);
		$this->goals->method('find')->willReturn(['minutesPerWeek' => 60, 'userId' => 'gone', 'updatedAt' => '']);
		$this->users->method('get')->willReturn(null);

		$this->assertSame(['minutesPerWeek' => 60, 'setBy' => null], $this->service()->summary(42, 'anna')['goal']);
	}

	public static function goals(): array {
		return [
			'in range' => [90, 90],
			'too small' => [1, PracticeLogService::MIN_GOAL_MINUTES],
			'too large' => [99999, PracticeLogService::MAX_GOAL_MINUTES],
		];
	}

	#[DataProvider('goals')]
	public function testGoalIsBounded(int $asked, int $stored): void {
		$this->goals->expects($this->once())->method('set')->with(42, $stored, 'lea', $this->anything());
		$this->assertSame($stored, $this->service()->setGoal(42, 'lea', $asked));
	}

	public function testZeroRemovesTheGoal(): void {
		$this->goals->expects($this->never())->method('set');
		$this->goals->expects($this->once())->method('deleteByFileId')->with(42);
		$this->assertNull($this->service()->setGoal(42, 'lea', 0));
	}

	public function testPruneKeepsABoundedHistory(): void {
		$this->log->expects($this->once())->method('deleteBefore')->with('2025-09-22')->willReturn(3);
		$this->assertSame(3, $this->service()->prune());
	}
}
