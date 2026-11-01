<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Migration;

use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Db\ScoreConversionMapper;
use OCA\ScoreView\Migration\BackfillScoreCounts;
use OCA\ScoreView\Service\ArtifactStore;
use OCA\ScoreView\Service\ConversionBackend;
use OCA\ScoreView\Service\ConversionService;
use OCA\ScoreView\Service\LocalConverter;
use OCA\ScoreView\Service\VariantService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\IAppData;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFile;
use OCP\Migration\IOutput;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * The repair step that fills page and measure count of scores converted
 * before the columns, without converting them again.
 */
class BackfillScoreCountsTest extends TestCase {
	private ScoreConversionMapper&MockObject $mapper;
	private ConversionService&MockObject $conversions;

	protected function setUp(): void {
		$this->mapper = $this->createMock(ScoreConversionMapper::class);
		// A partial mock: the real applyCounts(), only the file read is faked.
		$this->conversions = $this->getMockBuilder(ConversionService::class)
			->setConstructorArgs([$this->mapper, new ArtifactStore($this->createMock(IAppData::class)), $this->createMock(ITimeFactory::class), $this->createMock(VariantService::class), $this->createMock(ConversionBackend::class), $this->createMock(LocalConverter::class)])
			->onlyMethods(['getMetaJsonFile'])
			->getMock();
	}

	private function row(int $id): ScoreConversion {
		$row = new ScoreConversion();
		$row->setId($id);
		$row->setFileId($id * 10);
		$row->setEtag('e' . $id);
		return $row;
	}

	private function meta(string $json): ISimpleFile {
		$file = $this->createMock(ISimpleFile::class);
		$file->method('getContent')->willReturn($json);
		return $file;
	}

	public function testFillsFromMetaAndSkipsWhatCannotBeRead(): void {
		$this->mapper->method('findReadyWithoutPageCount')->with(0, 200)
			->willReturn([$this->row(3), $this->row(4), $this->row(5)]);
		$this->conversions->method('getMetaJsonFile')->willReturnCallback(fn (int $fileId) => match ($fileId) {
			30 => $this->meta('{"pages":2,"measures":40}'),
			40 => throw new NotFoundException('gone'),
			50 => $this->meta('{}'),
		});
		$updated = [];
		$this->mapper->method('update')->willReturnCallback(function (ScoreConversion $row) use (&$updated) {
			$updated[] = [$row->getFileId(), $row->getPageCount(), $row->getMeasureCount()];
			return $row;
		});
		$output = $this->createMock(IOutput::class);
		$output->expects($this->once())->method('info')->with($this->stringContains('filled for 1 score(s), 1 without'));

		(new BackfillScoreCounts($this->mapper, $this->conversions, $this->createMock(LoggerInterface::class)))->run($output);

		// File 50 names neither count: nothing to write, getPageCount() reads it later.
		$this->assertSame([[30, 2, 40]], $updated);
	}

	public function testWalksInBatchesByIdUntilAShortBatch(): void {
		$full = array_map(fn (int $i) => $this->row($i), range(1, 200));
		$calls = [];
		$this->mapper->method('findReadyWithoutPageCount')->willReturnCallback(function (int $afterId) use (&$calls, $full) {
			$calls[] = $afterId;
			return $afterId === 0 ? $full : [$this->row(201)];
		});
		$this->conversions->method('getMetaJsonFile')->willReturn($this->meta('{"pages":1}'));

		(new BackfillScoreCounts($this->mapper, $this->conversions, $this->createMock(LoggerInterface::class)))->run($this->createMock(IOutput::class));

		$this->assertSame([0, 200], $calls);
	}
}
