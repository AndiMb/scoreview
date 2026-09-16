<?php

declare(strict_types=1);

namespace OCA\ScoreView\Listener;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\BackgroundJob\ConvertScoreJob;
use OCA\ScoreView\Service\ClientFallback;
use OCP\BackgroundJob\IJobList;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Files\Events\Node\NodeCreatedEvent;
use OCP\Files\Events\Node\NodeWrittenEvent;
use OCP\IAppConfig;
use Psr\Log\LoggerInterface;

/**
 * @template-implements IEventListener<NodeCreatedEvent|NodeWrittenEvent>
 *
 * Erkennt .mscz-Dateien an der Endung, nicht am Mimetype - und das bleibt so.
 * Zwar trägt die App den Mimetype inzwischen selbst ein
 * (Service\MimetypeRegistration), aber erst *nachdem* die Datei da ist: Die
 * Erkennung beim Upload gehört weiterhin Nextcloud, und die kennt `.mscz`
 * ohne `config/mimetypemapping.json` nicht. Genau in diesem Ereignis trägt
 * eine frisch hochgeladene Partitur also noch `application/octet-stream` -
 * ein Mimetype-Vergleich liefe hier ins Leere.
 *
 * Löst standardmäßig KEINE Konvertierung mehr aus (vorher: jeder
 * Upload/jede Bearbeitung stieß sofort eine Konvertierung an - bei z.B.
 * 300 hochgeladenen Partituren 300 Konvertierungen für Dateien, die
 * vielleicht nie jemand öffnet). Ein neuer Upload
 * bzw. eine Bearbeitung ändert den etag; ConversionService::find() findet
 * dafür naturgemäß keinen Cache-Eintrag, ein „Invalidieren" ist also
 * implizit bereits durch den Schlüssel (fileId, etag) erledigt - der
 * Lazy-Trigger in ConversionController::status() reicht aus, sobald jemand
 * die Datei tatsächlich öffnet. Eager-Konvertierung bleibt als
 * Admin-Einstellung verfügbar (z.B. für Chöre, die eine neue Partitur sofort
 * für alle vorbereitet sehen wollen), siehe Settings\AdminSettings.
 */
class ScoreFileListener implements IEventListener {
	public function __construct(
		private IJobList $jobList,
		private IAppConfig $appConfig,
		private ClientFallback $clientFallback,
		private LoggerInterface $logger,
	) {
	}

	public function handle(Event $event): void {
		if (!$event instanceof NodeCreatedEvent && !$event instanceof NodeWrittenEvent) {
			return;
		}
		if (!$this->appConfig->getValueBool(Application::APP_ID, 'eager_conversion')) {
			return;
		}

		$node = $event->getNode();
		if (!str_ends_with(strtolower($node->getName()), '.mscz')) {
			return;
		}
		// Erst hier gefragt, nicht weiter oben: Das Urteil kann einen
		// Prozessstart oder eine HTTP-Anfrage kosten (Service\ClientFallback),
		// und dieser Listener haengt an JEDEM Schreibvorgang der Instanz. Ab
		// hier steht fest, dass es um eine .mscz geht und dass
		// Vorab-Konvertierung ueberhaupt gewuenscht ist.
		if ($this->clientFallback->applies()) {
			// Wo der Server nicht konvertieren kann, haette der Job nichts zu
			// tun als zu scheitern - und vorab gibt es nichts zu waermen, weil
			// auf diesem Weg ohnehin nichts gespeichert wird.
			return;
		}

		$owner = $node->getOwner();
		if ($owner === null) {
			$this->logger->warning('ScoreView: .mscz-Datei ohne ermittelbaren Owner, Eager-Konvertierung übersprungen: {name}', [
				'name' => $node->getName(),
			]);
			return;
		}

		$this->jobList->add(ConvertScoreJob::class, [
			'userId' => $owner->getUID(),
			'fileId' => $node->getId(),
		]);
	}
}
