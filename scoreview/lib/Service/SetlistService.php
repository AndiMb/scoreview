<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\BackgroundJob\ConvertScoreJob;
use OCA\ScoreView\Db\ScoreConversion;
use OCP\BackgroundJob\IJobList;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\InvalidPathException;
use OCP\Files\IRootFolder;
use OCP\Files\Node;
use OCP\Files\NotFoundException;
use OCP\Files\NotPermittedException;
use OCP\IAppConfig;
use Psr\Log\LoggerInterface;

/**
 * Setlisten auf dem Server (E11): lesen, aufloesen, schreiben,
 * anlegen, und die Suche fuer „Weg 2".
 *
 * **Aufgeloest wird immer aus Sicht der anfragenden Nutzerin** (S6). Die
 * Pfade stehen relativ zur Setlisten-Datei in ihr - und dieselbe
 * Datei sieht bei jeder, die sie ueber eine Freigabe hat, anders aus: Ein
 * Eintrag, den die Chorleitung sieht, kann fuer eine Saengerin ohne
 * Freigabe auf das Stueck schlicht nicht existieren. Dann ist er fuer sie
 * `missing`, nicht fuer alle. Ein Nachschlagen per fileId aus der Sicht
 * eines anderen Kontos gibt es hier deshalb nirgends.
 *
 * **`..` darf den Nutzerordner nicht verlassen.** Die Pfade werden selbst
 * normalisiert, bevor sie an den Dateibaum gehen; wer mit `../../..` ueber
 * die Wurzel hinaus will, bekommt `missing` - nicht die Wurzel, und nicht
 * den Ordner eines anderen Kontos.
 */
class SetlistService {
	/**
	 * Eintraege je Liste - Schutz vor Unsinn, keine Fachgrenze. Gilt beim
	 * Schreiben UND beim Lesen: Die Datei laesst sich auch im Texteditor
	 * fuellen, und jede aufgeloeste Zeile kostet einen Zugriff auf den
	 * Dateibaum - ueber eine Route, die auch ohne Sitzung erreichbar ist.
	 * 256 KB aus kurzen Zeilen waeren sonst zehntausende Zugriffe je Aufruf.
	 */
	public const MAX_ENTRIES = 200;
	/** Groesste Setlisten-Datei, die gelesen wird. Eine Zeile je Stueck braucht keine 256 KB. */
	public const MAX_BYTES = 262144;
	/** Suchbereich fuer Weg 2 (S4): hoechstens so viele Listen je Ordner. */
	public const MAX_SETLISTS_PER_FOLDER = 20;
	/** Die Auswahl fuer den Editor: Tiefe und Anzahl. */
	public const CANDIDATE_DEPTH = 2;
	public const MAX_CANDIDATES = 200;
	/**
	 * Hoechstens so viele Ordner besucht die Auswahl (S4). Die Grenze an den
	 * Treffern allein reicht nicht: Ein Baum aus tausend leeren Ordnern
	 * brauchte tausend Verzeichnisabfragen fuer null Treffer - und die Route
	 * ist ohne Sitzung erreichbar.
	 */
	public const MAX_CANDIDATE_FOLDERS = 100;
	/** Laengster Dateiname einer neuen Liste, ohne Endung. */
	public const MAX_NAME_LENGTH = 120;

	public const STATUS_OK = 'ok';
	public const STATUS_MISSING = 'missing';
	public const STATUS_UNSUPPORTED = 'unsupported';

	public function __construct(
		private IRootFolder $rootFolder,
		private IJobList $jobList,
		private IAppConfig $appConfig,
		private ConversionService $conversionService,
		private ClientFallback $clientFallback,
		private LoggerInterface $logger,
	) {
	}

	/** Ob ein Knoten eine Setliste ist - an der Endung, wie in Files (E6, E11). */
	public static function isSetlist(Node $node): bool {
		return $node instanceof File && str_ends_with(mb_strtolower($node->getName()), SetlistFormat::EXTENSION);
	}

