<?php

declare(strict_types=1);

namespace OCA\ScoreView\Listener;

use OCA\Files_Sharing\Event\BeforeTemplateRenderedEvent;
use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Service\FeatureConfig;
use OCP\Constants;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Util;

/**
 * @template-implements IEventListener<BeforeTemplateRenderedEvent>
 *
 * Hangs the framing handler (src/public.js) on the public link page `/s/{token}`.
 *
 * The page keeps Nextcloud's own CSP, which has no `wasm-unsafe-eval`; the
 * viewer itself therefore never runs on `/s/…` but in an iframe on this app's
 * own page, which carries Viewer\ViewerPolicy (the same split as for the
 * mobile apps' direct editing). This script is only the bridge: it registers a
 * handler with the Viewer app and points an iframe at that page.
 *
 * Nothing is loaded when
 * - the admin switch is off (the default),
 * - the share cannot be read - a file drop (create without read) renders
 *   files_sharing's upload-only view, where no score is listed,
 * - the event is the one for the password page (it carries a scope there):
 *   no score is reachable before the visitor has authenticated.
 */
class PublicShareScriptsListener implements IEventListener {
	public function __construct(
		private FeatureConfig $features,
	) {
	}

	public function handle(Event $event): void {
		if (!$event instanceof BeforeTemplateRenderedEvent) {
			return;
		}
		if ($event->getScope() !== null || !$this->features->publicShareEnabled()) {
			return;
		}
		if (($event->getShare()->getPermissions() & Constants::PERMISSION_READ) === 0) {
			return;
		}
		Util::addScript(Application::APP_ID, Application::APP_ID . '-public');
	}
}
