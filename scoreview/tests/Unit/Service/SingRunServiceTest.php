<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Db\SingRunMapper;
use OCA\ScoreView\Service\SingRunService;
use OCP\AppFramework\Utility\ITimeFactory;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * Scored runs are what the browser reports - bounded, because the server
 * cannot hear anyone sing (E24):
 *
 * 1. Percentages 0..100 (parts may be null, the total not), a known level,
 *    tempo 50..150, at least one note, both measures or none, from ≤ to.
 * 2. Each unit keeps its newest KEEP_PER_UNIT runs.
 * 3. The best scores come per tempo, keyed by strings.
 */
class SingRunServiceTest extends TestCase {
	private SingRunMapper&MockObject $runs;

	protected function setUp(): void {
		$this->runs = $this->createMock(SingRunMapper::class);
	}

	private function service(): SingRunService {
		$time = $this->createMock(ITimeFactory::class);
		$time->method('getTime')->willReturn(1793470000);
		return new SingRunService($this->runs, $time);
	}

	private static function valid(array $override = []): array {
		return array_merge([
			'from' => 5,
			'to' => 12,
			'level' => 'choir',
			'tempoPct' => 80,
			'totalPct' => 78,
			'pitchPct' => 84,
			'onsetPct' => 71,
			'releasePct' => null,
			'notesScored' => 31,
		], $override);
	}

	public function testStoresAValidRunAndTrimsItsUnit(): void {
		$this->runs->expects($this->once())->method('insert')->with($this->callback(
			fn (array $row) => $row['user_id'] === 'anna' && $row['file_id'] === 42
				&& $row['from_measure'] === 5 && $row['to_measure'] === 12
				&& $row['level'] === 'choir' && $row['tempo_pct'] === 80
				&& $row['total_pct'] === 78 && $row['release_pct'] === null
				&& $row['created_at'] === 1793470000,
		))->willReturn(7);
		$this->runs->expects($this->once())->method('trimUnit')
			->with('anna', 42, 5, 12, 'choir', SingRunService::KEEP_PER_UNIT);

		$run = $this->service()->add(42, 'anna', self::valid());

		$this->assertSame(78, $run['totalPct']);
		$this->assertNull($run['releasePct']);
		$this->assertSame(5, $run['from']);
	}

	public function testTheWholePieceHasNoMeasures(): void {
		$this->runs->expects($this->once())->method('trimUnit')->with('anna', 42, null, null, 'easy', SingRunService::KEEP_PER_UNIT);

		$run = $this->service()->add(42, 'anna', self::valid(['from' => null, 'to' => null, 'level' => 'easy']));

		$this->assertNull($run['from']);
	}

	public static function refused(): array {
		return [
			'total above 100' => [['totalPct' => 101]],
			'negative part' => [['pitchPct' => -1]],
			'no total' => [['totalPct' => null]],
			'unknown level' => [['level' => 'hard']],
			'from after to' => [['from' => 12, 'to' => 5]],
			'only from' => [['to' => null]],
			'measure zero' => [['from' => 0]],
			'too slow' => [['tempoPct' => 40]],
			'too fast' => [['tempoPct' => 160]],
			'no notes' => [['notesScored' => 0]],
		];
	}

	#[DataProvider('refused')]
	public function testRefusesNonsense(array $override): void {
		$this->runs->expects($this->never())->method('insert');
		$this->expectException(\InvalidArgumentException::class);

		$this->service()->add(42, 'anna', self::valid($override));
	}

	public function testListsTheUnitWithTheBestPerTempo(): void {
		$this->runs->expects($this->once())->method('findForUnit')
			->with('anna', 42, 5, 12, 'choir', SingRunService::LIST_LIMIT)
			->willReturn([[
				'from_measure' => '5', 'to_measure' => '12', 'level' => 'choir', 'tempo_pct' => '100',
				'total_pct' => '74', 'pitch_pct' => '80', 'onset_pct' => null, 'release_pct' => '60',
				'notes_scored' => '20', 'created_at' => '1793469000',
			]]);
		$this->runs->method('bestByTempo')->willReturn([100 => 74, 80 => 81]);

		$list = $this->service()->list(42, 'anna', 5, 12, 'choir');

		$this->assertSame(['100' => 74, '80' => 81], $list['best']);
		$this->assertSame(74, $list['runs'][0]['totalPct']);
		$this->assertNull($list['runs'][0]['onsetPct']);
		$this->assertSame(5, $list['runs'][0]['from']);
	}

	public function testAnUnknownLevelListsNothing(): void {
		$this->runs->expects($this->never())->method('findForUnit');

		$this->assertSame(['runs' => [], 'best' => []], $this->service()->list(42, 'anna', null, null, 'hard'));
	}

	public function testClearsOnlyTheOwnRunsOfTheScore(): void {
		$this->runs->expects($this->once())->method('deleteForFile')->with('anna', 42)->willReturn(3);

		$this->assertSame(3, $this->service()->clear(42, 'anna'));
	}
}
