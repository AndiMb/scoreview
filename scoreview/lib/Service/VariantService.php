<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Db\ScoreVariant;
use OCA\ScoreView\Db\ScoreVariantMapper;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\DB\Exception as DbException;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFile;

/**
 * The cache of display variants (docs/architecture.md E19) and their status
 * rows. A variant lives under the folder of its score version:
 *
 *     appdata_<id>/scoreview/<fileId>/<etag>/v/<variant key>/{page-N.svg, timing.json, measures.json, meta.json}
 *
 * so everything that removes a version - gcOldVersions, deleteAllForFile,
 * reconvert, the trash listener - takes its variants with it. The rows
 * follow through deleteForVersion()/deleteForFile(), which ConversionService
 * calls at those same places.
 *
 * No MIDI: a variant plays the base conversion's. Folders, page names and
 * the artifact allowlist go through ArtifactStore, as for the base.
 */
class VariantService {
	/** Raise with every change of the variant cache format, like ConversionService::CURRENT_FORMAT_VERSION. */
	public const FORMAT_VERSION = 1;

	/**
	 * Variants kept per score version (S4). Each is a full set of pages, and
	 * the four axes multiply: without a cap, a score read in many ways would
	 * grow its cache without end. The least recently used one goes first.
	 */
	public const MAX_PER_VERSION = 8;

	/**
	 * A run is a child process with a hard time limit (LocalConverter,
	 * `local_timeout`, 120 s by default), started inside the request. A row
	 * still `processing` well past that has no run behind it any more.
	 */
	public const STALE_AFTER_SECONDS = 300;

	/**
	 * A failed variant is not tried again on every request - the score has not
	 * changed, and the run would fail the same way. After this long it may,
	 * in case the cause was the server (load, a timeout).
	 */
	public const RETRY_ERROR_AFTER_SECONDS = 3600;

	/**
	 * Errors that say nothing about the score: a busy or unreachable sidecar,
	 * or a path that engraved no variants (an image from before the engine
	 * renderer, MuseScore chosen at the time). The next request may try
	 * again much sooner - the cause may already be gone.
	 */
	private const TRANSIENT_ERRORS = [
		ScoreConversion::ERROR_SIDECAR_BUSY,
		ScoreConversion::ERROR_SIDECAR_UNREACHABLE,
		ScoreVariant::ERROR_UNSUPPORTED,
	];
	public const RETRY_TRANSIENT_AFTER_SECONDS = 60;

	/** accessed_at is written at most this often, so reading a variant is not a write each time. */
	private const TOUCH_EVERY_SECONDS = 3600;

	private const TIMING_FILE = 'timing.json';
	private const MEASURES_FILE = 'measures.json';
	private const META_FILE = 'meta.json';

	/** The variant folders' parent inside a version's folder. */
	private const VARIANTS_FOLDER = 'v';

	/** Names the artifact route serves, as for the base (ConversionService::ARTIFACTS) - without midi. */
	public const ARTIFACTS = [
		'timing' => [self::TIMING_FILE, 'application/json'],
		'measures' => [self::MEASURES_FILE, 'application/json'],
		'meta' => [self::META_FILE, 'application/json'],
	];

	public function __construct(
		private ScoreVariantMapper $mapper,
		private ArtifactStore $store,
		private ITimeFactory $time,
	) {
	}

	public function find(int $fileId, string $etag, string $key): ?ScoreVariant {
		return $this->mapper->findOne($fileId, $etag, $key);
	}

	/**
	 * Takes the run for a variant. The unique index on (file_id, etag,
	 * variant) is the lock: of two requests for the same variant at once,
	 * one inserts and runs, the other gets null and reports `pending`.
	 */
	public function claim(int $fileId, string $etag, string $key): ?ScoreVariant {
		$now = $this->now();
		$variant = new ScoreVariant();
		$variant->setFileId($fileId);
		$variant->setEtag($etag);
		$variant->setVariant($key);
		$variant->setStatus(ScoreConversion::STATUS_PROCESSING);
		$variant->setCreatedAt($now);
		$variant->setUpdatedAt($now);
		$variant->setAccessedAt($now);
		try {
			return $this->mapper->insert($variant);
		} catch (DbException $e) {
			if ($e->getReason() === DbException::REASON_UNIQUE_CONSTRAINT_VIOLATION) {
				return null;
			}
			throw $e;
		}
	}

	/**
	 * Takes over a row whose run died or whose error may be retried. Not a
	 * lock in itself; two requests could both get here for the same dead
	 * row, and both would write the same artifacts.
	 */
	public function restart(ScoreVariant $variant): ScoreVariant {
		$variant->setStatus(ScoreConversion::STATUS_PROCESSING);
		$variant->setErrorCode(null);
		$variant->setErrorMessage(null);
		$variant->setUpdatedAt($this->now());
		return $this->mapper->update($variant);
	}

