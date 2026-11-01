<?php

declare(strict_types=1);

namespace OCA\ScoreView\Migration;

use OCA\ScoreView\Db\ScoreConversionMapper;
use OCA\ScoreView\Service\ConversionService;
use OCP\Migration\IOutput;
use OCP\Migration\IRepairStep;
use Psr\Log\LoggerInterface;

/**
 * Fills page and measure count for scores converted before those columns
 * existed (Version000102Date20261101120000), from the meta.json they
 * already have - the same pattern as BackfillSearchText, for the same
 * reason: raising CURRENT_FORMAT_VERSION would convert every score again for
 * two numbers.
 *
 * Repeatable and forgiving: it only touches ready rows whose `page_count` is
 * still NULL, and a meta.json that cannot be read is logged and skipped -
 * ConversionService then reads it on the score's next status poll, as it
 * does for any row this step has not reached.
 */
class BackfillScoreCounts implements IRepairStep {
	private const BATCH = 200;

	public function __construct(
		private ScoreConversionMapper $mapper,
		private ConversionService $conversions,
		private LoggerInterface $logger,
	) {
	}

	public function getName(): string {
		return 'Fill page and measure count of converted scores';
	}

	public function run(IOutput $output): void {
		$filled = 0;
		$failed = 0;
		$afterId = 0;
		do {
			$rows = $this->mapper->findReadyWithoutPageCount($afterId, self::BATCH);
			foreach ($rows as $row) {
				$afterId = max($afterId, (int)$row->getId());
				try {
					$meta = $this->conversions->getMetaJsonFile($row->getFileId(), $row->getEtag())->getContent();
					if ($this->conversions->applyCounts($row, $meta)) {
						$filled++;
					}
				} catch (\Throwable $e) {
					$failed++;
					$this->logger->info('ScoreView: no page count for file {fileId}: {message}', [
						'fileId' => $row->getFileId(),
						'message' => $e->getMessage(),
						'app' => 'scoreview',
					]);
				}
			}
		} while (count($rows) === self::BATCH);

		$output->info(sprintf('ScoreView: page count filled for %d score(s), %d without readable metadata.', $filled, $failed));
	}
}
