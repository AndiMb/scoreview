<?php

declare(strict_types=1);

namespace OCA\ScoreView\Listener;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\BackgroundJob\ConvertScoreJob;
use OCP\BackgroundJob\IJobList;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Files\Events\Node\NodeCreatedEvent;
use OCP\Files\Events\Node\NodeWrittenEvent;
use OCP\IConfig;
use Psr\Log\LoggerInterface;

/**
 * @template-implements IEventListener<NodeCreatedEvent|NodeWrittenEvent>
 *
 * Erkennt .mscz-Dateien an der Endung, nicht am Mimetype - und das bleibt so:
 * `appinfo/mimetypemapping.json` ist reine Referenz, Nextcloud liest Custom-
 * Mappings NICHT aus dem App-Verzeichnis (siehe den Kommentar dort und
 * README.md#troubleshooting). Ob `application/x-musescore` überhaupt bekannt
 * ist, hängt also daran, ob der Betreiber die Datei nach
 * `config/mimetypemapping.json` kopiert und anschließend `occ files:scan`
 * ausgeführt hat. Ein Mimetype-Vergleich hier würde diesen Trigger damit von
 * einer Serverkonfiguration abhängig machen; ohne sie erkennt Nextcloud eine
 * .mscz generisch als application/zip und der Trigger liefe ins Leere.
 *
 * Löst seit Phase 7 standardmäßig KEINE Konvertierung mehr aus (vorher:
 * jeder Upload/jede Bearbeitung stieß sofort eine Konvertierung an - bei
 * z.B. 300 hochgeladenen Partituren 300 Konvertierungen für Dateien, die
 * vielleicht nie jemand öffnet, siehe PLAN.md Phase 7). Ein neuer Upload
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
		private IConfig $config,
		private LoggerInterface $logger,
	) {
	}

	public function handle(Event $event): void {
		if (!$event instanceof NodeCreatedEvent && !$event instanceof NodeWrittenEvent) {
			return;
		}
		if ($this->config->getAppValue(Application::APP_ID, 'eager_conversion', '0') !== '1') {
			return;
		}

		$node = $event->getNode();
		if (!str_ends_with(strtolower($node->getName()), '.mscz')) {
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
