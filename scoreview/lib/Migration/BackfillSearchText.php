<?php

declare(strict_types=1);

namespace OCA\ScoreView\Migration;

use OCA\ScoreView\Db\ScoreConversionMapper;
use OCA\ScoreView\Service\ConversionService;
use OCP\Migration\IOutput;
use OCP\Migration\IRepairStep;
use Psr\Log\LoggerInterface;

/**
 * Fills title, composer and the searched text (E17) for scores converted
 * before those columns existed, from the meta.json they already have.
 *
 * Instead of raising CURRENT_FORMAT_VERSION: that would re-convert every
 * score of the instance for three text columns - minutes of MuseScore per
 * score against one small file read here.
 *
 * Repeatable and forgiving: it only touches rows whose `search_text` is
 * still NULL, and a meta.json that cannot be read is logged and skipped -
 * the score then just is not found by its title until its next conversion.
 * A score without any title or composer stays NULL and is read again on the
 * next update, which costs one small read.
 */
class BackfillSearchText implements IRepairStep {
	private const BATCH = 200;

	public function __construct(
		private ScoreConversionMapper $mapper,
		private ConversionService $conversions,
		private LoggerInterface $logger,
	) {
	}

	public function getName(): string {
		return 'Fill title and composer of converted scores for the search';
	}

	public function run(IOutput $output): void {
		$filled = 0;
		$failed = 0;
		$afterId = 0;
		do {
			$rows = $this->mapper->findReadyWithoutSearchText($afterId, self::BATCH);
			foreach ($rows as $row) {
				$afterId = max($afterId, (int)$row->getId());
				try {
					$meta = $this->conversions->getMetaJsonFile($row->getFileId(), $row->getEtag())->getContent();
					$this->conversions->applySearchFields($row, $meta);
					if ($row->getSearchText() !== null) {
						$this->mapper->update($row);
						$filled++;
					}
				} catch (\Throwable $e) {
					$failed++;
					$this->logger->info('ScoreView: no search text for file {fileId}: {message}', [
						'fileId' => $row->getFileId(),
						'message' => $e->getMessage(),
						'app' => 'scoreview',
					]);
				}
			}
		} while (count($rows) === self::BATCH);

		$output->info(sprintf('ScoreView: search text filled for %d score(s), %d without readable metadata.', $filled, $failed));
	}
}
