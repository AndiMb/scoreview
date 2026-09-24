<?php

declare(strict_types=1);

namespace OCA\ScoreView\Listener;

use OCA\ScoreView\Db\AnnotationMapper;
use OCA\ScoreView\Db\FollowMapper;
use OCA\ScoreView\Db\LeaderMapper;
use OCA\ScoreView\Service\RecordingStorage;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\User\Events\UserDeletedEvent;
use Psr\Log\LoggerInterface;

/**
 * @template-implements IEventListener<UserDeletedEvent>
 *
 * Löscht die Notizen eines gelöschten Kontos.
 *
 * Ohne dieses Löschen überlebten sie die Kontolöschung unbegrenzt -
 * inklusive ihres Inhalts, also echter Nutzertexte, und inklusive der
 * `user_id` in der Spalte. Für einen Prototyp folgenlos, für eine
 * Produktivinstallation ein Datenschutzthema: „Konto gelöscht" muss
 * heißen, dass seine Inhalte weg sind.
 *
 * Anders als beim Löschen einer *Datei* (siehe NodeDeletedListener) ist der
 * Fall hier eindeutig: eine Kontolöschung ist nicht umkehrbar, es gibt
 * keinen Papierkorb dafür.
 *
 * Betrifft ausdrücklich auch die **geteilten** Notizen dieser Person: sie
 * waren zwar für alle mit Dateizugriff sichtbar, bleiben aber ihr Inhalt und
 * ihre Urheberschaft. Wären sie ausgenommen, zeigte die Liste danach
 * dauerhaft Notizen einer Autorin, deren Displayname nicht mehr auflösbar
 * ist (AnnotationService::serialize() fällt dann auf die rohe userId
 * zurück - genau die soll ja verschwinden).
 *
 * Ebenso weg: ihre Ernennungen zur Leitung, die „Folgt mir"-Sitzungen, die sie
 * leitete, und ihre Aufnahmen samt WAV-Dateien. Stehen bleiben dagegen die
 * Leitungen, die SIE ernannt hat - sie sind die Rolle anderer Personen, nicht
 * ihr Inhalt.
 *
 * Jeder Teil hat einen eigenen Fehlerzweig: Scheitert das Löschen der
 * Aufnahmen am Speicher, sollen die Notizen trotzdem verschwinden.
 */
class UserDeletedListener implements IEventListener {
	public function __construct(
		private AnnotationMapper $mapper,
		private LeaderMapper $leaderMapper,
		private FollowMapper $followMapper,
		private RecordingStorage $recordingStorage,
		private LoggerInterface $logger,
	) {
	}

	public function handle(Event $event): void {
		if (!$event instanceof UserDeletedEvent) {
			return;
		}
		$userId = $event->getUser()->getUID();
		$this->deleteSafely($userId, 'Notizen', fn () => $this->mapper->deleteByUserId($userId));
		$this->deleteSafely($userId, 'Leitungen', fn () => $this->leaderMapper->deleteByUserId($userId));
		$this->deleteSafely($userId, 'Folge-Sitzungen', fn () => $this->followMapper->deleteByLeader($userId));
		$this->deleteSafely($userId, 'Aufnahmen', fn () => $this->recordingStorage->deleteAllForUser($userId));
	}

	/**
	 * @param callable(): int $delete
	 */
	private function deleteSafely(string $userId, string $what, callable $delete): void {
		try {
			$deleted = $delete();
		} catch (\Throwable $e) {
			$this->logger->error('ScoreView: {what} von userId={userId} konnten nicht geloescht werden: {message}', [
				'what' => $what,
				'userId' => $userId,
				'message' => $e->getMessage(),
				'exception' => $e,
			]);
			return;
		}
		if ($deleted > 0) {
			$this->logger->info('ScoreView: {count} {what} des geloeschten Kontos {userId} entfernt.', [
				'count' => $deleted,
				'what' => $what,
				'userId' => $userId,
			]);
		}
	}
}