	/**
	 * Die Liste, aufgeloest fuer `$uid`. Mit `$preconvert` werden dabei alle
	 * noch nicht konvertierten Stuecke angestossen: Im Konzert soll
	 * beim Weiterblaettern nichts mehr konvertiert werden muessen.
	 *
	 * @return array{id: int, name: string, title: string, etag: string, canEdit: bool, folderFileId: int, entries: list<array{label: string, path: string, fileId: ?int, status: string}>}
	 * @throws SetlistException NOT_FOUND, TOO_LARGE
	 */
	public function load(File $setlist, string $uid, bool $preconvert = true): array {
		$parsed = self::parseBounded($this->read($setlist));
		$userFolder = $this->rootFolder->getUserFolder($uid);
		$dir = $this->directoryOf($userFolder, $setlist);

		$entries = [];
		$toConvert = [];
		foreach ($parsed['entries'] as $entry) {
			$resolved = $this->resolve($userFolder, $dir, $entry['target']);
			$entries[] = [
				'label' => $entry['label'],
				'path' => $entry['target'],
				'fileId' => $resolved['node']?->getId(),
				'status' => $resolved['status'],
			];
			if ($resolved['status'] === self::STATUS_OK) {
				$toConvert[$resolved['node']->getId()] = $resolved['node'];
			}
		}
		if ($preconvert && $toConvert !== []) {
			$this->preconvert($uid, array_values($toConvert));
		}

		return [
			'id' => $setlist->getId(),
			'name' => $setlist->getName(),
			'title' => $parsed['title'] ?? self::baseName($setlist->getName()),
			'etag' => $setlist->getEtag(),
			'canEdit' => $setlist->isUpdateable(),
			'folderFileId' => $setlist->getParent()->getId(),
			'entries' => $entries,
		];
	}

	/**
	 * Schreibt die Eintraege zurueck - nur die erste Liste, der Rest der Datei
	 * bleibt.
	 *
	 * Ein Eintrag ist eines von dreien:
	 * - `{origin: n}`: der n-te Eintrag der gelesenen Datei, unveraendert
	 *   (roher Pfad bleibt roh, Titel und Unterpunkte bleiben);
	 * - `{fileId, label?}`: eine Partitur aus der Dateiauswahl - der Server
	 *   rechnet den relativen Pfad selbst aus, der Browser kennt nur ihre
	 *   Lage aus seiner eigenen Sicht;
	 * - `{path, label?}`: ein Pfad, wie er in der Datei stehen soll.
	 *
	 * `$etag` ist der Stand, den der Editor gelesen hat. Hat jemand die Datei
	 * seither im Texteditor geaendert, zeigten die `origin`-Nummern auf andere
	 * Eintraege - dann lieber ablehnen als still das Falsche schreiben.
	 *
	 * `$allowedFileIds` schraenkt ein, was NEU in die Liste darf (S2): `null`
	 * heisst ohne Grenze (Browser-Sitzung), eine Liste heisst nur diese
	 * Dateien - `origin` bleibt immer erlaubt, er bringt nichts Neues herein.
	 * Mit `[]` bleibt also nur Umordnen und Entfernen.
	 *
	 * Ein `origin` ohne `$etag` wird abgelehnt: Die Nummer bezieht sich auf
	 * einen bestimmten Stand der Datei, und ohne ihn liesse sich nicht
	 * pruefen, ob es noch derselbe ist.
	 *
	 * **Restrisiko.** Zwischen der letzten Pruefung und dem Schreiben bleibt
	 * ein Fenster von Mikrosekunden, in dem ein Texteditor dazwischen
	 * speichern kann; dessen Stand ginge dann verloren. Eine Sperre schliesst
	 * es nicht: putContent() holt sich selbst erst eine geteilte und dann eine
	 * exklusive Sperre auf dieselbe Datei, eine vorher gehaltene eigene liesse
	 * genau diesen Wechsel scheitern. Deshalb wird der Stand unmittelbar vor
	 * dem Schreiben noch einmal frisch gelesen - nach dem Aufloesen der
	 * Eintraege, das der langsame Teil ist -, und das Fenster schrumpft auf
	 * den Abstand zweier Zeilen.
	 *
	 * @param list<mixed> $entries
	 * @param ?list<int> $allowedFileIds
	 * @throws SetlistException FORBIDDEN, CONFLICT, INVALID, TOO_LARGE
	 */
	public function save(File $setlist, string $uid, mixed $entries, ?string $etag, ?array $allowedFileIds = null): array {
		if (!$setlist->isUpdateable()) {
			throw new SetlistException(SetlistException::FORBIDDEN);
		}
		$hasEtag = $etag !== null && $etag !== '';
		if (!$hasEtag && self::usesOrigin($entries)) {
			throw new SetlistException(SetlistException::INVALID);
		}
		$before = $setlist->getEtag();
		if ($hasEtag && $etag !== $before) {
			throw new SetlistException(SetlistException::CONFLICT);
		}
		$text = $this->read($setlist);
		$parsed = self::parseBounded($text);
		$userFolder = $this->rootFolder->getUserFolder($uid);
		$items = $this->items($userFolder, $this->directoryOf($userFolder, $setlist), $entries, $parsed['entries'], $allowedFileIds);
		$this->assertUnchanged($userFolder, $setlist, $before, $text);

		try {
			$setlist->putContent(SetlistFormat::write($text, $items));
		} catch (NotPermittedException) {
			throw new SetlistException(SetlistException::FORBIDDEN);
		} catch (\InvalidArgumentException) {
			throw new SetlistException(SetlistException::INVALID);
		}
		return $this->load($setlist, $uid, false);
	}

