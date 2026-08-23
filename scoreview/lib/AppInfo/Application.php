<?php

declare(strict_types=1);

namespace OCA\ScoreView\AppInfo;

use OCA\Files\Event\LoadAdditionalScriptsEvent;
use OCA\ScoreView\Listener\AddCspListener;
use OCA\ScoreView\Listener\FilesLoadAdditionalScriptsListener;
use OCA\ScoreView\Listener\ScoreFileListener;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\Files\Events\Node\NodeCreatedEvent;
use OCP\Files\Events\Node\NodeWrittenEvent;
use OCP\Security\CSP\AddContentSecurityPolicyEvent;

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

		$context->registerEventListener(LoadAdditionalScriptsEvent::class, FilesLoadAdditionalScriptsListener::class);

		// Lockert die CSP fuer WASM-Audiodekodierung und den konfigurierten
		// SoundFont-Host (Phase 9) - siehe Listener\AddCspListener fuer den
		// vollen Grund (beides empirisch als CSP-Blocker gefunden).
		$context->registerEventListener(AddContentSecurityPolicyEvent::class, AddCspListener::class);
	}

	public function boot(IBootContext $context): void {
	}
}
