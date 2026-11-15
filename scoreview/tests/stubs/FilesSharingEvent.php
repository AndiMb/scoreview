<?php

declare(strict_types=1);

/**
 * Stand-in for the one files_sharing class the public-share listener reacts to.
 * files_sharing is a server app, not part of nextcloud/ocp; the shape is copied
 * from NC 34 (apps/files_sharing/lib/Event/BeforeTemplateRenderedEvent.php).
 * Only required by the tests that need it (a require_once, so composer.lock stays untouched).
 */

namespace OCA\Files_Sharing\Event {
	use OCP\EventDispatcher\Event;
	use OCP\Share\IShare;

	if (!class_exists(BeforeTemplateRenderedEvent::class, false)) {
		class BeforeTemplateRenderedEvent extends Event {
			public const SCOPE_PUBLIC_SHARE_AUTH = 'publicShareAuth';

			public function __construct(
				private IShare $share,
				private ?string $scope = null,
			) {
				parent::__construct();
			}

			public function getShare(): IShare {
				return $this->share;
			}

			public function getScope(): ?string {
				return $this->scope;
			}
		}
	}
}
