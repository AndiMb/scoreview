<?php

declare(strict_types=1);

namespace OCA\ScoreView\AppInfo;

use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;

class Application extends App implements IBootstrap {
	public const APP_ID = 'scoreview';

	public function __construct(array $urlParams = []) {
		parent::__construct(self::APP_ID, $urlParams);
	}

	public function register(IRegistrationContext $context): void {
		// Event-Listener (NodeWrittenEvent/NodeCreatedEvent -> Konvertierungs-Job)
		// und Service-Registrierungen kommen in Phase 3 hinzu.
	}

	public function boot(IBootContext $context): void {
	}
}
