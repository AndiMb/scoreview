<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Db\ScoreConversionMapper;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFile;

/**
 * Cached konvertierte Dateien nach fileId+etag in IAppData
 * (appdata_<instanceid>/scoreview/<fileId>/<etag>/{page-1.svg…page-N.svg,score.mid,timing.json,measures.json,meta.json}),
 * und verwaltet den zugehörigen Status-Datensatz. Ein Re-Upload/eine
 * Bearbeitung ändert den etag und landet damit automatisch in einem neuen
 * Unterordner statt den Cache einer älteren Version zu überschreiben; der
 * alte Unterordner (und sein DB-Datensatz) wird beim nächsten erfolgreichen
 * markReady() derselben fileId aufgeräumt (gcOldVersions) - ohne das wüchse
 * der Cache unbegrenzt. Folders and files go through ArtifactStore, which
 * the variants under the same folders share.
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
		private ArtifactStore $store,
		private ITimeFactory $time,
		private VariantService $variants,
		private ConversionBackend $backend,
		private LocalConverter $localConverter,
	) {
	}

	/** Read once per request: isCurrent() runs per score in a set list. */
	private ?string $localEngine = null;

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
	public function markReady(ScoreConversion $conversion, array $pageSvgs, string $midi, string $timingJson, string $measuresJson, string $metaJson, string $backend, ?string $engineVersion): void {
		// Variants of this version were checked against the base being
		// replaced; a new base (another engine, a reconversion) may number
		// its segments differently, and their mappings would point astray.
		$this->variants->deleteForVersion($conversion->getFileId(), $conversion->getEtag());
		$folder = $this->store->folderOrCreate((string)$conversion->getFileId(), $conversion->getEtag());
		$this->store->writePages($folder, $pageSvgs);
		$this->store->writeFile($folder, self::MIDI_FILE, $midi);
		$this->store->writeFile($folder, self::TIMING_FILE, $timingJson);
		$this->store->writeFile($folder, self::MEASURES_FILE, $measuresJson);
		$this->store->writeFile($folder, self::META_FILE, $metaJson);
		$conversion->setBackend($backend);
		$conversion->setEngineVersion($engineVersion === null ? null : substr($engineVersion, 0, 64));
		$conversion->setFormatVersion(self::CURRENT_FORMAT_VERSION);
		$this->applySearchFields($conversion, $metaJson);
		// The pages actually written, not meta.json's own count: they are what
		// the artifact route can serve.
		$conversion->setPageCount(count($pageSvgs));
		$conversion->setMeasureCount(self::countsFromMeta($metaJson)['measureCount']);
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

	/**
	 * Page and measure count from a meta.json (`metadata.pages`/`measures`,
	 * written by both renderers) - for the rows converted before the columns
	 * (BackfillScoreCounts, and the fallback in getPageCount()).
	 *
	 * @return array{pageCount: ?int, measureCount: ?int}
	 */
	public static function countsFromMeta(string $metaJson): array {
		try {
			$meta = json_decode($metaJson, true, 512, JSON_THROW_ON_ERROR);
		} catch (\JsonException) {
			$meta = null;
		}
		$count = static fn (string $key): ?int => is_array($meta) && is_numeric($meta[$key] ?? null) ? (int)$meta[$key] : null;
		return ['pageCount' => $count('pages'), 'measureCount' => $count('measures')];
	}

	/**
	 * Fills page and measure count of a row from its meta.json and stores
	 * them, unless meta.json names neither.
	 *
	 * @return bool whether the row changed
	 */
	public function applyCounts(ScoreConversion $conversion, string $metaJson): bool {
		$counts = self::countsFromMeta($metaJson);
		if ($counts['pageCount'] === null && $counts['measureCount'] === null) {
			return false;
		}
		$conversion->setPageCount($counts['pageCount']);
		$conversion->setMeasureCount($counts['measureCount']);
		$this->mapper->update($conversion);
		return true;
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
	 * Whether a ready entry is what the server would render now - otherwise
	 * opening the score converts it again, like an older format does.
	 *
	 * Beyond the format, the engine: an update of the app usually brings a
	 * newer scoreview-engine, and with it fixes to layout and timing (a volta
	 * that cut the score short, say). Without this a finished conversion kept
	 * the old result until someone pressed "Convert again" on every single
	 * score. Lazily, on opening, and not in a repair step: an instance with
	 * thousands of scores would otherwise convert all of them at once, most
	 * of which nobody opens.
	 *
	 * Only where the comparison is honest: on the local path, for a row that
	 * path rendered, and when the installed engine names its release. A row
	 * of the sidecar stays - the app does not learn which engine or MuseScore
	 * the sidecar runs without asking it, and after a switch of the path a
	 * cached score stays that of the old one (E3). A LOCAL row without a
	 * stamp predates it and counts as older.
	 */
	public function isCurrent(ScoreConversion $conversion): bool {
		if (!$this->isCurrentFormat($conversion)) {
			return false;
		}
		if ($conversion->getBackend() !== ConversionBackend::LOCAL || !$this->backend->isLocal()) {
			return true;
		}
		$this->localEngine ??= $this->localConverter->engineVersion();
		return $this->localEngine === 'unknown' || $conversion->getEngineVersion() === $this->localEngine;
	}

	/**
	 * Whether this score version needs a (new) conversion run - the one rule
	 * for ConvertScoreJob's guard and the set list's warm-up
	 * (SetlistService::preconvert()).
	 *
	 * No row, or a ready one that is not current (isCurrent()): yes. A row
	 * that is pending or processing: no, a run holds it (isStale() decides
	 * when it no longer does). A failed one: yes for the job - opening the
	 * score retries it (ConversionController::status()) - but not with
	 * $retryErrors false, for a warm-up that would otherwise run a broken
	 * score again every time its set list is opened.
	 */
	public function needsConversion(?ScoreConversion $conversion, bool $retryErrors = true): bool {
		if ($conversion === null) {
			return true;
		}
		return match ($conversion->getStatus()) {
			ScoreConversion::STATUS_READY => !$this->isCurrent($conversion),
			ScoreConversion::STATUS_ERROR => $retryErrors,
			default => false,
		};
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

	/**
	 * How many pages a ready conversion has - from its column, read on every
	 * status poll of a ready score. Decoding meta.json for it (up to 250 KB)
	 * was the price before the column; a row from before it is filled once
	 * here, the repair step BackfillScoreCounts does the rest.
	 *
	 * Still checks that the cached files are there: a cache folder removed
	 * behind the app's back must keep ending as "not ready" rather than as
	 * page URLs that all answer 404 (ConversionController::status()).
	 *
	 * @throws NotFoundException when the cache folder or its meta.json is missing
	 */
	public function getPageCount(ScoreConversion $conversion): int {
		$folder = $this->store->folder((string)$conversion->getFileId(), $conversion->getEtag());
		if ($conversion->getPageCount() === null) {
			$this->applyCounts($conversion, $folder->getFile(self::META_FILE)->getContent());
		} elseif (!$folder->fileExists(self::META_FILE)) {
			throw new NotFoundException('meta.json is missing from the cache of file ' . $conversion->getFileId());
		}
		return (int)$conversion->getPageCount();
	}

	/**
	 * How many measures the cached conversion of this version has - for the
	 * notes, which mark those beyond it as orphaned. Null when the score
	 * names none.
	 *
	 * @throws NotFoundException when nothing of this version is cached
	 */
	public function getMeasureCount(int $fileId, string $etag): ?int {
		$conversion = $this->find($fileId, $etag);
		if ($conversion !== null && $conversion->getMeasureCount() !== null) {
			return $conversion->getMeasureCount();
		}
		$metaJson = $this->getMetaJsonFile($fileId, $etag)->getContent();
		if ($conversion !== null && $conversion->getStatus() === ScoreConversion::STATUS_READY) {
			$this->applyCounts($conversion, $metaJson);
		}
		return self::countsFromMeta($metaJson)['measureCount'];
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
		// Which names pass (`page-N` in one spelling only, ARTIFACTS) is
		// ArtifactStore's to say, the same for base and variants.
		return $this->store->artifact($name, self::ARTIFACTS, fn () => $this->store->folder((string)$fileId, $etag));
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

	/** The whole meta.json - for what its columns do not carry (variant choices, the search backfill). */
	public function getMetaJsonFile(int $fileId, string $etag): ISimpleFile {
		return $this->store->folder((string)$fileId, $etag)->getFile(self::META_FILE);
	}

	/**
	 * Löscht ALLES zu einer fileId - Cache-Ordner und Statuszeilen aller
	 * etag-Versionen. Ohne dieses Aufräumen hinterließe eine gelöschte
	 * Partitur ihren IAppData-Ordner (bei fünf Seiten über 1 MB) und ihre
	 * DB-Zeilen für immer. Aufgerufen aus Listener\NodeDeletedListener und,
	 * als Netz für verpasste Ereignisse, aus BackgroundJob\CleanupOrphansJob.
	 */
	public function deleteAllForFile(int $fileId): void {
		$this->store->delete((string)$fileId);
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
			// A folder that never existed (the run never reached markReady())
			// is fine to the store.
			$this->store->delete((string)$fileId, $old->getEtag());
			$this->mapper->delete($old);
		}
	}
}