	/**
	 * @param string[] $pageSvgs
	 */
	public function markReady(ScoreVariant $variant, array $pageSvgs, string $timingJson, string $measuresJson, string $metaJson, string $engine): void {
		// The version's folder must exist already - the base was written
		// before any variant of it can be asked for (VariantController).
		$this->store->folder((string)$variant->getFileId(), $variant->getEtag());
		$folder = $this->store->folderOrCreate(...$this->path($variant->getFileId(), $variant->getEtag(), $variant->getVariant()));
		$this->store->writePages($folder, $pageSvgs);
		$this->store->writeFile($folder, self::TIMING_FILE, $timingJson);
		$this->store->writeFile($folder, self::MEASURES_FILE, $measuresJson);
		$this->store->writeFile($folder, self::META_FILE, $metaJson);
		$variant->setPageCount(count($pageSvgs));
		$variant->setEngine(substr($engine, 0, 64));
		$variant->setFormatVersion(self::FORMAT_VERSION);
		$variant->setStatus(ScoreConversion::STATUS_READY);
		$variant->setUpdatedAt($this->now());
		$this->mapper->update($variant);
		$this->evict($variant->getFileId(), $variant->getEtag());
	}

	public function markError(ScoreVariant $variant, string $message, string $errorCode): void {
		$variant->setStatus(ScoreConversion::STATUS_ERROR);
		$variant->setErrorCode($errorCode);
		$variant->setErrorMessage(mb_substr($message, 0, 1000));
		$variant->setUpdatedAt($this->now());
		$this->mapper->update($variant);
	}

	public function isCurrent(ScoreVariant $variant): bool {
		return $variant->getStatus() === ScoreConversion::STATUS_READY
			&& $variant->getFormatVersion() === self::FORMAT_VERSION;
	}

	/** Is anyone still working on this row? */
	public function isRunning(ScoreVariant $variant): bool {
		return in_array($variant->getStatus(), [ScoreConversion::STATUS_PENDING, ScoreConversion::STATUS_PROCESSING], true)
			&& $this->age($variant) <= self::STALE_AFTER_SECONDS;
	}

	public function mayRetry(ScoreVariant $variant): bool {
		if ($variant->getStatus() === ScoreConversion::STATUS_ERROR) {
			$wait = in_array($variant->getErrorCode(), self::TRANSIENT_ERRORS, true)
				? self::RETRY_TRANSIENT_AFTER_SECONDS
				: self::RETRY_ERROR_AFTER_SECONDS;
			return $this->age($variant) > $wait;
		}
		// Ready in an older format, or a dead run.
		return !$this->isCurrent($variant) && !$this->isRunning($variant);
	}

	/** Records a read, for the eviction - at most once an hour per variant. */
	public function touch(ScoreVariant $variant): void {
		$last = $variant->getAccessedAt();
		if ($last !== null && ($this->time->getTime() - $last->getTimestamp()) < self::TOUCH_EVERY_SECONDS) {
			return;
		}
		$variant->setAccessedAt($this->now());
		$this->mapper->update($variant);
	}

	/**
	 * @return array{0: ISimpleFile, 1: string} file and MIME type
	 * @throws NotFoundException for an unknown name or a missing file
	 */
	public function getArtifact(ScoreVariant $variant, string $name): array {
		return $this->store->artifact($name, self::ARTIFACTS,
			fn () => $this->store->folder(...$this->path($variant->getFileId(), $variant->getEtag(), $variant->getVariant())));
	}

	/** All variants of one score version, files and rows - when its base is written anew or goes. */
	public function deleteForVersion(int $fileId, string $etag): void {
		// A version of which no variant was ever made has no folder - fine.
		$this->store->delete((string)$fileId, $etag, self::VARIANTS_FOLDER);
		$this->mapper->deleteForVersion($fileId, $etag);
	}

	/** The rows of all versions; the files go with the file's folder (ConversionService::deleteAllForFile). */
	public function deleteRowsForFile(int $fileId): void {
		$this->mapper->deleteForFile($fileId);
	}

	/**
	 * Keeps the MAX_PER_VERSION most recently read variants of a version.
	 * Rows that are still running are not counted and not removed.
	 */
	private function evict(int $fileId, string $etag): void {
		$done = array_values(array_filter(
			$this->mapper->findForVersion($fileId, $etag),
			fn (ScoreVariant $v) => !$this->isRunning($v),
		));
		$excess = count($done) - self::MAX_PER_VERSION;
		for ($i = 0; $i < $excess; $i++) {
			$old = $done[$i];
			// An error row has no folder - fine.
			$this->store->delete(...$this->path($fileId, $etag, $old->getVariant()));
			$this->mapper->delete($old);
		}
	}

	private function age(ScoreVariant $variant): int {
		return $this->time->getTime() - $variant->getUpdatedAt()->getTimestamp();
	}

	private function now(): \DateTime {
		return (new \DateTime())->setTimestamp($this->time->getTime());
	}

	/** @return list<string> the folder of one variant, below ArtifactStore::ROOT */
	private function path(int $fileId, string $etag, string $key): array {
		return [(string)$fileId, $etag, self::VARIANTS_FOLDER, $key];
	}
}
