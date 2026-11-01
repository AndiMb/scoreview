<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Db\ScoreVariant;
use OCA\ScoreView\Db\ScoreVariantMapper;
use OCA\ScoreView\Service\ArtifactStore;
use OCA\ScoreView\Service\VariantService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\DB\Exception as DbException;
use OCP\Files\IAppData;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFile;
use OCP\Files\SimpleFS\ISimpleFolder;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * What the variant cache promises (docs/architecture.md E19, S4):
 *
 * - one run per variant at a time - the unique index is the lock;
 * - a dead run and an old error do not block a variant for good, a fresh
 *   error does not start a run on every request;
 * - artifact names are an allowlist, as for the base;
 * - at most MAX_PER_VERSION variants per score version, least recently read
 *   go first, running ones are left alone.
 */
class VariantServiceTest extends TestCase {
	private const NOW = 1_800_000_000;

	private ScoreVariantMapper&MockObject $mapper;
	private IAppData&MockObject $appData;
	private ITimeFactory&MockObject $time;

	protected function setUp(): void {
		$this->mapper = $this->createMock(ScoreVariantMapper::class);
		$this->appData = $this->createMock(IAppData::class);
		$this->time = $this->createMock(ITimeFactory::class);
		$this->time->method('getTime')->willReturn(self::NOW);
	}

	private function service(): VariantService {
		return new VariantService($this->mapper, new ArtifactStore($this->appData), $this->time);
	}

	private function variant(string $status, int $ageSeconds, ?int $formatVersion = VariantService::FORMAT_VERSION, string $key = 'full~phone~w~0'): ScoreVariant {
		$v = new ScoreVariant();
		$v->setFileId(42);
		$v->setEtag('e1');
		$v->setVariant($key);
		$v->setStatus($status);
		$v->setFormatVersion($formatVersion);
		$v->setUpdatedAt((new \DateTime())->setTimestamp(self::NOW - $ageSeconds));
		$v->setAccessedAt((new \DateTime())->setTimestamp(self::NOW - $ageSeconds));
		return $v;
	}

	public function testTheSecondClaimOfTheSameVariantGetsNothing(): void {
		$conflict = new class('duplicate') extends DbException {
			public function getReason(): ?int {
				return self::REASON_UNIQUE_CONSTRAINT_VIOLATION;
			}
		};
		$this->mapper->method('insert')->willThrowException($conflict);
		$this->assertNull($this->service()->claim(42, 'e1', 'full~phone~w~0'));
	}

	public function testAClaimedRowIsProcessing(): void {
		$this->mapper->method('insert')->willReturnArgument(0);
		$row = $this->service()->claim(42, 'e1', 'ex0~orig~w~0');
		$this->assertSame(ScoreConversion::STATUS_PROCESSING, $row->getStatus());
		$this->assertSame('ex0~orig~w~0', $row->getVariant());
	}

	public function testOtherDatabaseErrorsAreNotSwallowed(): void {
		$this->mapper->method('insert')->willThrowException(new DbException('gone'));
		$this->expectException(DbException::class);
		$this->service()->claim(42, 'e1', 'full~phone~w~0');
	}

	public function testARunIsAliveUntilTheDeadline(): void {
		$s = $this->service();
		$this->assertTrue($s->isRunning($this->variant(ScoreConversion::STATUS_PROCESSING, VariantService::STALE_AFTER_SECONDS)));
		$dead = $this->variant(ScoreConversion::STATUS_PROCESSING, VariantService::STALE_AFTER_SECONDS + 1);
		$this->assertFalse($s->isRunning($dead));
		$this->assertTrue($s->mayRetry($dead));
	}

	public function testAFreshErrorIsNotRetriedAnOldOneIs(): void {
		$s = $this->service();
		$this->assertFalse($s->mayRetry($this->variant(ScoreConversion::STATUS_ERROR, 60)));
		$this->assertTrue($s->mayRetry($this->variant(ScoreConversion::STATUS_ERROR, VariantService::RETRY_ERROR_AFTER_SECONDS + 1)));
	}

	/** @return array<string, array{string}> */
	public static function transientErrors(): array {
		return [
			'busy sidecar' => [ScoreConversion::ERROR_SIDECAR_BUSY],
			'unreachable sidecar' => [ScoreConversion::ERROR_SIDECAR_UNREACHABLE],
			'no variants on this path' => [ScoreVariant::ERROR_UNSUPPORTED],
		];
	}