	/**
	 * Legt eine neue Liste an - mit einer Ueberschrift aus dem Namen, damit
	 * die Datei im Texteditor gleich wie eine Setliste aussieht.
	 *
	 * @param list<mixed> $entries wie bei save(), ohne `origin`
	 * @param ?list<int> $allowedFileIds wie bei save()
	 * @throws SetlistException FORBIDDEN, EXISTS, INVALID
	 */
	public function create(Folder $folder, string $uid, string $name, mixed $entries, ?array $allowedFileIds = null): File {
		if (!$folder->isCreatable()) {
			throw new SetlistException(SetlistException::FORBIDDEN);
		}
		$base = self::sanitizeName($name);
		$fileName = $base . SetlistFormat::EXTENSION;
		if ($folder->nodeExists($fileName)) {
			throw new SetlistException(SetlistException::EXISTS);
		}
		$userFolder = $this->rootFolder->getUserFolder($uid);
		$items = $this->items($userFolder, $this->pathOf($userFolder, $folder), $entries, [], $allowedFileIds);
		try {
			$text = SetlistFormat::write('# ' . $base . "\n", $items);
		} catch (\InvalidArgumentException) {
			throw new SetlistException(SetlistException::INVALID);
		}
		try {
			return $folder->newFile($fileName, $text);
		} catch (NotPermittedException) {
			throw new SetlistException(SetlistException::FORBIDDEN);
		} catch (InvalidPathException) {
			throw new SetlistException(SetlistException::INVALID);
		}
	}

