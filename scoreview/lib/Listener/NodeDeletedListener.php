<?php

declare(strict_types=1);

namespace OCA\ScoreView\Listener;

use OCA\ScoreView\Service\ConversionService;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Files\Events\Node\NodeDeletedEvent;
use OCP\Files\FileInfo;
use Psr\Log\LoggerInterface;

/**
 * @template-implements IEventListener<NodeDeletedEvent>
 *
 * Räumt den Konvertierungs-Cache einer gelöschten Partitur weg
 * (Codereview-Befund A4). Bis Phase 23 blieben IAppData-Ordner und
 * DB-Zeilen für immer liegen - bei fünf Seiten über 1 MB pro Datei, und
 * niemand hätte je bemerkt, dass es wächst.
 *
 * **Warum hier nur der Cache und nicht die Notizen.** `NodeDeletedEvent`
 * feuert bereits, wenn eine Datei in den Papierkorb wandert - an der
 * Testinstanz nachgemessen: die Datei behält dabei ihre fileId und liegt
 * danach unter `…/files_trashbin/files/…`, ein Wiederherstellen bringt sie
 * mit derselben fileId zurück. Die Notizen dort mitzulöschen hieße, für eine
 * **umkehrbare** Handlung einen **unumkehrbaren** Verlust zu erzeugen.
 *
 * Der Cache dagegen ist regenerierbar: geht er beim Papierkorb-Verschieben
 * verloren, baut ihn das nächste Öffnen neu auf. Das ist der Grund, warum
 * die beiden Datenarten hier unterschiedlich behandelt werden.
 *
 * Notizen endgültig gelöschter Dateien räumt stattdessen
 * BackgroundJob\CleanupOrphansJob auf - der kann prüfen, ob die fileId
 * wirklich nirgends mehr existiert.
 */
class NodeDeletedListener implements IEventListener {
	public function __construct(
		private ConversionService $conversionService,
		private LoggerInterface $logger,
	) {
	}

	public function handle(Event $event): void {
		if (!$event instanceof NodeDeletedEvent) {
			return;
		}
		$node = $event->getNode();
		// Ordner tragen keine Konvertierung; ihre Kinder feuern eigene
		// Ereignisse bzw. werden vom Aufraeum-Job erwischt.
		if ($node->getType() !== FileInfo::TYPE_FILE) {
			return;
		}
		// Endungspruefung wie im ScoreFileListener und aus demselben Grund
		// (siehe dort): der Mimetype haengt an einer Serverkonfiguration.
		if (!str_ends_with(strtolower($node->getName()), '.mscz')) {
			return;
		}

		$fileId = $node->getId();
		try {
			$this->conversionService->deleteAllForFile($fileId);
		} catch (\Throwable $e) {
			// Aufraeumen darf das Loeschen der Datei niemals scheitern lassen -
			// der Job unten holt es ohnehin nach.
			$this->logger->warning('ScoreView: Cache von fileId={fileId} konnte nicht aufgeraeumt werden: {message}', [
				'fileId' => $fileId,
				'message' => $e->getMessage(),
				'exception' => $e,
			]);
		}
	}
}
