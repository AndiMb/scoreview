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
 * markReady() derselben fileId aufgeräumt (gcOldVersions) - ohne das wüchse
 * der Cache unbegrenzt.
 */
class ConversionService {
	private const MIDI_FILE = 'score.mid';
	private const TIMING_FILE = 'timing.json';
	private const MEASURES_FILE = 'measures.json';
	private const META_FILE = 'meta.json';

	/**
	 * Erhoehen bei jedem Cache-Formatwechsel - `status()`/`serveCachedFile()`
	 * behandeln einen Datensatz mit kleinerer `format_version` dann
	 * automatisch wie "nicht fertig" statt Cache-Dateien eines nicht mehr
	 * passenden Formats auszuliefern oder mit 500 zu enden.
	 *
	 * 2: Die SVG-Seiten tragen die Segment-, Notenzeilen- und
	 *    Stimmenkennung (M10), auf der die Hervorhebung des klingenden
	 *    Notenkopfs aufsetzt. Ohne die Erhoehung blieben vorhandene
	 *    Konvertierungen ohne Kennungen im Cache stehen, und der Viewer
	 *    fiele fuer sie dauerhaft auf das Cursor-Band zurueck - ohne dass
	 *    jemand sieht, warum.
	 */
	public const CURRENT_FORMAT_VERSION = 2;

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

	public function markError(ScoreConversion $conversion, string $message, string $errorCode = ScoreConversion::ERROR_UNKNOWN): void {
		$conversion->setErrorMessage($message);
		$conversion->setErrorCode($errorCode);
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
		$conversion->setFormatVersion(self::CURRENT_FORMAT_VERSION);
		$this->updateStatus($conversion, ScoreConversion::STATUS_READY);
		$this->gcOldVersions($conversion->getFileId(), $conversion->getEtag());
	}

	/** Siehe CURRENT_FORMAT_VERSION. */
	public function isCurrentFormat(ScoreConversion $conversion): bool {
		return $conversion->getFormatVersion() === self::CURRENT_FORMAT_VERSION;
	}

	private function updateStatus(ScoreConversion $conversion, string $status): void {
		$conversion->setStatus($status);
		$conversion->setUpdatedAt(new \DateTime());
		$this->mapper->update($conversion);
	}

	/** Aus meta.json (`metadata.pages` von MuseScore) statt einer eigenen Spalte. */
	public function getPageCount(int $fileId, string $etag): int {
		$meta = json_decode($this->getMetaJsonFile($fileId, $etag)->getContent(), true);
		return (int)($meta['pages'] ?? 0);
	}

	/**
	 * Die auslieferbaren Artefakte als Allowlist: Name aus der URL ->
	 * [Dateiname im Cache, MIME-Typ]. Vermeidet fuenf fast identische Getter
	 * hier, fuenf fast identische Controller-Methoden und fuenf fast
	 * identische Flask-Handler im Sidecar - zusammen rund 120 Zeilen, die
	 * sich nur in Dateiname und MIME-Typ unterschieden. Ein weiteres
	 * Artefakt (etwa ein zweites serverseitiges Layout) ist damit nur ein
	 * Eintrag in dieser Tabelle statt sechs neuer Methoden.
	 *
	 * Bewusst eine Allowlist und kein Dateipfad: der Name kommt aus der URL.
	 * Seiten werden getrennt behandelt, weil sie eine Nummer tragen (siehe
	 * getArtifact()).
	 */
	public const ARTIFACTS = [
		'midi' => [self::MIDI_FILE, 'audio/midi'],
		'timing' => [self::TIMING_FILE, 'application/json'],
		'measures' => [self::MEASURES_FILE, 'application/json'],
		'meta' => [self::META_FILE, 'application/json'],
	];

	/**
	 * Ein Artefakt aus dem Cache, adressiert ueber seinen Namen aus der URL:
	 * `page-3` oder einer der Schluessel aus ARTIFACTS.
	 *
	 * @return array{0: ISimpleFile, 1: string} Datei und MIME-Typ
	 * @throws NotFoundException wenn der Name unbekannt ist oder die Datei fehlt
	 */
	public function getArtifact(int $fileId, string $etag, string $name): array {
		if (str_starts_with($name, 'page-')) {
			$number = substr($name, strlen('page-'));
			// Streng auf Ziffern pruefen: `page-01`, `page-1.5` oder
			// `page-../x` duerfen nicht ueber eine (int)-Kastung durchrutschen.
			if ($number === '' || !ctype_digit($number) || (int)$number < 1) {
				throw new NotFoundException("Unbekanntes Artefakt: {$name}");
			}
			return [
				$this->getFolder($fileId, $etag)->getFile($this->pageFileName((int)$number)),
				'image/svg+xml',
			];
		}
		if (!isset(self::ARTIFACTS[$name])) {
			throw new NotFoundException("Unbekanntes Artefakt: {$name}");
		}
		[$fileName, $mimeType] = self::ARTIFACTS[$name];
		return [$this->getFolder($fileId, $etag)->getFile($fileName), $mimeType];
	}

	/** Eigener Zugriff, weil auch getPageCount() und der AnnotationController ihn brauchen. */
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
	 * Löscht ALLES zu einer fileId - Cache-Ordner und Statuszeilen aller
	 * etag-Versionen. Ohne dieses Aufräumen hinterließe eine gelöschte
	 * Partitur ihren IAppData-Ordner (bei fünf Seiten über 1 MB) und ihre
	 * DB-Zeilen für immer. Aufgerufen aus Listener\NodeDeletedListener und,
	 * als Netz für verpasste Ereignisse, aus BackgroundJob\CleanupOrphansJob.
	 */
	public function deleteAllForFile(int $fileId): void {
		try {
			$this->appData->getFolder('scoreview')->getFolder((string)$fileId)->delete();
		} catch (NotFoundException) {
			// Nie konvertiert worden - nichts aufzuraeumen.
		}
		foreach ($this->mapper->findAllByFileId($fileId) as $conversion) {
			$this->mapper->delete($conversion);
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