	/**
	 * Weg 2 (E11, S4): die Setlisten im Ordner der Partitur, die sie
	 * enthalten. Nur dieser Ordner und hoechstens MAX_SETLISTS_PER_FOLDER
	 * Listen - eine Suche ueber den ganzen Baum kostete bei jedem Oeffnen
	 * einer Partitur, und eine Liste in einem fremden Ordner waere eine
	 * Ueberraschung, kein Angebot.
	 *
	 * Verglichen wird ueber den normalisierten Pfad, nicht ueber den
	 * Dateibaum: Das spart je Eintrag einen Zugriff, und ein Eintrag, der auf
	 * genau diesen Pfad zeigt, meint aus Sicht dieser Nutzerin genau diese
	 * Datei.
	 *
	 * @return list<array{id: int, name: string, title: string, positions: list<int>}>
	 */
	public function containing(File $score, string $uid): array {
		$userFolder = $this->rootFolder->getUserFolder($uid);
		$scorePath = $this->pathOf($userFolder, $score);
		$folder = $score->getParent();
		$dir = $this->pathOf($userFolder, $folder);

		$result = [];
		foreach ($this->setlistsIn($folder) as $setlist) {
			try {
				// Eine zu lange Liste wird uebergangen wie eine unlesbare: Die
				// Suche laeuft bei jedem Oeffnen einer Partitur mit.
				$parsed = self::parseBounded($this->read($setlist));
			} catch (SetlistException|NotFoundException|NotPermittedException) {
				continue;
			}
			$positions = [];
			foreach ($parsed['entries'] as $index => $entry) {
				if (self::normalize($dir, $entry['target']) === $scorePath) {
					$positions[] = $index;
				}
			}
			if ($positions !== []) {
				$result[] = [
					'id' => $setlist->getId(),
					'name' => $setlist->getName(),
					'title' => $parsed['title'] ?? self::baseName($setlist->getName()),
					'positions' => $positions,
				];
			}
		}
		return $result;
	}

	/**
	 * Die Auswahl fuer den Setlisten-Editor: die Partituren im Ordner
	 * der offenen Partitur und darunter, bis Tiefe 2. Token-faehig, weil die
	 * mobile App weder Sitzung noch Nextclouds Dateiauswahl hat. `path` ist
	 * relativ zum Ordner der Partitur.
	 *
	 * @return list<array{fileId: int, name: string, path: string}>
	 */
	public function candidates(File $score): array {
		$root = $score->getParent();
		$found = [];
		$queue = [[$root, 0]];
		$visited = 0;
		while ($queue !== [] && count($found) < self::MAX_CANDIDATES && $visited < self::MAX_CANDIDATE_FOLDERS) {
			[$folder, $depth] = array_shift($queue);
			$visited++;
			try {
				$children = $folder->getDirectoryListing();
			} catch (NotFoundException|NotPermittedException) {
				continue;
			}
			foreach ($children as $child) {
				if ($child instanceof Folder) {
					if ($depth < self::CANDIDATE_DEPTH) {
						$queue[] = [$child, $depth + 1];
					}
				} elseif ($child instanceof File && str_ends_with(mb_strtolower($child->getName()), '.mscz')) {
					$found[] = [
						'fileId' => $child->getId(),
						'name' => $child->getName(),
						'path' => ltrim((string)$root->getRelativePath($child->getPath()), '/'),
					];
					if (count($found) >= self::MAX_CANDIDATES) {
						break;
					}
				}
			}
		}
		usort($found, static fn (array $a, array $b) => strnatcasecmp($a['path'], $b['path']));
		return $found;
	}

	/**
	 * Macht aus Pfad und Linkziel einen Pfad relativ zur Wurzel des
	 * Nutzerordners - oder null, wenn er dort nicht hinfuehrt (ueber die
	 * Wurzel hinaus, eine Adresse mit Schema, leer).
	 *
	 * @param string $dir Ordner der Liste, relativ zum Nutzerordner, mit fuehrendem `/`
	 */
	public static function normalize(string $dir, string $target): ?string {
		$target = trim($target);
		if ($target === '' || preg_match('#^[a-z][a-z0-9+.\-]*:#i', $target)) {
			return null;
		}
		// Ausdruecklich hier und nicht erst im Dateibaum (S6): Ein `\` ist in
		// Nextcloud kein erlaubtes Namenszeichen, auf manchem Speicher aber
		// ein Trenner - `..\..\x` waere dort ein Weg hinaus, an dem die
		// Segmentpruefung unten vorbeisieht. NUL und andere Steuerzeichen
		// beenden in manchen Schichten den Pfad vorzeitig.
		if (str_contains($target, '\\') || SetlistFormat::hasControlChars($target)) {
			return null;
		}
		// Ein fuehrender Schraegstrich meint die Wurzel des Nutzerordners -
		// so, wie Files Pfade anzeigt.
		$path = str_starts_with($target, '/') ? $target : $dir . '/' . $target;
		$stack = [];
		foreach (explode('/', $path) as $segment) {
			if ($segment === '' || $segment === '.') {
				continue;
			}
			if ($segment === '..') {
				if ($stack === []) {
					return null;
				}
				array_pop($stack);
				continue;
			}
			$stack[] = $segment;
		}
		return $stack === [] ? null : '/' . implode('/', $stack);
	}

