<?php

declare(strict_types=1);

namespace OCA\ScoreView\Listener;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\BackgroundJob\RegisterMimetypeJob;
use OCP\BackgroundJob\IJobList;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Files\Events\Node\NodeCreatedEvent;
use OCP\Files\Events\Node\NodeWrittenEvent;
use Throwable;

/**
 * @template-implements IEventListener<NodeCreatedEvent|NodeWrittenEvent>
 *
 * Haelt den Mimetype frisch hochgeladener Partituren richtig.
 *
 * Service\MimetypeRegistration berichtigt den **Bestand**, beim Update und bei
 * der Installation. Neue Uploads laufen dagegen durch Nextclouds Erkennung,
 * und die kennt `.mscz` weiterhin nicht: `IMimeTypeDetector` laesst sich aus
 * einer App heraus nicht erweitern. Ohne diesen Listener traegt jede neu
 * hochgeladene Partitur wieder `application/octet-stream` - und waere in den
 * mobilen Apps erneut unsichtbar, waehrend der Bestand daneben funktioniert.
 * Genau diese Halbheit waere schlimmer als gar keine Registrierung.
 *
 * Bewusst getrennt von ScoreFileListener, der an denselben beiden Ereignissen
 * haengt: Der entscheidet ueber Vorab-Konvertierung und ist an die
 * Admin-Einstellung `eager_conversion` gebunden. Der Mimetype dagegen muss
 * immer stimmen. Zusammengelegt haette eine abgeschaltete Einstellung den
 * Mimetype stillschweigend mit abgeschaltet.
 *
 * Erkannt wird an der **Endung**, nicht am Mimetype - der ist ja gerade der
 * falsche.
 */
class ScoreMimetypeListener implements IEventListener {
	public function __construct(
		private IJobList $jobList,
	) {
	}

	public function handle(Event $event): void {
		if (!$event instanceof NodeCreatedEvent && !$event instanceof NodeWrittenEvent) {
			return;
		}
		$node = $event->getNode();
		if (!str_ends_with(strtolower($node->getName()), '.mscz')) {
			return;
		}

		try {
			// Der haeufige Fall auf einer eingerichteten Instanz: Die Datei
			// traegt den richtigen Mimetype schon, weil der Betreiber ihn in
			// config/ registriert hat. Dann ist hier nichts zu tun, und der
			// Job wird gar nicht erst eingereiht.
			if ($node->getMimetype() === Application::MSCZ_MIMETYPE) {
				return;
			}
		} catch (Throwable) {
			// Ein Knoten, der seinen eigenen Mimetype nicht nennen kann, ist
			// kein Grund, den Upload scheitern zu lassen. Im Zweifel den Job
			// einreihen - er ist wiederholbar und billig, wenn nichts ansteht.
		}

		$this->jobList->add(RegisterMimetypeJob::class);
	}
}
