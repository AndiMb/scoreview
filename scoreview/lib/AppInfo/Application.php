<?php

declare(strict_types=1);

namespace OCA\ScoreView\AppInfo;

use OCA\Files\Event\LoadAdditionalScriptsEvent;
use OCA\ScoreView\Listener\AddCspListener;
use OCA\ScoreView\Listener\FilesLoadAdditionalScriptsListener;
use OCA\ScoreView\Listener\NodeDeletedListener;
use OCA\ScoreView\Listener\RegisterDirectEditorListener;
use OCA\ScoreView\Listener\ScoreFileListener;
use OCA\ScoreView\Listener\ScoreMimetypeListener;
use OCA\ScoreView\Listener\UserDeletedListener;
use OCA\ScoreView\Middleware\DirectAccessMiddleware;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\DirectEditing\RegisterDirectEditorEvent;
use OCP\Files\Events\Node\NodeCreatedEvent;
use OCP\Files\Events\Node\NodeDeletedEvent;
use OCP\Files\Events\Node\NodeWrittenEvent;
use OCP\Security\CSP\AddContentSecurityPolicyEvent;
use OCP\User\Events\UserDeletedEvent;

class Application extends App implements IBootstrap {
	public const APP_ID = 'scoreview';

	/**
	 * Der Mimetype, an dem .mscz erkannt wird - an Nextclouds Viewer
	 * (src/lib/scoreFile.js), an der Auslieferung der Partitur selbst
	 * (Controller\ConversionController::source) und an der Editorliste der
	 * mobilen Apps (DirectEditing\ScoreDirectEditor). Die App traegt ihn
	 * selbst in die Instanz ein (Service\MimetypeRegistration); die
	 * *Erkennung* neuer Uploads bleibt Nextclouds Sache, siehe E6 in
	 * docs/architecture.md.
	 */
	public const MSCZ_MIMETYPE = 'application/x-musescore';

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

		// Zieht den Mimetype frisch hochgeladener Partituren nach. Getrennt
		// vom Listener darueber, weil der an der Einstellung
		// `eager_conversion` haengt und der Mimetype immer stimmen muss -
		// siehe Listener\ScoreMimetypeListener.
		$context->registerEventListener(NodeCreatedEvent::class, ScoreMimetypeListener::class);
		$context->registerEventListener(NodeWrittenEvent::class, ScoreMimetypeListener::class);

		// Aufraeumen. Bewusst getrennt: der Cache verschwindet schon beim
		// Loeschen der Datei (regenerierbar), die Notizen erst, wenn die
		// fileId endgueltig weg ist - siehe NodeDeletedListener und
		// BackgroundJob\CleanupOrphansJob.
		$context->registerEventListener(NodeDeletedEvent::class, NodeDeletedListener::class);
		$context->registerEventListener(UserDeletedEvent::class, UserDeletedListener::class);

		$context->registerEventListener(LoadAdditionalScriptsEvent::class, FilesLoadAdditionalScriptsListener::class);

		// Der Einstieg fuer die mobilen Nextcloud-Apps: Sie laden keine
		// Skripte der Files-Seite und erreichen den Viewer nur ueber
		// Nextclouds Direct Editing (siehe DirectEditing\ScoreDirectEditor).
		$context->registerEventListener(RegisterDirectEditorEvent::class, RegisterDirectEditorListener::class);

		// Laesst die mit #[DirectTokenOrSession] markierten Routen auch gegen
		// ein Direct-Editing-Token zu - der Weg der mobilen Apps, deren Seite
		// ohne Sitzungscookie ankommt (gemessen: ihre Folgeanfragen bekommen
		// sonst 401). Bewusst nicht global: Die Middleware soll nur die
		// Controller dieser App sehen, und sie ruehrt dort nichts an, was das
		// Attribut nicht traegt.
		$context->registerMiddleware(DirectAccessMiddleware::class);

		// Lockert die CSP fuer WASM-Audiodekodierung und den konfigurierten
		// SoundFont-Host - siehe Listener\AddCspListener fuer den vollen
		// Grund (beides empirisch als CSP-Blocker gefunden).
		$context->registerEventListener(AddContentSecurityPolicyEvent::class, AddCspListener::class);
	}

	public function boot(IBootContext $context): void {
	}
}
