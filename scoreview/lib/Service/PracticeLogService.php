<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\Db\PracticeGoalMapper;
use OCA\ScoreView\Db\PracticeLogMapper;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IUserManager;

/**
 * The practice log (docs/architecture.md E20): how long someone practised a
 * score, per day, and the weekly goal a leader set for it.
 *
 * **What counts** is decided in the browser (src/lib/practiceLog.js): time
 * while the score sounds or the microphone listens. The server only adds up
 * and bounds what it is told - it cannot see whether anyone is singing, and
 * a log that someone inflates on purpose only lies to its own author.
 *
 * **Bounds** keep a broken or forged client from writing nonsense: one
 * report covers at most MAX_REPORT_SECONDS, a day holds at most
 * MAX_SECONDS_PER_DAY, and the day must lie within one day of the server's
 * (the browser sends its local calendar day; time zones reach from -12 to
 * +14 hours).
 */
class PracticeLogService {
	/**
	 * The browser reports every minute and on pause (practiceLog.js); five
	 * minutes leave room for a report that was held back by a dead spot.
	 */
	public const MAX_REPORT_SECONDS = 300;

	public const MAX_SECONDS_PER_DAY = 86400;

	/** Eight weeks of one score: this week, last week and a little history. */
	public const HISTORY_DAYS = 56;

	/**
	 * Days kept at all - the streak looks back this far. The cleanup job
	 * drops older rows, so the table does not grow forever.
	 */
	public const KEEP_DAYS = 400;

	/** A goal below five minutes a week is no goal; above 20 hours none either. */
	public const MIN_GOAL_MINUTES = 5;
	public const MAX_GOAL_MINUTES = 1200;

	public function __construct(
		private PracticeLogMapper $log,
		private PracticeGoalMapper $goals,
		private ITimeFactory $time,
		private IUserManager $userManager,
	) {
	}

	/**
	 * @throws \InvalidArgumentException a day that is no date or too far
	 *                                   from today, or seconds out of range
	 * @return int the day's total afterwards
	 */
	public function add(int $fileId, string $userId, string $day, int $seconds): int {
		if ($seconds < 1 || $seconds > self::MAX_REPORT_SECONDS) {
			throw new \InvalidArgumentException('Seconds out of range.');
		}
		if (!$this->isNearToday($day)) {
			throw new \InvalidArgumentException('Day out of range.');
		}
		return $this->log->addSeconds($userId, $fileId, $day, $seconds, self::MAX_SECONDS_PER_DAY);
	}

	/**
	 * @return array{days: array<string, int>, activeDays: string[], goal: ?array{minutesPerWeek: int, setBy: ?string}}
	 */
	public function summary(int $fileId, string $userId): array {
		$days = $this->log->findDays($userId, $fileId, $this->dayBefore(self::HISTORY_DAYS));
		$goal = $this->goals->find($fileId);
		return [
			// An object, not a list, even when empty - the browser looks days up.
			'days' => $days,
			'activeDays' => $this->log->findActiveDays($userId, $this->dayBefore(self::KEEP_DAYS)),
			'goal' => $goal === null ? null : [
				'minutesPerWeek' => $goal['minutesPerWeek'],
				// No raw user id when the account is gone: the goal stays
				// with the choir, the name of a deleted account does not
				// (Listener\UserDeletedListener).
				'setBy' => $this->userManager->get($goal['userId'])?->getDisplayName(),
			],
		];
	}

	/**
	 * Whether someone may set the goal is the controller's question (the
	 * leader role, LeaderService) - like everything role-bound here.
	 *
	 * @param int $minutesPerWeek 0 removes the goal; anything else is bounded
	 * @return ?int the goal stored, null when removed
	 */
	public function setGoal(int $fileId, string $userId, int $minutesPerWeek): ?int {
		if ($minutesPerWeek <= 0) {
			$this->goals->deleteByFileId($fileId);
			return null;
		}
		$minutes = max(self::MIN_GOAL_MINUTES, min(self::MAX_GOAL_MINUTES, $minutesPerWeek));
		$this->goals->set($fileId, $minutes, $userId, $this->time->getDateTime());
		return $minutes;
	}

	/**
	 * Drops days older than KEEP_DAYS (CleanupOrphansJob).
	 */
	public function prune(): int {
		return $this->log->deleteBefore($this->dayBefore(self::KEEP_DAYS));
	}

	private function isNearToday(string $day): bool {
		if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $day) !== 1) {
			return false;
		}
		$parsed = \DateTimeImmutable::createFromFormat('!Y-m-d', $day, new \DateTimeZone('UTC'));
		if ($parsed === false || $parsed->format('Y-m-d') !== $day) {
			return false;
		}
		$today = $this->today();
		$diff = (int)round(($parsed->getTimestamp() - $today->getTimestamp()) / 86400);
		return abs($diff) <= 1;
	}

	private function today(): \DateTimeImmutable {
		$now = \DateTimeImmutable::createFromMutable($this->time->getDateTime('now', new \DateTimeZone('UTC')));
		return $now->setTime(0, 0);
	}

	private function dayBefore(int $days): string {
		return $this->today()->modify("-{$days} days")->format('Y-m-d');
	}
}
