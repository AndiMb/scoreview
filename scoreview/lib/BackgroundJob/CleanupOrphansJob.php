<?php

declare(strict_types=1);

namespace OCA\ScoreView\BackgroundJob;

use OCA\ScoreView\Db\AnnotationMapper;
use OCA\ScoreView\Db\FollowMapper;
use OCA\ScoreView\Db\FollowSession;
use OCA\ScoreView\Db\LeaderMapper;
use OCA\ScoreView\Db\MyPartPreferenceMapper;
use OCA\ScoreView\Db\PracticeGoalMapper;
use OCA\ScoreView\Db\PracticeLogMapper;
use OCA\ScoreView\Db\ScoreConversionMapper;
use OCA\ScoreView\Service\ConversionService;
use OCA\ScoreView\Service\PracticeLogService;
use OCA\ScoreView\Service\RecordingStorage;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\TimedJob;
use OCP\Files\IRootFolder;
use Psr\Log\LoggerInterface;

/**
 * Räumt Cache, Notizen, Leitungen, „Folgt mir"-Sitzungen, Aufnahmen und die
 * „Meine Stimme"-Wahl (`my_part.<fileId>` in den Nutzereinstellungen) von
 * Dateien weg, die es nicht mehr gibt.
 *
 * Zwei Aufgaben, die der ereignisbasierte Weg nicht abdecken kann:
 *
 * 1. **Endgültig gelöschte Dateien.** `NodeDeletedEvent` feuert schon beim
 *    Verschieben in den Papierkorb (nachgemessen), die Datei behält dort ihre
 *    fileId und kann zurückgeholt werden. Notizen dürfen deshalb erst weg,
 *    wenn die fileId **nirgends mehr** auflösbar ist - auch nicht im
 *    Papierkorb. Genau das prüft dieser Job über `IRootFolder::getById()`,
 *    das den ganzen Baum durchsucht (an der Testinstanz verifiziert: eine in
 *    den Papierkorb verschobene Datei liefert dort weiterhin einen Treffer,
 *    unter `…/files_trashbin/files/…`).
 * 2. **Verpasste Ereignisse.** Ein Absturz mitten im Löschen, ein
 *    `occ files:cleanup`, ein direkt am Speicher entfernter Ordner - danach
 *    gibt es keinen Event mehr, der je nachkäme.
 *
 * Dazu kommen „Folgt mir"-Sitzungen ohne Lebenszeichen der Leitung
 * (FollowSession::TIMEOUT_SECONDS). Beim Lesen gelten sie ohnehin als
 * beendet; hier verschwindet nur die Zeile.
 *
 * Läuft einmal täglich; das reicht für Aufräumarbeiten und hält die
 * `getById()`-Abfragen selten. Anders als ConvertScoreJob ist das ein
 * periodischer Job ohne Argument und deshalb korrekt über
 * `<background-jobs>` in `appinfo/info.xml` registriert.
 */
class CleanupOrphansJob extends TimedJob {
	private const INTERVAL_SECONDS = 24 * 60 * 60;

	public function __construct(
		ITimeFactory $time,
		private IRootFolder $rootFolder,
		private ConversionService $conversionService,
		private ScoreConversionMapper $conversionMapper,
		private AnnotationMapper $annotationMapper,
		private LeaderMapper $leaderMapper,
		private FollowMapper $followMapper,
		private RecordingStorage $recordingStorage,
		private MyPartPreferenceMapper $myPartPreferences,
		private PracticeLogMapper $practiceLog,
		private PracticeGoalMapper $practiceGoals,
		private PracticeLogService $practiceLogService,
		private LoggerInterface $logger,
	) {
		parent::__construct($time);
		$this->setInterval(self::INTERVAL_SECONDS);
		// Aufraeumen ist nie dringend und soll sich nicht mit einer laufenden
		// Konvertierung um die Queue streiten.
		$this->setTimeSensitivity(self::TIME_INSENSITIVE);
	}

