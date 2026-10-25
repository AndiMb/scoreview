<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Db\ScoreConversionMapper;
use OCP\AppFramework\Utility\ITimeFactory;
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
	 * 3: meta.json traegt auf dem Engine-Weg `keySigs` (mit Dur/Moll) und
	 *    `rehearsalMarks`. Der Viewer kaeme zwar ohne sie aus (Rueckfall auf
	 *    die MIDI-Marker wie auf dem Sidecar-Weg), bestimmte dann aber den
	 *    Grundton einer Moll-Partitur als Dur-Tonika. Mit der Erhoehung konvertiert
	 *    status() eine vorhandene Partitur beim naechsten Oeffnen neu, statt
	 *    dass sie nur mit „Neu konvertieren" zu den Feldern kaeme.
	 * 4: meta.json traegt auf dem Engine-Weg `lyricSyllables` und
	 *    `noteSpellings` (E15). Ohne Erhoehung boten vorhandene Konvertierungen
	 *    Liedtext-Ansicht und Tonnamen nie an - der Viewer entscheidet am
	 *    Inhalt, und dort fehlten die Listen, obwohl der Server sie liefern kann.
	 * 5: meta.json carries `measureFacts` (time signature and length per
	 *    measure) and a `tick` per noteSpellings entry (E12). The metronome
	 *    would otherwise keep estimating beats from the measure's duration,
	 *    and beat numbers over the notes would never be offered, for every
	 *    score converted before - again decided at the content, which lacked
	 *    the fields.
	 * 6: meta.json carries `excerpts` (the parts the file stores) and
	 *    `hasTransposingParts` (E19). The viewer builds its choice of display
	 *    variants from them; without the raise, scores converted before would
	 *    offer no stored part and no concert pitch until someone reconverted
	 *    them. On sidecar instances this converts once for nothing (stock
	 *    MuseScore writes neither field) - one rule for every instance was
	 *    preferred to a second rule that asks which path wrote a row.
	 */
	public const CURRENT_FORMAT_VERSION = 6;

	/**
	 * Wie lange ein Lauf einen Datensatz halten darf, bevor er als tot gilt.
	 *
	 * Grosszuegig gegenueber allem, was ein regulaerer Lauf braucht: Der
	 * Sidecar-Weg gibt nach 300 s selbst auf (ConvertScoreJob::
	 * MAX_TOTAL_SECONDS), der lokale nach `local_timeout` (120 s) - dazu
	 * kommt der Cron-Takt der Instanz, der zwischen zwei Schritten der
	 * Poll-Kette liegt. Die Grenze soll einen toten Lauf einfangen, nicht
	 * eine langsame Instanz bestrafen.
	 */
	public const STALE_AFTER_SECONDS = 1800;

	public function __construct(
		private ScoreConversionMapper $mapper,
		private IAppData $appData,
		private ITimeFactory $time,
		private VariantService $variants,
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

	/**
	 * Zurueck auf `pending`: Der Konvertierungsweg nimmt gerade nichts an,
	 * ein Neuversuch ist eingeplant (BackgroundJob\ConvertScoreJob).
	 * updateStatus() setzt dabei `updated_at` neu - jede Warterunde ist damit
	 * ein Lebenszeichen, und isStale() schlaegt nur zu, wenn die Kette
	 * tatsaechlich abreisst (etwa ein Cron, der nicht mehr laeuft).
	 */
	public function markWaiting(ScoreConversion $conversion): void {
		$this->updateStatus($conversion, ScoreConversion::STATUS_PENDING);
	}

	public function markError(ScoreConversion $conversion, string $message, string $errorCode = ScoreConversion::ERROR_UNKNOWN): void {
		$conversion->setErrorMessage($message);
		$conversion->setErrorCode($errorCode);
		$this->updateStatus($conversion, ScoreConversion::STATUS_ERROR);
	}

	/**
	 * `$backend` ist Pflichtangabe und hat bewusst keinen Standardwert: Wer
	 * Artefakte in den Cache legt, weiss, woher sie kommen - spaeter ist das
	 * aus der Admin-Einstellung nicht mehr rekonstruierbar, die sagt nur,
	 * was JETZT gilt.
	 *
	 * @param string[] $pageSvgs Seiteninhalte, 1-indiziert in Reihenfolge.
	 * @param string $backend Welcher Weg das erzeugt hat (ConversionBackend).
	 */
	public function markReady(ScoreConversion $conversion, array $pageSvgs, string $midi, string $timingJson, string $measuresJson, string $metaJson, string $backend): void {
		// Variants of this version were checked against the base being
		// replaced; a new base (another engine, a reconversion) may number
		// its segments differently, and their mappings would point astray.
		$this->variants->deleteForVersion($conversion->getFileId(), $conversion->getEtag());
		$folder = $this->getOrCreateFolder($conversion->getFileId(), $conversion->getEtag());
		foreach (array_values($pageSvgs) as $i => $svg) {
			$this->writeFile($folder, $this->pageFileName($i + 1), $svg);
		}
		$this->writeFile($folder, self::MIDI_FILE, $midi);
		$this->writeFile($folder, self::TIMING_FILE, $timingJson);
		$this->writeFile($folder, self::MEASURES_FILE, $measuresJson);
		$this->writeFile($folder, self::META_FILE, $metaJson);
		$conversion->setBackend($backend);
		$conversion->setFormatVersion(self::CURRENT_FORMAT_VERSION);
		$this->applySearchFields($conversion, $metaJson);
		$this->updateStatus($conversion, ScoreConversion::STATUS_READY);
		$this->gcOldVersions($conversion->getFileId(), $conversion->getEtag());
	}

	/**
	 * Title, composer and the searched text of a score (E17) from its
	 * meta.json. Both server paths end in markReady() (E3), so this is the one
	 * place that fills them; the repair step BackfillSearchText uses it for
	 * the scores converted before. Cut by BYTES, not characters: a
	 * VARCHAR(1024) is 1024 bytes on Oracle, and four-byte characters would
	 * otherwise overflow it.
	 *
	 * @return array{title: ?string, composer: ?string, searchText: ?string}
	 */
	public static function searchFields(string $metaJson): array {
		try {
			$meta = json_decode($metaJson, true, 512, JSON_THROW_ON_ERROR);
		} catch (\JsonException) {
			$meta = null;
		}
		if (!is_array($meta)) {
			return ['title' => null, 'composer' => null, 'searchText' => null];
		}
		$text = static function (string $key) use ($meta): string {
			$value = $meta[$key] ?? '';
			return is_string($value) ? trim(preg_replace('/\s+/u', ' ', $value) ?? '') : '';
		};
		$cut = static fn (string $value, int $bytes): ?string => $value === '' ? null : rtrim(mb_strcut($value, 0, $bytes, 'UTF-8'));
		$parts = array_filter([$text('title'), $text('subtitle'), $text('composer'), $text('poet')], static fn (string $p) => $p !== '');
		return [
			'title' => $cut($text('title'), 255),
			'composer' => $cut($text('composer'), 255),
			'searchText' => $cut(mb_strtolower(implode(' ', $parts), 'UTF-8'), 1024),
		];
	}

	public function applySearchFields(ScoreConversion $conversion, string $metaJson): void {
		$fields = self::searchFields($metaJson);
		$conversion->setTitle($fields['title']);
		$conversion->setComposer($fields['composer']);
		$conversion->setSearchText($fields['searchText']);
	}

	/** Siehe CURRENT_FORMAT_VERSION. */
	public function isCurrentFormat(ScoreConversion $conversion): bool {
		return $conversion->getFormatVersion() === self::CURRENT_FORMAT_VERSION;
	}

	/**
	 * Haelt diesen Datensatz noch ein Lauf - oder ist der gestorben?
	 *
	 * `pending`/`processing` sagen "jemand arbeitet daran"; ein abgebrochener
	 * PHP-Prozess (OOM-Kill, Cron-Abbruch, Neustart) hinterlaesst diese Zusage
	 * ohne jemanden, der sie einloest. Ohne diese Frage blieb die Partitur
	 * danach unerreichbar: ConvertScoreJob ueberspringt einen laufenden
	 * Datensatz, und „Neu konvertieren" verweigert an ihm - der einzige
	 * Ausweg war ein Eingriff in die Datenbank.
	 *
	 * `updated_at` taugt als Alter des LAUFS, nicht nur der letzten Aenderung:
	 * markProcessing() setzt es einmal, und waehrend der Konvertierung
	 * schreibt niemand fort (PollConversionJob liest nur).
	 */
	public function isStale(ScoreConversion $conversion): bool {
		if (!in_array($conversion->getStatus(), [ScoreConversion::STATUS_PENDING, ScoreConversion::STATUS_PROCESSING], true)) {
			return false;
		}
		return ($this->time->getTime() - $conversion->getUpdatedAt()->getTimestamp()) > self::STALE_AFTER_SECONDS;
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
			// Streng auf Ziffern pruefen: `page-1.5` oder `page-../x` duerfen
			// nicht ueber eine (int)-Kastung durchrutschen.
			//
			// Der Vergleich mit der zurueckgewandelten Zahl haelt zusaetzlich
			// `page-01` draussen. Das ist keine Sicherheitsfrage - es loest auf
			// dieselbe Datei auf wie `page-1` -, sondern eine des Cachings:
			// Jede Auslieferung traegt `immutable`, und dieselbe Seite unter
			// zwei Namen waere zweimal derselbe halbe Megabyte im Browsercache.
			// Erzeugt werden die Namen ohnehin serverseitig (buildFileUrls).
			if ($number === '' || !ctype_digit($number) || (int)$number < 1 || $number !== (string)(int)$number) {
				throw new NotFoundException("Unknown artifact: {$name}");
			}
			return [
				$this->getFolder($fileId, $etag)->getFile($this->pageFileName((int)$number)),
				'image/svg+xml',
			];
		}
		if (!isset(self::ARTIFACTS[$name])) {
			throw new NotFoundException("Unknown artifact: {$name}");
		}
		[$fileName, $mimeType] = self::ARTIFACTS[$name];
		return [$this->getFolder($fileId, $etag)->getFile($fileName), $mimeType];
	}

	/**
	 * An artifact's content - for the variant run, which hands the base's
	 * timing and measures to the converter to check the variant against.
	 *
	 * @throws NotFoundException
	 */
	public function readArtifact(int $fileId, string $etag, string $name): string {
		return $this->getArtifact($fileId, $etag, $name)[0]->getContent();
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
		// Their files went with the folder above.
		$this->variants->deleteRowsForFile($fileId);
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
			$this->variants->deleteForVersion($fileId, $old->getEtag());
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
