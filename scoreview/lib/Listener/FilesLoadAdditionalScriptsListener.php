<?php

declare(strict_types=1);

namespace OCA\ScoreView\Listener;

use OCA\Files\Event\LoadAdditionalScriptsEvent;
use OCA\ScoreView\AppInfo\Application;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Util;

/**
 * @template-implements IEventListener<LoadAdditionalScriptsEvent>
 *
 * Laedt das Viewer-Handler-Bundle nur auf der Files-Seite - laut Plan ist
 * ausschliesslich Viewer-Integration vorgesehen, kein eigener
 * Navigations-Eintrag (siehe appinfo/info.xml).
 */
class FilesLoadAdditionalScriptsListener implements IEventListener {
	public function handle(Event $event): void {
		if (!$event instanceof LoadAdditionalScriptsEvent) {
			return;
		}
		Util::addScript(Application::APP_ID, Application::APP_ID . '-viewer');
	}
}