	/**
	 * Der Weg von Ordner `$from` zu `$to`, beide relativ zum Nutzerordner -
	 * so, wie er in die Liste geschrieben wird.
	 */
	public static function relativePath(string $from, string $to): string {
		$fromParts = array_values(array_filter(explode('/', $from), static fn ($s) => $s !== ''));
		$toParts = array_values(array_filter(explode('/', $to), static fn ($s) => $s !== ''));
		$common = 0;
		$max = min(count($fromParts), count($toParts) - 1);
		while ($common < $max && $fromParts[$common] === $toParts[$common]) {
			$common++;
		}
		$up = array_fill(0, count($fromParts) - $common, '..');
		return implode('/', [...$up, ...array_slice($toParts, $common)]);
	}

	/**
	 * Ein Dateiname fuer eine neue Liste: ohne Pfadtrenner und Steuerzeichen,
	 * die Endung kommt immer dazu - auch wenn sie schon (teilweise) getippt
	 * war.
	 *
	 * @throws SetlistException INVALID
	 */
	public static function sanitizeName(string $name): string {
		$name = preg_replace('/[\x00-\x1F\x7F\/\\\\]+/u', ' ', $name) ?? '';
		$name = trim(preg_replace('/\s+/u', ' ', $name) ?? '');
		foreach ([SetlistFormat::EXTENSION, '.md'] as $suffix) {
			if (str_ends_with(mb_strtolower($name), $suffix)) {
				$name = rtrim(mb_substr($name, 0, mb_strlen($name) - mb_strlen($suffix)));
			}
		}
		$name = mb_substr($name, 0, self::MAX_NAME_LENGTH);
		// Ein Name aus Punkten waere versteckt oder ein Pfadsegment.
		if (trim($name, '. ') === '') {
			throw new SetlistException(SetlistException::INVALID);
		}
		return trim($name);
	}

	/**
	 * @return array{status: string, node: ?File}
	 */
	private function resolve(Folder $userFolder, string $dir, string $target): array {
		$path = self::normalize($dir, $target);
		if ($path === null) {
			return ['status' => self::STATUS_MISSING, 'node' => null];
		}
		try {
			$node = $userFolder->get($path);
		} catch (NotFoundException|NotPermittedException) {
			return ['status' => self::STATUS_MISSING, 'node' => null];
		}
		if (!$node instanceof File || !str_ends_with(mb_strtolower($node->getName()), '.mscz')) {
			// Da, aber nichts, was der Viewer zeigen kann - ein anderer Hinweis
			// als „fehlt", denn hier hilft keine Freigabe.
			return ['status' => self::STATUS_UNSUPPORTED, 'node' => null];
		}
		return ['status' => self::STATUS_OK, 'node' => $node];
	}

