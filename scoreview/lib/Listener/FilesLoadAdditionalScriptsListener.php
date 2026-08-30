<?php

declare(strict_types=1);

namespace OCA\ScoreView\Listener;

use OCA\Files\Event\LoadAdditionalScriptsEvent;
use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Service\ViewerPreferences;
use OCP\AppFramework\Services\IInitialState;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\IUserSession;
use OCP\Util;

/**
 * @template-implements IEventListener<LoadAdditionalScriptsEvent>
 *
 * Laedt das Viewer-Handler-Bundle nur auf der Files-Seite - laut Plan ist
 * ausschliesslich Viewer-Integration vorgesehen, kein eigener
 * Navigations-Eintrag (siehe appinfo/info.xml).
 *
 * Dieselbe Stelle liefert die Anzeigeeinstellungen der Nutzerin mit
 * (Service\ViewerPreferences). Der Viewer braucht sie beim allerersten
 * Rendern; als eigene HTTP-Anfrage waere sichtbar, wie die Partitur einen
 * Moment lang in der Vorgabefarbe aufleuchtet, bevor die eigene Farbe
 * nachkommt.
 */
class FilesLoadAdditionalScriptsListener implements IEventListener {
	public function __construct(
		private IInitialState $initialState,
		private ViewerPreferences $preferences,
		private IUserSession $userSession,
	) {
	}

	public function handle(Event $event): void {
		if (!$event instanceof LoadAdditionalScriptsEvent) {
			return;
		}
		$this->initialState->provideInitialState(
			'viewer-preferences',
			$this->preferences->get($this->userSession->getUser()?->getUID()),
		);
		Util::addScript(Application::APP_ID, Application::APP_ID . '-viewer');
	}
}
