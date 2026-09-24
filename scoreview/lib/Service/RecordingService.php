<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\Db\Recording;
use OCA\ScoreView\Db\RecordingMapper;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFile;

/**
 * Die Regeln fuer eigene Aufnahmen (docs/architecture.md, Abschnitt Mikrofon;
 * Speichergrenzen: S5).
 *
 * **Nur die Aufnehmende** (S8): Jede Methode nimmt die Nutzerin als
 * Argument und fragt die Tabelle nur mit ihr ab. Eine fremde Kennung ist
 * damit nicht „verboten", sondern schlicht nicht da - der Controller
 * antwortet 404, und niemand erfaehrt, ob es sie gibt. Das gilt auch fuer
 * Leitungen: Eine Aufnahme ist Uebematerial, keine Abgabe.
 *
 * **Grenzen in fester Reihenfolge**, die billigste zuerst, und alle VOR dem
 * Schreiben:
 *
 * 1. Format (die Bytes sind eine WAV der App),
 * 2. Dauer (`max_recording_seconds`, aus den Bytes gerechnet, nicht aus einer
 *    Angabe des Clients),
 * 3. Anzahl je Partitur (`max_recordings_per_score`),
 * 4. Speicher je Person, dann instanzweit (S5). Was ein bestaetigtes
 *    Ersetzen freigibt, zaehlt dabei schon als frei - sonst liesse sich an
 *    der Obergrenze nie mehr etwas ersetzen, sobald der Speicher knapp ist.
 *
 * Erst danach wird geschrieben, und die verdraengte Aufnahme erst geloescht,
 * wenn die neue sicher liegt: Scheitert das Schreiben, ist nichts verloren.
 */
class RecordingService {
	public function __construct(
		private RecordingMapper $mapper,
		private RecordingStorage $storage,
		private FeatureConfig $features,
		private ITimeFactory $time,
	) {
	}

	/**
	 * @return Recording[] die aelteste zuerst
	 */
	public function list(int $fileId, string $userId): array {
		return $this->mapper->findByFileAndUser($fileId, $userId);
	}

	/**
	 * @param resource $wav der Rumpf als lesbarer Strom (RequestBodyReader)
	 * @param array{scoreStartMs: int, tempoFactor: float, withAccompaniment: bool} $meta
	 * @throws RecordingException
	 */
	public function create(int $fileId, string $userId, $wav, array $meta, bool $replaceOldest): Recording {
		$size = (int)(fstat($wav)['size'] ?? 0);
		rewind($wav);
		$head = (string)fread($wav, WavFormat::HEAD_READ_BYTES);
		rewind($wav);
		try {
			$info = WavFormat::inspectHead($head, $size);
		} catch (\InvalidArgumentException) {
			throw new RecordingException(RecordingException::INVALID);
		}
		if ($info['durationMs'] > $this->features->maxRecordingSeconds() * 1000) {
			throw new RecordingException(RecordingException::TOO_LONG);
		}

		$existing = $this->mapper->findByFileAndUser($fileId, $userId);
		$max = $this->features->maxRecordingsPerScore();
		$victims = [];
		if (count($existing) >= $max) {
			if (!$replaceOldest) {
				throw new RecordingException(RecordingException::LIMIT_REACHED);
			}
			// So viele, dass danach genau eine frei ist - auch wenn die
			// Obergrenze inzwischen gesenkt wurde und mehr als eine zu viel
			// da liegt.
			$victims = array_slice($existing, 0, count($existing) - $max + 1);
		}

		$freed = array_sum(array_map(static fn (Recording $r) => $r->getSizeBytes(), $victims));
		if ($this->mapper->sumSizeByUser($userId) - $freed + $size > $this->features->maxRecordingBytesPerUser()) {
			throw new RecordingException(RecordingException::USER_STORAGE_FULL);
		}
		if ($this->mapper->sumSizeTotal() - $freed + $size > $this->features->maxRecordingBytesTotal()) {
			throw new RecordingException(RecordingException::TOTAL_STORAGE_FULL);
		}

		$recording = new Recording();
		$recording->setFileId($fileId);
		$recording->setUserId($userId);
		$recording->setCreatedAt($this->time->getDateTime());
		$recording->setDurationMs($info['durationMs']);
		$recording->setSizeBytes($size);
		$recording->setScoreStartMs($meta['scoreStartMs']);
		$recording->setTempoFactor($meta['tempoFactor']);
		$recording->setWithAccompaniment($meta['withAccompaniment']);
		$recording = $this->storage->store($recording, $wav);

		$deleted = [];
		foreach ($victims as $victim) {
			$this->storage->delete($victim);
			$deleted[$victim->getId()] = true;
		}
		$this->enforceCountAfterStore($recording, $max, $replaceOldest, $deleted);
		return $recording;
	}

