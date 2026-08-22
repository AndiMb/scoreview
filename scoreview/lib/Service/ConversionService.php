<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Db\ScoreConversionMapper;
use OCP\Files\IAppData;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFolder;

/**
 * Cached konvertierte Dateien nach fileId+etag in IAppData
 * (appdata_<instanceid>/scoreview/<fileId>/<etag>/{score.musicxml,audio.mp3,timing.json}),
 * und verwaltet den zugehörigen Status-Datensatz. Ein Re-Upload/eine
 * Bearbeitung ändert den etag und landet damit automatisch in einem neuen
 * Unterordner statt den Cache einer älteren Version zu überschreiben; alte
 * Unterordner werden für den Prototyp nicht aktiv aufgeräumt (kein GC nötig,
 * kleine Testpartituren, siehe Plan Risiko 8).
 */
class ConversionService {
	private const MUSICXML_FILE = 'score.musicxml';
	private const AUDIO_FILE = 'audio.mp3';
	private const TIMING_FILE = 'timing.json';

	public function __construct(
		private ScoreConversionMapper $mapper,
		private IAppData $appData,
	) {
	}

	public function find(int $fileId, string $etag): ?ScoreConversion {
		return $this->mapper->findByFileIdAndEtag($fileId, $etag);
	}

	public function createPending(int $fileId, string $etag): ScoreConversion {
		$now = new \DateTime();
		$conversion = new ScoreConversion();
		$conversion->setFileId($fileId);
		$conversion->setEtag($etag);
		$conversion->setStatus(ScoreConversion::STATUS_PENDING);
		$conversion->setCreatedAt($now);
		$conversion->setUpdatedAt($now);
		return $this->mapper->insert($conversion);
	}

	public function markProcessing(ScoreConversion $conversion): void {
		$this->updateStatus($conversion, ScoreConversion::STATUS_PROCESSING);
	}

	public function markError(ScoreConversion $conversion, string $message): void {
		$conversion->setErrorMessage($message);
		$this->updateStatus($conversion, ScoreConversion::STATUS_ERROR);
	}

	public function markReady(ScoreConversion $conversion, string $musicxml, string $audio, string $timingJson): void {
		$folder = $this->getOrCreateFolder($conversion->getFileId(), $conversion->getEtag());
		$this->writeFile($folder, self::MUSICXML_FILE, $musicxml);
		$this->writeFile($folder, self::AUDIO_FILE, $audio);
		$this->writeFile($folder, self::TIMING_FILE, $timingJson);
		$this->updateStatus($conversion, ScoreConversion::STATUS_READY);
	}

	private function updateStatus(ScoreConversion $conversion, string $status): void {
		$conversion->setStatus($status);
		$conversion->setUpdatedAt(new \DateTime());
		$this->mapper->update($conversion);
	}

	public function getMusicXml(int $fileId, string $etag): string {
		return $this->readFile($fileId, $etag, self::MUSICXML_FILE);
	}

	public function getAudio(int $fileId, string $etag): string {
		return $this->readFile($fileId, $etag, self::AUDIO_FILE);
	}

	public function getTimingJson(int $fileId, string $etag): string {
		return $this->readFile($fileId, $etag, self::TIMING_FILE);
	}

	private function readFile(int $fileId, string $etag, string $name): string {
		try {
			return $this->getFolder($fileId, $etag)->getFile($name)->getContent();
		} catch (NotFoundException $e) {
			throw new \RuntimeException("Cache-Datei {$name} fehlt für fileId={$fileId} etag={$etag}", 0, $e);
		}
	}

	private function writeFile(ISimpleFolder $folder, string $name, string $content): void {
		if ($folder->fileExists($name)) {
			$folder->getFile($name)->putContent($content);
			return;
		}
		$folder->newFile($name, $content);
	}

	private function getFolder(int $fileId, string $etag): ISimpleFolder {
		return $this->appData
			->getFolder('scoreview')
			->getFolder((string)$fileId)
			->getFolder($etag);
	}

	private function getOrCreateFolder(int $fileId, string $etag): ISimpleFolder {
		$root = $this->getOrCreateRootFolder();
		$byFile = $this->getOrCreateSubfolder($root, (string)$fileId);
		return $this->getOrCreateSubfolder($byFile, $etag);
	}

	private function getOrCreateRootFolder(): ISimpleFolder {
		try {
			return $this->appData->getFolder('scoreview');
		} catch (NotFoundException) {
			return $this->appData->newFolder('scoreview');
		}
	}

	private function getOrCreateSubfolder(ISimpleFolder $parent, string $name): ISimpleFolder {
		try {
			return $parent->getFolder($name);
		} catch (NotFoundException) {
			return $parent->newFolder($name);
		}
	}
}
