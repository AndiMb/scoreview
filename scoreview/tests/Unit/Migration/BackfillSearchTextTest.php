<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Migration;

use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Db\ScoreConversionMapper;
use OCA\ScoreView\Migration\BackfillSearchText;
use OCA\ScoreView\Service\ConversionService;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\IAppData;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFile;
use OCP\Migration\IOutput;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

/**
 * The repair step that makes existing scores findable without converting
 * them again (E17).
 */
class BackfillSearchTextTest extends TestCase {
	private ScoreConversionMapper&MockObject $mapper;
	private ConversionService&MockObject $conversions;

	protected function setUp(): void {
		$this->mapper = $this->createMock(ScoreConversionMapper::class);
		// A partial mock: the real applySearchFields(), only the file read is faked.
		$this->conversions = $this->getMockBuilder(ConversionService::class)
			->setConstructorArgs([$this->mapper, $this->createMock(IAppData::class), $this->createMock(ITimeFactory::class)])
			->onlyMethods(['getMetaJsonFile'])
			->getMock();
	}

	private function row(int $id, int $fileId): ScoreConversion {
		$row = new ScoreConversion();
		$row->setId($id);
		$row->setFileId($fileId);
		$row->setEtag('e' . $fileId);
		return $row;
	}

	private function meta(string $json): ISimpleFile {
		$file = $this->createMock(ISimpleFile::class);
		$file->method('getContent')->willReturn($json);
		return $file;
	}

	public function testFillsFromMetaAndSkipsWhatCannotBeRead(): void {
		$this->mapper->method('findReadyWithoutSearchText')->with(0, 200)
			->willReturn([$this->row(3, 30), $this->row(4, 40), $this->row(5, 50)]);
		$this->conversions->method('getMetaJsonFile')->willReturnCallback(fn (int $fileId) => match ($fileId) {
			30 => $this->meta('{"title":"Aequale No. 1","composer":"Anton Bruckner"}'),
			40 => throw new NotFoundException('gone'),
			50 => $this->meta('{"title":"","composer":""}'),
		});
		$updated = [];
		$this->mapper->method('update')->willReturnCallback(function (ScoreConversion $row) use (&$updated) {
			$updated[] = [$row->getFileId(), $row->getSearchText()];
			return $row;
		});
		$output = $this->createMock(IOutput::class);
		$output->expects($this->once())->method('info')->with($this->stringContains('filled for 1 score(s), 1 without'));

		(new BackfillSearchText($this->mapper, $this->conversions, $this->createMock(LoggerInterface::class)))->run($output);

		// File 50 has no title at all: nothing to write.
		$this->assertSame([[30, 'aequale no. 1 anton bruckner']], $updated);
	}

	public function testWalksInBatchesByIdUntilAShortBatch(): void {
		$full = array_map(fn (int $i) => $this->row($i, $i), range(1, 200));
		$calls = [];
		$this->mapper->method('findReadyWithoutSearchText')->willReturnCallback(function (int $afterId) use (&$calls, $full) {
			$calls[] = $afterId;
			return $afterId === 0 ? $full : [$this->row(201, 201)];
		});
		$this->conversions->method('getMetaJsonFile')->willReturn($this->meta('{"title":"T"}'));

		(new BackfillSearchText($this->mapper, $this->conversions, $this->createMock(LoggerInterface::class)))->run($this->createMock(IOutput::class));

		$this->assertSame([0, 200], $calls);
	}
}