	/**
	 * Prueft die Obergrenze je Partitur ein zweites Mal, nachdem die neue
	 * Aufnahme liegt.
	 *
	 * **Warum.** Zwischen dem Zaehlen oben und dem Einfuegen liegt das
	 * Schreiben der Datei - zwei Uploads derselben Person (zwei Tabs, ein
	 * wiederholter Versuch nach einem Funkloch) zaehlen beide denselben Stand
	 * und laegen danach gemeinsam ueber der Grenze. Eine Sperre um das Ganze
	 * hielte sie waehrend des Schreibens von bis zu hundert Megabyte; das
	 * Nachzaehlen nach dem Einfuegen kostet nur einen Lesezugriff und stellt
	 * die Grenze wieder her:
	 *
	 * - **Mit bestaetigtem Ersetzen** gehen die aeltesten ueberzaehligen - die
	 *   Nutzerin hat genau dem zugestimmt.
	 * - **Ohne** wird niemals eine alte Aufnahme ungefragt geopfert. Liegt die
	 *   eigene unter den juengsten ueberzaehligen, geht sie selbst wieder,
	 *   und die Antwort ist LIMIT_REACHED wie beim ersten Zaehlen. Laufen zwei
	 *   solche Uploads exakt gleichzeitig, kann es beide treffen - lieber eine
	 *   Aufnahme zu wenig als eine Grenze, die sich umgehen laesst.
	 *
	 * Die Speichergrenzen bleiben ungeschuetzt: Dort kann ein gleichzeitiger
	 * Upload sie um hoechstens seine eigene Groesse ueberschreiten, und jeder
	 * weitere Upload zaehlt dann richtig.
	 *
	 * @param array<int, true> $deleted schon verdraengte Kennungen
	 * @throws RecordingException LIMIT_REACHED
	 */
	private function enforceCountAfterStore(Recording $recording, int $max, bool $replaceOldest, array $deleted): void {
		$now = array_values(array_filter(
			$this->mapper->findByFileAndUser($recording->getFileId(), $recording->getUserId()),
			static fn (Recording $r) => !isset($deleted[$r->getId()]),
		));
		$surplus = count($now) - $max;
		if ($surplus <= 0) {
			return;
		}
		if ($replaceOldest) {
			$older = array_values(array_filter($now, static fn (Recording $r) => $r->getId() !== $recording->getId()));
			foreach (array_slice($older, 0, $surplus) as $victim) {
				$this->storage->delete($victim);
			}
			return;
		}
		$newest = array_map(static fn (Recording $r) => $r->getId(), array_slice($now, -$surplus));
		if (in_array($recording->getId(), $newest, true)) {
			$this->storage->delete($recording);
			throw new RecordingException(RecordingException::LIMIT_REACHED);
		}
	}

	/**
	 * @throws RecordingException NOT_FOUND - fremd, geloescht oder ohne Datei
	 */
	public function open(int $fileId, string $userId, int $id): ISimpleFile {
		$recording = $this->own($fileId, $userId, $id);
		try {
			return $this->storage->open($recording);
		} catch (NotFoundException) {
			throw new RecordingException(RecordingException::NOT_FOUND);
		}
	}

	/**
	 * @throws RecordingException NOT_FOUND
	 */
	public function delete(int $fileId, string $userId, int $id): void {
		$this->storage->delete($this->own($fileId, $userId, $id));
	}

	private function own(int $fileId, string $userId, int $id): Recording {
		$recording = $this->mapper->findOwn($id, $fileId, $userId);
		if ($recording === null) {
			throw new RecordingException(RecordingException::NOT_FOUND);
		}
		return $recording;
	}
}
