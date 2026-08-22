<?php

declare(strict_types=1);

namespace OCA\ScoreView\Listener;

use OCA\ScoreView\BackgroundJob\ConvertScoreJob;
use OCP\BackgroundJob\IJobList;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Files\Events\Node\NodeCreatedEvent;
use OCP\Files\Events\Node\NodeWrittenEvent;
use Psr\Log\LoggerInterface;

/**
 * @template-implements IEventListener<NodeCreatedEvent|NodeWrittenEvent>
 *
 * Erkennt .mscz-Dateien an der Endung, nicht am (Sniffing-)Mimetype: ein
 * eigenes mimetypemapping.json kommt erst in Phase 4 (betrifft ohnehin nur
 * Files-UI-Icon/Viewer-Zuordnung, nicht diesen Trigger hier) - bis dahin
 * würde MuseScore-Dateien sonst generisch als application/zip erkannt und
 * der Trigger liefe ins Leere.
 */
class ScoreFileListener implements IEventListener {
	public function __construct(
		private IJobList $jobList,
		private LoggerInterface $logger,
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
		$owner = $node->getOwner();
		if ($owner === null) {
			$this->logger->warning('ScoreView: .mscz-Datei ohne ermittelbaren Owner, Konvertierung übersprungen: {name}', [
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