	protected function run($argument): void {
		$this->removeExpiredFollowSessions();
		$this->pruneOldPracticeDays();

		$fileIds = array_unique(array_merge(
			$this->conversionMapper->findAllFileIds(),
			$this->annotationMapper->findAllFileIds(),
			$this->leaderMapper->findAllFileIds(),
			$this->followMapper->findAllFileIds(),
			$this->recordingStorage->findAllFileIds(),
			$this->myPartPreferences->findAllFileIds(),
			$this->practiceLog->findAllFileIds(),
			$this->practiceGoals->findAllFileIds(),
		));

		$caches = 0;
		$annotations = 0;
		$others = 0;
		foreach ($fileIds as $fileId) {
			if ($this->stillExists($fileId)) {
				continue;
			}
			try {
				$this->conversionService->deleteAllForFile($fileId);
				$caches++;
				$annotations += $this->annotationMapper->deleteByFileId($fileId);
				$others += $this->leaderMapper->deleteByFileId($fileId);
				$others += $this->followMapper->deleteByFileId($fileId);
				$others += $this->recordingStorage->deleteAllForFile($fileId);
				$others += $this->myPartPreferences->deleteByFileId($fileId);
				$others += $this->practiceLog->deleteByFileId($fileId);
				$others += $this->practiceGoals->deleteByFileId($fileId);
			} catch (\Throwable $e) {
				// Eine einzelne kaputte fileId darf den Durchlauf nicht beenden -
				// der naechste Lauf versucht es erneut.
				$this->logger->warning('ScoreView: cleanup of fileId={fileId} failed: {message}', [
					'fileId' => $fileId,
					'message' => $e->getMessage(),
					'exception' => $e,
				]);
			}
		}

		if ($caches > 0 || $annotations > 0 || $others > 0) {
			$this->logger->info('ScoreView: removed {caches} orphaned cache entries, {annotations} annotations and {others} leader roles, sessions, recordings and part selections.', [
				'caches' => $caches,
				'annotations' => $annotations,
				'others' => $others,
			]);
		}
	}

	/**
	 * Keeps the practice log bounded (PracticeLogService::KEEP_DAYS). Its own
	 * try block for the same reason as the follow sessions below.
	 */
	private function pruneOldPracticeDays(): void {
		try {
			$this->practiceLogService->prune();
		} catch (\Throwable $e) {
			$this->logger->warning('ScoreView: old practice log days could not be removed: {message}', [
				'message' => $e->getMessage(),
				'exception' => $e,
			]);
		}
	}

	/**
	 * Eigener try-Block: Ein Fehler hier darf das eigentliche Aufraeumen
	 * nicht verhindern - eine abgelaufene Sitzung stoert niemanden, sie gilt
	 * beim Lesen ohnehin als beendet.
	 */
	private function removeExpiredFollowSessions(): void {
		try {
			$cutoff = $this->time->getDateTime()->modify('-' . FollowSession::TIMEOUT_SECONDS . ' seconds');
			$this->followMapper->deleteHeartbeatBefore($cutoff);
		} catch (\Throwable $e) {
			$this->logger->warning('ScoreView: expired follow sessions could not be removed: {message}', [
				'message' => $e->getMessage(),
				'exception' => $e,
			]);
		}
	}

	/**
	 * Existiert die fileId noch irgendwo im Dateibaum - einschliesslich
	 * Papierkorb und fremder Freigaben? Bewusst ueber IRootFolder statt ueber
	 * einen Nutzerordner: eine Partitur kann jemand anderem gehoeren als der
	 * Person, deren Notiz daran haengt.
	 */
	private function stillExists(int $fileId): bool {
		try {
			return $this->rootFolder->getById($fileId) !== [];
		} catch (\Throwable) {
			// Im Zweifel nichts loeschen.
			return true;
		}
	}
}