	#[DataProvider('transientErrors')]
	public function testAnErrorOfTheServiceIsRetriedSoon(string $code): void {
		$s = $this->service();
		$fresh = $this->variant(ScoreConversion::STATUS_ERROR, 30);
		$fresh->setErrorCode($code);
		$this->assertFalse($s->mayRetry($fresh));
		$later = $this->variant(ScoreConversion::STATUS_ERROR, VariantService::RETRY_TRANSIENT_AFTER_SECONDS + 1);
		$later->setErrorCode($code);
		$this->assertTrue($s->mayRetry($later));
	}

	public function testAnErrorOfTheScoreWaitsTheHour(): void {
		$v = $this->variant(ScoreConversion::STATUS_ERROR, VariantService::RETRY_TRANSIENT_AFTER_SECONDS + 1);
		$v->setErrorCode(ScoreConversion::ERROR_CONVERSION_FAILED);
		$this->assertFalse($this->service()->mayRetry($v));
	}

	public function testAReadyVariantOfAnOlderFormatIsMadeAgain(): void {
		$s = $this->service();
		$this->assertTrue($s->isCurrent($this->variant(ScoreConversion::STATUS_READY, 10)));
		$old = $this->variant(ScoreConversion::STATUS_READY, 10, VariantService::FORMAT_VERSION - 1);
		$this->assertFalse($s->isCurrent($old));
		$this->assertTrue($s->mayRetry($old));
	}

	/** @return array<string, array{string}> */
	public static function unknownNames(): array {
		return ['leading zero' => ['page-01'], 'path' => ['page-../x'], 'zero' => ['page-0'], 'midi' => ['midi'], 'empty' => ['']];
	}

	#[DataProvider('unknownNames')]
	public function testArtifactNamesAreAnAllowlist(string $name): void {
		$folder = $this->createMock(ISimpleFolder::class);
		$folder->method('getFolder')->willReturnSelf();
		$this->appData->method('getFolder')->willReturn($folder);
		$this->expectException(NotFoundException::class);
		$this->service()->getArtifact($this->variant(ScoreConversion::STATUS_READY, 10), $name);
	}

	public function testAPageAndTheJsonFilesResolve(): void {
		$file = $this->createMock(ISimpleFile::class);
		$folder = $this->createMock(ISimpleFolder::class);
		$folder->method('getFolder')->willReturnSelf();
		$folder->method('getFile')->willReturnCallback(fn (string $n) => in_array($n, ['page-3.svg', 'timing.json'], true) ? $file : throw new NotFoundException($n));
		$this->appData->method('getFolder')->willReturn($folder);
		$v = $this->variant(ScoreConversion::STATUS_READY, 10);
		$this->assertSame([$file, 'image/svg+xml'], $this->service()->getArtifact($v, 'page-3'));
		$this->assertSame([$file, 'application/json'], $this->service()->getArtifact($v, 'timing'));
	}

	public function testTheLeastRecentlyReadGoBeyondTheCap(): void {
		$folder = $this->createMock(ISimpleFolder::class);
		$folder->method('getFolder')->willReturnSelf();
		$folder->method('fileExists')->willReturn(false);
		$this->appData->method('getFolder')->willReturn($folder);

		$rows = [];
		for ($i = 0; $i < VariantService::MAX_PER_VERSION + 2; $i++) {
			$rows[] = $this->variant(ScoreConversion::STATUS_READY, 1000 - $i, key: "full~orig~w~{$i}");
		}
		// One still running, oldest of all: not counted, not removed.
		array_unshift($rows, $this->variant(ScoreConversion::STATUS_PROCESSING, 5, key: 'full~orig~c~0'));
		$this->mapper->method('findForVersion')->willReturn($rows);

		$deleted = [];
		$this->mapper->method('delete')->willReturnCallback(function (ScoreVariant $v) use (&$deleted) {
			$deleted[] = $v->getVariant();
			return $v;
		});
		$this->service()->markReady($this->variant(ScoreConversion::STATUS_PROCESSING, 0, key: 'full~orig~w~9'), ['<svg/>'], '{}', '{}', '{}', 'v4.7.5-engine.6');

		$this->assertSame(['full~orig~w~0', 'full~orig~w~1'], $deleted);
	}
}