	/**
	 * Aus den Angaben des Editors die Zeilen fuer den Writer.
	 *
	 * Mit `$allowed` (S2, Anfrage mit Token) darf nur herein, was schon in
	 * der Liste stand (`origin`) oder in dieser Menge liegt - fuer `fileId`
	 * wie fuer `path`, der dafuer aufgeloest wird. Sonst liesse sich ueber
	 * einen Pfad dieselbe Datei eintragen, die als fileId abgewiesen wird.
	 *
	 * @param list<array{label: string, target: string, content: string, tail: list<string>}> $existing
	 * @param ?list<int> $allowed
	 * @return list<array{content: string, tail?: list<string>}>
	 * @throws SetlistException INVALID, FORBIDDEN
	 */
	private function items(Folder $userFolder, string $dir, mixed $entries, array $existing, ?array $allowed = null): array {
		if (!is_array($entries) || count($entries) > self::MAX_ENTRIES) {
			throw new SetlistException(SetlistException::INVALID);
		}
		$items = [];
		foreach ($entries as $entry) {
			if (!is_array($entry)) {
				throw new SetlistException(SetlistException::INVALID);
			}
			$label = isset($entry['label']) && is_string($entry['label']) ? mb_substr(trim($entry['label']), 0, 200) : '';
			if (SetlistFormat::hasControlChars($label)
				|| (isset($entry['path']) && is_string($entry['path']) && SetlistFormat::hasControlChars($entry['path']))) {
				// S6: abgelehnt, nicht bereinigt - siehe SetlistFormat::linkContent().
				throw new SetlistException(SetlistException::INVALID);
			}
			if (isset($entry['origin'])) {
				$origin = $entry['origin'];
				if (!is_int($origin) || !isset($existing[$origin])) {
					throw new SetlistException(SetlistException::INVALID);
				}
				$items[] = ['content' => $existing[$origin]['content'], 'tail' => $existing[$origin]['tail']];
			} elseif (isset($entry['fileId'])) {
				$node = $userFolder->getById((int)$entry['fileId'])[0] ?? null;
				if (!$node instanceof File) {
					throw new SetlistException(SetlistException::INVALID);
				}
				$this->assertAllowed($node, $allowed);
				$target = self::relativePath($dir, $this->pathOf($userFolder, $node));
				$items[] = ['content' => SetlistFormat::linkContent($label !== '' ? $label : SetlistFormat::labelFromPath($node->getName()), $target)];
			} elseif (isset($entry['path']) && is_string($entry['path']) && trim($entry['path']) !== '') {
				$target = trim($entry['path']);
				if ($allowed !== null) {
					$resolved = $this->resolve($userFolder, $dir, $target);
					if ($resolved['node'] === null) {
						throw new SetlistException(SetlistException::FORBIDDEN);
					}
					$this->assertAllowed($resolved['node'], $allowed);
				}
				$items[] = ['content' => SetlistFormat::linkContent($label !== '' ? $label : SetlistFormat::labelFromPath($target), $target)];
			} else {
				throw new SetlistException(SetlistException::INVALID);
			}
		}
		return $items;
	}

	/**
	 * @param ?list<int> $allowed
	 * @throws SetlistException FORBIDDEN
	 */
	private function assertAllowed(Node $node, ?array $allowed): void {
		if ($allowed !== null && !in_array($node->getId(), $allowed, true)) {
			throw new SetlistException(SetlistException::FORBIDDEN);
		}
	}

	/**
	 * Stoesst die Konvertierung aller Stuecke an, die noch keine aktuelle
	 * haben - ueber denselben Job wie die eifrige Konvertierung
	 * (Listener\ScoreFileListener) und mit derselben Groessengrenze.
	 * Doppelte Auftraege verhindert IJobList selbst (gleiche Klasse, gleiches
	 * Argument), ein bereits laufender wird im Job uebersprungen.
	 *
	 * Ein Fehler hier darf das Oeffnen der Liste nicht verhindern - schlimmstenfalls
	 * konvertiert ein Stueck erst, wenn es dran ist, wie ohne Setliste.
	 *
	 * @param list<File> $nodes
	 */
	private function preconvert(string $uid, array $nodes): void {
		try {
			if ($this->clientFallback->applies()) {
				// Wo der Server nicht konvertiert, gibt es vorab nichts zu waermen.
				return;
			}
			$maxBytes = $this->appConfig->getValueInt(Application::APP_ID, 'max_score_bytes', ConvertScoreJob::DEFAULT_MAX_BYTES);
			foreach ($nodes as $node) {
				if ($maxBytes > 0 && $node->getSize() > $maxBytes) {
					continue;
				}
				$conversion = $this->conversionService->find($node->getId(), $node->getEtag());
				$needed = $conversion === null
					|| ($conversion->getStatus() === ScoreConversion::STATUS_READY && !$this->conversionService->isCurrentFormat($conversion));
				if ($needed) {
					$this->jobList->add(ConvertScoreJob::class, ['userId' => $uid, 'fileId' => $node->getId()]);
				}
			}
		} catch (\Throwable $e) {
			$this->logger->warning('ScoreView: Vorab-Konvertierung der Setliste fehlgeschlagen: {message}', [
				'message' => $e->getMessage(),
				'exception' => $e,
			]);
		}
	}

