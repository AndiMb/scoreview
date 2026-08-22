<?php

declare(strict_types=1);

namespace OCA\ScoreView\AppInfo;

use OCA\ScoreView\Listener\ScoreFileListener;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\Files\Events\Node\NodeCreatedEvent;
use OCP\Files\Events\Node\NodeWrittenEvent;

class Application extends App implements IBootstrap {
	public const APP_ID = 'scoreview';

	public function __construct(array $urlParams = []) {
		parent::__construct(self::APP_ID, $urlParams);
	}

	public function register(IRegistrationContext $context): void {
		// NICHT ueber <background-jobs> in info.xml - das ist fuer periodische
		// Jobs ohne eigenes Argument gedacht. ConvertScoreJob wird stattdessen
		// hier ausgeloest, gezielt pro Datei, mit fileId/userId als Argument
		// (siehe ScoreFileListener).
		$context->registerEventListener(NodeCreatedEvent::class, ScoreFileListener::class);
		$context->registerEventListener(NodeWrittenEvent::class, ScoreFileListener::class);
	}

	public function boot(IBootContext $context): void {
	}
}
