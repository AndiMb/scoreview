<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Db\ScoreConversionMapper;
use OCP\Files\IAppData;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFile;
use OCP\Files\SimpleFS\ISimpleFolder;

/**
 * Cached konvertierte Dateien nach fileId+etag in IAppData
 * (appdata_<instanceid>/scoreview/<fileId>/<etag>/{page-1.svg…page-N.svg,score.mid,timing.json,measures.json,meta.json}),
 * und verwaltet den zugehörigen Status-Datensatz. Ein Re-Upload/eine
 * Bearbeitung ändert den etag und landet damit automatisch in einem neuen
 * Unterordner statt den Cache einer älteren Version zu überschreiben; der
 * alte Unterordner (und sein DB-Datensatz) wird beim nächsten erfolgreichen
 * markReady() derselben fileId aufgeräumt (gcOldVersions) - vorher (Phase 3)
 * wuchs das unbegrenzt, siehe PLAN.md Phase 7.
 */
class ConversionService {
	private const MIDI_FILE = 'score.mid';
	private const TIMING_FILE = 'timing.json';
	private const MEASURES_FILE = 'measures.json';
	private const META_FILE = 'meta.json';

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

	/**
	 * @param string[] $pageSvgs Seiteninhalte, 1-indiziert in Reihenfolge.
	 */
	public function markReady(ScoreConversion $conversion, array $pageSvgs, string $midi, string $timingJson, string $measuresJson, string $metaJson): void {
		$folder = $this->getOrCreateFolder($conversion->getFileId(), $conversion->getEtag());
		foreach (array_values($pageSvgs) as $i => $svg) {
			$this->writeFile($folder, $this->pageFileName($i + 1), $svg);
		}
		$this->writeFile($folder, self::MIDI_FILE, $midi);
		$this->writeFile($folder, self::TIMING_FILE, $timingJson);
		$this->writeFile($folder, self::MEASURES_FILE, $measuresJson);
		$this->writeFile($folder, self::META_FILE, $metaJson);
		$this->updateStatus($conversion, ScoreConversion::STATUS_READY);
		$this->gcOldVersions($conversion->getFileId(), $conversion->getEtag());
	}

	private function updateStatus(ScoreConversion $conversion, string $status): void {
		$conversion->setStatus($status);
		$conversion->setUpdatedAt(new \DateTime());
		$this->mapper->update($conversion);
	}

	/** Aus meta.json (`metadata.pages` von MuseScore) statt einer eigenen Spalte - siehe PLAN.md Phase 7. */
	public function getPageCount(int $fileId, string $etag): int {
		$meta = json_decode($this->getMetaJsonFile($fileId, $etag)->getContent(), true);
		return (int)($meta['pages'] ?? 0);
	}

	public function getPage(int $fileId, string $etag, int $pageNumber): ISimpleFile {
		return $this->getFolder($fileId, $etag)->getFile($this->pageFileName($pageNumber));
	}

	public function getMidi(int $fileId, string $etag): ISimpleFile {
		return $this->getFolder($fileId, $etag)->getFile(self::MIDI_FILE);
	}

	public function getTimingJson(int $fileId, string $etag): ISimpleFile {
		return $this->getFolder($fileId, $etag)->getFile(self::TIMING_FILE);
	}

	public function getMeasuresJson(int $fileId, string $etag): ISimpleFile {
		return $this->getFolder($fileId, $etag)->getFile(self::MEASURES_FILE);
	}

	public function getMetaJsonFile(int $fileId, string $etag): ISimpleFile {
		return $this->getFolder($fileId, $etag)->getFile(self::META_FILE);
	}

	private function pageFileName(int $pageNumber): string {
		return "page-{$pageNumber}.svg";
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

	/**
	 * Löscht Cache-Ordner und DB-Zeile jeder anderen (aelteren) etag-Version
	 * derselben fileId. ISimpleFolder::getDirectoryListing() listet nur
	 * Dateien, keine Unterordner (Kern-Implementierung filtert Folder-Nodes
	 * heraus) - deshalb ueber die DB gehen statt ueber eine
	 * Verzeichnisauflistung des fileId-Ordners.
	 */
	private function gcOldVersions(int $fileId, string $currentEtag): void {
		foreach ($this->mapper->findAllByFileId($fileId) as $old) {
			if ($old->getEtag() === $currentEtag) {
				continue;
			}
			try {
				$this->appData->getFolder('scoreview')->getFolder((string)$fileId)->getFolder($old->getEtag())->delete();
			} catch (NotFoundException) {
				// Ordner existierte nie (z.B. Konvertierung kam nie bis
				// markReady()) - nichts aufzuraeumen.
			}
			$this->mapper->delete($old);
		}
	}
}