	/**
	 * @return list<File>
	 */
	private function setlistsIn(Folder $folder): array {
		try {
			$children = $folder->getDirectoryListing();
		} catch (NotFoundException|NotPermittedException) {
			return [];
		}
		$setlists = array_values(array_filter($children, static fn (Node $n) => self::isSetlist($n)));
		usort($setlists, static fn (File $a, File $b) => strnatcasecmp($a->getName(), $b->getName()));
		return array_slice($setlists, 0, self::MAX_SETLISTS_PER_FOLDER);
	}

	/**
	 * SetlistFormat::parse() mit der Obergrenze MAX_ENTRIES. Abgelehnt statt
	 * abgeschnitten: Eine gekuerzte Liste saehe vollstaendig aus, und ein
	 * Speichern schriebe den Rest der Datei ohne die abgeschnittenen Zeilen
	 * zurueck.
	 *
	 * @return array{title: ?string, entries: list<array{label: string, target: string, content: string, tail: list<string>}>}
	 * @throws SetlistException TOO_LARGE
	 */
	private static function parseBounded(string $text): array {
		$parsed = SetlistFormat::parse($text);
		if (count($parsed['entries']) > self::MAX_ENTRIES) {
			throw new SetlistException(SetlistException::TOO_LARGE);
		}
		return $parsed;
	}

	private static function usesOrigin(mixed $entries): bool {
		if (!is_array($entries)) {
			return false;
		}
		foreach ($entries as $entry) {
			if (is_array($entry) && array_key_exists('origin', $entry)) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Der Stand unmittelbar vor dem Schreiben, frisch aus dem Dateibaum und
	 * nicht aus dem Knoten, den die Anfrage schon in der Hand haelt - dessen
	 * Etag ist der beim Aufloesen der Route. Verglichen wird auch der Inhalt:
	 * Auf externem Speicher kann der Etag einer Aenderung hinterherlaufen.
	 *
	 * @throws SetlistException CONFLICT
	 */
	private function assertUnchanged(Folder $userFolder, File $setlist, string $etagBefore, string $textBefore): void {
		try {
			$fresh = $userFolder->getById($setlist->getId())[0] ?? null;
			$unchanged = $fresh instanceof File
				&& $fresh->getEtag() === $etagBefore
				&& $this->read($fresh) === $textBefore;
		} catch (NotFoundException|NotPermittedException) {
			$unchanged = false;
		}
		if (!$unchanged) {
			throw new SetlistException(SetlistException::CONFLICT);
		}
	}

	/** @throws SetlistException TOO_LARGE */
	private function read(File $setlist): string {
		if ($setlist->getSize() > self::MAX_BYTES) {
			throw new SetlistException(SetlistException::TOO_LARGE);
		}
		return (string)$setlist->getContent();
	}

	private function directoryOf(Folder $userFolder, Node $node): string {
		return $this->pathOf($userFolder, $node->getParent());
	}

	/** Der Pfad relativ zum Nutzerordner, mit fuehrendem `/` (die Wurzel ist `''`). */
	private function pathOf(Folder $userFolder, Node $node): string {
		$relative = $userFolder->getRelativePath($node->getPath()) ?? '';
		return rtrim($relative, '/');
	}

	private static function baseName(string $fileName): string {
		return str_ends_with(mb_strtolower($fileName), SetlistFormat::EXTENSION)
			? mb_substr($fileName, 0, mb_strlen($fileName) - mb_strlen(SetlistFormat::EXTENSION))
			: $fileName;
	}
}
