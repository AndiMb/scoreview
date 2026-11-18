<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\BackgroundJob\ConvertScoreJob;
use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Http\ArtifactResponse;
use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCA\ScoreView\Middleware\DirectAccessContext;
use OCA\ScoreView\Service\ClientFallback;
use OCA\ScoreView\Service\ConversionBackend;
use OCA\ScoreView\Service\ConversionConfig;
use OCA\ScoreView\Service\ConversionService;
use OCA\ScoreView\Service\LocalConverter;
use OCA\ScoreView\Service\PracticeTrackService;
use OCA\ScoreView\Service\ShareConversionQuota;
use OCA\ScoreView\Service\SoundFontService;
use OCA\ScoreView\Service\UserFileResolver;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\StreamResponse;
use OCP\BackgroundJob\IJobList;
use OCP\Files\File;
use OCP\Files\NotFoundException;
use OCP\IAppConfig;
use OCP\ICache;
use OCP\ICacheFactory;
use OCP\IL10N;
use OCP\IRequest;
use OCP\IURLGenerator;

/**
 * Nie eine rohe fileId ungeprueft vertrauen: jede Anfrage loest die Datei
 * ueber den Dateibaum der eingeloggten Nutzerin auf (UserFileResolver),
 * nicht per direktem DB-Lookup - Nextclouds Node-API liefert nur, worauf
 * die Nutzerin tatsaechlich Zugriff hat.
 *
 * Alle Auslieferungsrouten (page/midi/timing/measures/meta) sind
 * unveraenderlich - ETag/Last-Modified/Cache-Control:immutable setzen,
 * damit ein zweites Oeffnen derselben Datei 304 statt einer erneuten
 * Uebertragung bekommt (vorher wurde bei jedem Oeffnen alles neu
 * uebertragen). Die eigentliche 304-Antwort baut Nextclouds
 * NotModifiedMiddleware anhand von setETag()/setLastModified() automatisch,
 * hier wird nur gesetzt.
 *
 * `immutable` verspricht dem Browser, dass sich unter DIESER URL nie etwas
 * aendert - deshalb muss der Cache-Schluessel in der URL stehen und nicht
 * nur im IAppData-Pfad (siehe ArtifactResponse::version()). Ohne den Parameter zeigte
 * eine neu konvertierte Partitur unter unveraenderter URL weiter die alten
 * Seiten: Chrome revalidiert Unterressourcen beim Neuladen nicht, und
 * `immutable` verbietet es ausdruecklich - sichtbar wurde die neue Fassung
 * erst nach hartem Neuladen oder in einem frischen Profil.
 */
class ConversionController extends Controller {
	use JsonErrors;

	/**
	 * Bis hierhin darf eine Partitur im BROWSER gesetzt werden. Viel kleiner
	 * als die Serverschranke (`max_score_bytes`, 100 MB): Dort raeumt der
	 * Prozessabbau auf, hier laeuft es auf einem Tablet im selben Speicher wie
	 * die Seite. Der Wert geht in der Antwort mit, damit der Client abbrechen
	 * kann, BEVOR er 14 MB Engine geladen hat.
	 */
	private const DEFAULT_CLIENT_MAX_BYTES = 10485760;

	/**
	 * How often a status poll queues the conversion again at most. Core's
	 * IJobList::add() is an UPDATE when the job already exists (it resets
	 * the reservation and pushes `last_checked`), and the viewer polls every
	 * few seconds while it waits - on SQLite such writes collide with the
	 * job that is converting. The UPDATE is still wanted now and then: it is
	 * what frees a job whose cron run died while holding it.
	 */
	public const REQUEUE_INTERVAL_SECONDS = 60;

	/** Null without a memory cache - then every poll queues, as before. */
	private ?ICache $requeueCache;

	public function __construct(
		IRequest $request,
		private UserFileResolver $fileResolver,
		private ConversionService $conversionService,
		private ClientFallback $clientFallback,
		private LocalConverter $localConverter,
		private IJobList $jobList,
		private IURLGenerator $urlGenerator,
		private IAppConfig $appConfig,
		private IL10N $l,
		private SoundFontService $soundFontService,
		private ConversionBackend $backend,
		ICacheFactory $cacheFactory,
		private DirectAccessContext $directAccess,
		private ShareConversionQuota $shareQuota,
	) {
		parent::__construct(Application::APP_ID, $request);
		$this->requeueCache = $cacheFactory->isAvailable() ? $cacheFactory->createDistributed('scoreview-requeue') : null;
	}

	/**
	 * Dieser Endpunkt hat mit jobList->add() einen Seiteneffekt und braucht
	 * deshalb die CSRF-Pruefung - anders als die reinen Auslieferungsrouten
	 * unten. Sie steht trotz #[NoCSRFRequired] weiterhin: Das Attribut nimmt
	 * sie nur Nextclouds SecurityMiddleware aus der Hand, damit die
	 * sitzungslose Anfrage einer mobilen App ueberhaupt bis zur eigenen
	 * Middleware kommt; #[DirectTokenOrSession] ohne Schalter holt sie fuer
	 * den Sitzungsfall zurueck (Middleware\DirectAccessMiddleware).
	 */
	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession(share: 'read')]
	public function status(int $fileId): JSONResponse {
		$node = $this->fileResolver->resolveScore($fileId);
		if ($node === null) {
			return new JSONResponse(['status' => 'error', 'error' => $this->l->t('File not found or no access.')], Http::STATUS_NOT_FOUND);
		}

		$etag = $node->getEtag();
		$conversion = $this->conversionService->find($fileId, $etag);
		if ($conversion === null) {
			// Lazy-Trigger: Datei existierte schon vor App-Aktivierung, oder
			// der Event-Listener hat die Konvertierung nicht eager angestoßen
			// (Standardfall, siehe ScoreFileListener). Bewusst
			// KEIN eigenes createPending() hier: ConvertScoreJob::run() legt
			// die Zeile selbst an. Würde der Controller sie vorab anlegen,
			// fände der Job beim Start bereits eine (von ihm selbst noch gar
			// nicht bearbeitete) "pending"-Zeile vor und würde die
			// Konvertierung wegen seiner eigenen Idempotenz-Prüfung
			// (status !== error => überspringen) fälschlich als "läuft
			// schon" überspringen - die Konvertierung würde für immer auf
			// "pending" hängen bleiben.
			return $this->pendingOrClient($fileId, $node);
		}

		// Der Lauf, der diesen Datensatz hielt, ist gestorben (siehe
		// ConversionService::isStale). Kein eigener Zweig und kein fuenfter
		// Status: markError() schreibt in dieselbe Entity, die gleich darauf
		// gelesen wird - der Datensatz faellt damit in den error-Zweig unten,
		// der ohnehin schon einen neuen Versuch einreiht. Kommt der Cron
		// zurueck, konvertiert die Partitur beim naechsten Durchgang.
		if ($this->conversionService->isStale($conversion)) {
			$this->conversionService->markError(
				$conversion,
				'The conversion run never finished.',
				ScoreConversion::ERROR_STALE,
			);
		}

		$body = ['status' => $conversion->getStatus()];
		if ($conversion->getStatus() === ScoreConversion::STATUS_ERROR) {
			// The stored text is the exception's, written for the log: it can
			// name the sidecar's address, server paths or the converter's
			// command line. A visitor on a public link gets the code only
			// (S12); members keep the text as a detail behind the message.
			if ($this->directAccess->shareGrant() === null) {
				$body['error'] = $conversion->getErrorMessage();
			}
			// error_code statt uebersetztem error_message: der Text wird
			// einmal beim Konvertieren geschrieben, aber von beliebigen Nutzerinnen
			// in beliebigen Sprachen gelesen - IL10N ist an die Sprache der GERADE
			// ANFRAGENDEN Person gebunden, waere hier also falsch. error_message
			// bleibt daneben als unveraendertes technisches Detail bestehen.
			$body['errorCode'] = $conversion->getErrorCode() ?? ScoreConversion::ERROR_UNKNOWN;
			// Ein einmal fehlgeschlagener Versuch blieb sonst für immer auf
			// "error" hängen, auch wenn die eigentliche Ursache (z.B. ein
			// falsch konfiguriertes Sidecar-Secret) längst behoben wurde -
			// ein erneutes Öffnen derselben Datei zeigte dann nur den alten,
			// stehengebliebenen Fehler statt es einfach nochmal zu
			// versuchen. ConvertScoreJob::run() erlaubt genau das (sein
			// Idempotenz-Guard überspringt nur status !== error).
			//
			// Es sei denn, es lag gar nicht an der Partitur: Wenn die INSTANZ
			// nicht konvertieren kann, holt ein erneuter Serverlauf denselben
			// Fehler noch einmal - dann uebernimmt der Browser
			// (Service\ClientFallback).
			if ($this->clientFallback->noteConversionError($conversion->getErrorCode())) {
				return $this->clientResponse($node, $conversion->getErrorCode());
			}
			if (!$this->retryConversion($fileId)) {
				return $this->quotaExceeded();
			}
		} elseif ($conversion->getStatus() === ScoreConversion::STATUS_READY) {
			if (!$this->conversionService->isCurrent($conversion)) {
				// Aeltere Cache-Formatversion (oder, auf dem lokalen Weg, eine
				// aeltere Engine, siehe ConversionService::isCurrent()) - wie "nicht fertig" behandeln
				// statt Cache-Dateien auszuliefern, die nicht mehr zum aktuellen
				// Controller/Sidecar-Format passen, und eine Neukonvertierung
				// anstossen statt manuellem Eingriff in der DB.
				return $this->pendingOrClient($fileId, $node);
			}
			try {
				$body['files'] = $this->buildFileUrls($fileId, $conversion);
			} catch (NotFoundException) {
				// Cache-Datei fehlt trotz status=ready (z.B. Ordner ausserhalb der
				// App geloescht) - wie "nicht fertig" behandeln statt eines 500ers,
				// analog zur format_version-Pruefung oben.
				return $this->pendingOrClient($fileId, $node);
			}
			// Kein Cache-Artefakt einer bestimmten Partitur, sondern eine
			// instanzweite Ressource (siehe docs/architecture.md E1) -
			// deshalb hier statt in buildFileUrls() mitgegeben.
			$body['soundFontUrl'] = $this->soundFontUrl();
			// Ob neben der Partitur angelegt werden darf - der Viewer bietet
			// „Tracks fuer alle Stimmen" (E13, H10) nur dann an.
			$body['canWriteFolder'] = PracticeTrackService::canWriteNextTo($node);
			// Womit diese Darstellung erzeugt wurde, zum ANZEIGEN im Viewer
			// (E3). Der aufgezeichnete Weg dieses Datensatzes, nicht die
			// aktuelle Admin-Einstellung: nach einem Wechsel des
			// Konvertierungswegs bliebe eine gecachte Partitur die des alten.
			// null heisst "vor Einfuehrung der Spalte konvertiert", nicht
			// "keiner von beiden". Die MuseScore-Version steht in meta.json,
			// die der Viewer ohnehin laedt - sie wird hier nicht verdoppelt.
			$body['renderer'] = ['backend' => $conversion->getBackend()];
			// Ob „Neu konvertieren" ueberhaupt angeboten werden darf - dieselbe
			// Bedingung, die reconvert() dann noch einmal selbst prueft (die
			// Antwort hier ist eine Anzeigehilfe, keine Absicherung). Ohne sie
			// stuende der Knopf auch an einer nur geliehenen Partitur und
			// endete jedes Mal in einem 403.
			// Never for a visitor of a public link: the node is the share
			// owner's and may well be updateable, but the visitor is not
			// the owner, and reconvert does not take a share token.
			$body['canReconvert'] = $node->isUpdateable() && $this->directAccess->shareGrant() === null;
			// Whether the server can engrave display variants (E19) - a
			// capability, not a path (E15). The choices themselves come from
			// meta.json, which the viewer loads anyway.
			$body['variants'] = ['supported' => $this->backend->supportsVariants()];
		}
		return new JSONResponse($body);
	}

	/**
	 * Verwirft die gespeicherte Konvertierung dieser Datei und laesst sie neu
	 * erzeugen - der Weg, eine Partitur von einer neueren Fassung der App
	 * noch einmal setzen zu lassen, ohne sie anzufassen. Ohne ihn half nur,
	 * `ConversionService::CURRENT_FORMAT_VERSION` zu erhoehen, was jede
	 * Partitur der Instanz trifft statt der einen, um die es geht.
	 *
	 * Verwerfen statt „Job noch einmal einreihen": ConvertScoreJob
	 * ueberspringt einen Datensatz, der `ready` UND aktuellen Formats ist -
	 * ein blosses jobList->add() taete hier also gar nichts. Ueber
	 * deleteAllForFile() geht mit den Statuszeilen auch der Cache-Ordner weg;
	 * so kann keine Mischung aus alten und neuen Artefakten stehenbleiben.
	 *
	 * Nur mit Schreibrecht: Wer die Datei ohnehin neu speichern duerfte,
	 * loeste dieselbe Neukonvertierung auch dadurch aus (der etag aendert
	 * sich). Wer sie nur lesen darf, soll die Darstellung nicht fuer alle
	 * anderen verwerfen koennen - der Cache haengt an der fileId, nicht an
	 * der Nutzerin.
	 *
	 * Rate-limited (S4): every call discards the cache and queues a full
	 * conversion. Session only - the route carries no DirectTokenOrSession,
	 * so there is no anonymous counterpart to limit.
	 */
	#[NoAdminRequired]
	#[UserRateLimit(limit: 5, period: 300)]
	public function reconvert(int $fileId): JSONResponse {
		$node = $this->fileResolver->resolveScore($fileId);
		if ($node === null) {
			return new JSONResponse(['status' => 'error', 'error' => $this->l->t('File not found or no access.')], Http::STATUS_NOT_FOUND);
		}
		if (!$node->isUpdateable()) {
			return new JSONResponse(['status' => 'error', 'error' => $this->l->t('Not allowed to convert this score again.')], Http::STATUS_FORBIDDEN);
		}

		$conversion = $this->conversionService->find($fileId, $node->getEtag());
		if ($conversion !== null
			&& in_array($conversion->getStatus(), [ScoreConversion::STATUS_PENDING, ScoreConversion::STATUS_PROCESSING], true)
			&& !$this->conversionService->isStale($conversion)) {
			// Laeuft ohnehin gerade - nichts verwerfen, sonst schriebe der
			// laufende Job sein Ergebnis auf eine geloeschte Zeile und die
			// Konvertierung liefe ein zweites Mal.
			//
			// An einem TOTEN Datensatz gilt das nicht (isStale): dort laeuft
			// nichts mehr, das sein Ergebnis noch schreiben koennte, und
			// dieser Knopf ist der Weg heraus. Ihn auch dort zu verweigern
			// hiesse, die Nutzerin auf einen Lauf warten zu lassen, den es
			// nicht mehr gibt.
			return new JSONResponse(['status' => $conversion->getStatus()]);
		}

		$this->conversionService->deleteAllForFile($fileId);
		$this->queueConversion($fileId);
		return new JSONResponse(['status' => ScoreConversion::STATUS_PENDING]);
	}

	/** Reiht eine (Neu-)Konvertierung ein - Idempotenz/Ueberspringen bereits laufender Jobs regelt ConvertScoreJob selbst. */
	private function queueConversion(int $fileId): void {
		$this->jobList->add(ConvertScoreJob::class, [
			'userId' => $this->fileResolver->attributionUserId(),
			'fileId' => $fileId,
		]);
	}

	/**
	 * queueConversion() from a status poll - at most once per
	 * REQUEUE_INTERVAL_SECONDS for the same file and user.
	 */
	private function retryConversion(int $fileId): bool {
		$grant = $this->directAccess->shareGrant();
		$key = null;
		if ($this->requeueCache !== null) {
			// A visitor has no user id; her link is the unit that is throttled.
			$key = $fileId . ':' . ($grant !== null ? 'share:' . $grant->tokenDigest : ($this->fileResolver->currentUserId() ?? ''));
			if ($this->requeueCache->get($key) !== null) {
				return true;
			}
		}
		// The quota counts where a job is really added - never on a mere
		// poll. A job that is still listed is not new work (matters without
		// a memory cache, where every poll gets here); the requeue check
		// above bounds a failing or no-op score to one unit per interval.
		if ($grant !== null
			&& !$this->jobList->has(ConvertScoreJob::class, ['userId' => $this->fileResolver->attributionUserId(), 'fileId' => $fileId])
			&& !$this->shareQuota->consume($grant)) {
			return false;
		}
		$this->queueConversion($fileId);
		$this->requeueCache?->set($key, 1, self::REQUEUE_INTERVAL_SECONDS);
		return true;
	}

	private function quotaExceeded(): JSONResponse {
		return new JSONResponse(['status' => ScoreConversion::STATUS_ERROR, 'errorCode' => ShareConversionQuota::ERROR_CODE], Http::STATUS_TOO_MANY_REQUESTS);
	}

	/**
	 * Alle Cache-Artefakte ueber EINE Route - statt fuenf Methoden, die
	 * sich nur in Dateiname und MIME-Typ unterschieden. Welche Namen
	 * gueltig sind und welchen Typ sie tragen, weiss
	 * ConversionService::getArtifact(); dieser Controller kuemmert sich
	 * nur um Zugriffsrecht, Cache-Status und HTTP-Header.
	 */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	#[PublicPage]
	#[DirectTokenOrSession(csrfInSession: false, share: 'read')]
	public function artifact(int $fileId, string $name): Http\Response {
		return $this->serveCachedFile($fileId, $name);
	}

	/**
	 * Die `.mscz` selbst - fuer die Konvertierung im Browser.
	 *
	 * Warum eine eigene Route und nicht WebDAV: Der Viewer bekommt von
	 * Nextclouds Viewer nur die `fileId` (siehe src/viewer.js), keinen Pfad.
	 * Ueber diese Route gilt dieselbe Rechtepruefung wie fuer jedes Artefakt
	 * (UserFileResolver), an genau einer Stelle statt an zweien.
	 *
	 * `immutable` ist auch hier ehrlich, weil der Etag als `v` in der URL
	 * steht (siehe ArtifactResponse::version()): Aendert sich die Datei, aendert sich die
	 * URL.
	 */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	#[PublicPage]
	#[DirectTokenOrSession(csrfInSession: false, share: 'download')]
	public function source(int $fileId): Http\Response {
		$node = $this->fileResolver->resolveScore($fileId);
		if ($node === null) {
			return $this->notFound();
		}

		try {
			$handle = $node->fopen('rb');
		} catch (\Throwable) {
			$handle = false;
		}
		if ($handle === false) {
			return new JSONResponse(['error' => $this->l->t('Requested file does not exist.')], Http::STATUS_NOT_FOUND);
		}

		$response = new StreamResponse($handle);
		// Der Mimetype der Partitur - derselbe, an dem Nextclouds Viewer die
		// Datei ueberhaupt erkennt (siehe docs/architecture.md E6). Nicht aus
		// dem Node gelesen: Dort steht auf einer Instanz ohne
		// Mimetype-Registrierung `application/octet-stream`, und der Browser
		// soll nicht von der Serverkonfiguration abhaengen.
		$response->addHeader('Content-Type', 'application/x-musescore');
		// Wie bei den Artefakten (serveCachedFile): Diese Route liefert
		// Material, das nur der Viewer per XHR liest - nie ein Dokument, das
		// der Browser selbst darstellen soll.
		$response->addHeader('Content-Disposition', 'attachment');
		$response->addHeader('Content-Length', (string)$node->getSize());
		$response->setETag($node->getEtag());
		$response->cacheFor(ArtifactResponse::IMMUTABLE_CACHE_SECONDS, false, true);
		return $response;
	}

	/**
	 * Es gibt (noch) nichts Fertiges - und jetzt entscheidet sich, wer weiter
	 * arbeitet. Kann der Server konvertieren, wird ein Job
	 * eingereiht und der Viewer wartet. Kann er es nicht, waere das Warten
	 * endlos: Dann uebernimmt der Browser (Service\ClientFallback).
	 */
	private function pendingOrClient(int $fileId, File $node): JSONResponse {
		$grund = $this->clientFallback->reason();
		if ($grund !== null) {
			return $this->clientResponse($node, $grund);
		}
		if (!$this->retryConversion($fileId)) {
			return $this->quotaExceeded();
		}
		return new JSONResponse(['status' => ScoreConversion::STATUS_PENDING]);
	}

	/**
	 * „Ich kann diese Partitur nicht setzen; hier ist alles, um es selbst zu
	 * tun." Kein Fehler - ein Fehler ist ein Ende, dies ist eine
	 * Weiterleitung.
	 *
	 * Bewusst dieselbe Form wie die `ready`-Antwort, soweit sie sich deckt
	 * (`etag`, `soundFontUrl`, `canReconvert`): Was der Viewer daraus baut,
	 * ist derselbe onReady-Koerper - nur dass die Artefakt-URLs erst im
	 * Browser entstehen. Es gibt hier nichts zu cachen und nichts zu
	 * speichern; auf einer Instanz, die so laeuft, bleibt die Statustabelle
	 * leer.
	 */
	private function clientResponse(File $node, ?string $grund): JSONResponse {
		// A link with "hide download" gives the browser no source to set -
		// an end, with its reason, instead of a fallback bound to fail
		// (Service\ClientFallback::sourceOpenTo). Nothing is queued: the
		// server cannot convert, that is why we are here.
		if (!ClientFallback::sourceOpenTo($this->directAccess->shareGrant())) {
			return new JSONResponse(['status' => ScoreConversion::STATUS_ERROR, 'errorCode' => ClientFallback::SOURCE_HIDDEN]);
		}
		$etag = $node->getEtag();
		return new JSONResponse([
			'status' => ClientFallback::STATUS_CLIENT,
			// Als CODE, nicht als Satz - uebersetzt wird im Browser (E4).
			'reason' => $grund ?? ScoreConversion::ERROR_UNKNOWN,
			'sourceUrl' => $this->urlGenerator->linkToRoute(
				Application::APP_ID . '.conversion.source', ['fileId' => $node->getId(), 'v' => $etag]),
			// Die Engine-Version als Cache-Schluessel: Ein Wechsel des
			// Engine-Pakets muss beim Client ankommen, obwohl die Auslieferung
			// `immutable` ist. Im Pfad, nicht als ?v= - nur so gilt sie auch
			// fuer .wasm und .data (siehe EngineController).
			'engineUrl' => $this->urlGenerator->linkToRoute(
				Application::APP_ID . '.engine.get',
				['version' => $this->localConverter->engineVersion(), 'name' => 'scoreview.mjs']),
			'maxBytes' => $this->appConfig->getValueInt(
				Application::APP_ID, ConversionConfig::CLIENT_MAX_SCORE_BYTES, self::DEFAULT_CLIENT_MAX_BYTES),
			'soundFontUrl' => $this->soundFontUrl(),
			'canWriteFolder' => PracticeTrackService::canWriteNextTo($node),
			'etag' => $etag,
			// Anders als bei einer gecachten Konvertierung ohne Rechtepruefung:
			// Hier verwirft „neu konvertieren" nichts Gemeinsames, sondern
			// laesst denselben Browser noch einmal rechnen. Wer die Partitur
			// sehen darf, darf das.
			'canReconvert' => true,
		]);
	}

	private function serveCachedFile(int $fileId, string $name): Http\Response {
		$node = $this->fileResolver->resolveScore($fileId);
		if ($node === null) {
			return $this->notFound();
		}

		$etag = $node->getEtag();
		$conversion = $this->conversionService->find($fileId, $etag);
		if (!$this->conversionService->isServable($conversion)) {
			return new JSONResponse(['error' => $this->l->t('Conversion not finished yet.')], Http::STATUS_NOT_FOUND);
		}

		try {
			[$file, $mimeType] = $this->conversionService->getArtifact($fileId, $etag, $name);
		} catch (NotFoundException) {
			return new JSONResponse(['error' => $this->l->t('Requested file does not exist.')], Http::STATUS_NOT_FOUND);
		}

		// Ein resource-Handle (ISimpleFile::read()) statt eines Pfads - IAppData
		// kann auf Objektspeicher liegen, ein lokaler Dateipfad ist nicht
		// garantiert. So landet der Dateiinhalt nie komplett als PHP-String im
		// Speicher. ArtifactResponse streams it and gzips SVG and JSON on the
		// way out, which the stock web server config does not.
		return ArtifactResponse::immutable($file, $mimeType, $this->request, $etag, $conversion->getUpdatedAt());
	}

	/**
	 * Woher der Browser sein SoundFont holt. Eine gesetzte
	 * Admin-Einstellung gewinnt (eigenes Hosting, anderes/besseres
	 * SoundFont); ohne sie liefert die App es selbst aus
	 * (Controller\SoundFontController).
	 *
	 * Der leere Auslieferungszustand darf deshalb NICHT "kein Ton" bedeuten:
	 * sonst waere die App fuer jeden stumm, der nicht selbst ein 40-MB-SF3
	 * CORS-faehig hostet.
	 *
	 * The app's own address carries the SoundFont's version as `?v=`, like
	 * the artifacts carry theirs (ArtifactResponse::version()): it is delivered `immutable`,
	 * and without a version in the URL a browser kept the first SoundFont it
	 * ever got, through any later change of sidecar image or download URL.
	 * '0' stands for "not fetched yet"; SoundFontController does not let the
	 * browser keep what it delivers under a version that is not current.
	 */
	private function soundFontUrl(): string {
		$configured = ConversionConfig::browserSoundFontUrl($this->appConfig);
		if ($configured !== '') {
			return $configured;
		}
		$version = $this->soundFontService->expectedVersion();
		return $this->urlGenerator->linkToRoute(Application::APP_ID . '.sound_font.get', ['v' => $version !== '' ? $version : '0']);
	}

	private function buildFileUrls(int $fileId, ScoreConversion $conversion): array {
		$etag = $conversion->getEtag();
		$pageCount = $this->conversionService->getPageCount($conversion);
		$version = ArtifactResponse::version($conversion);
		$artifact = fn (string $name) => $this->urlGenerator->linkToRoute(
			Application::APP_ID . '.conversion.artifact', ['fileId' => $fileId, 'name' => $name, 'v' => $version]);
		$pages = [];
		for ($n = 1; $n <= $pageCount; $n++) {
			$pages[] = $artifact("page-{$n}");
		}
		return [
			'pageCount' => $pageCount,
			'pages' => $pages,
			'midi' => $artifact('midi'),
			'timingJson' => $artifact('timing'),
			'measuresJson' => $artifact('measures'),
			'metaJson' => $artifact('meta'),
			// Anker-Etag für Notizen - der aktuelle etag dieser
			// Konvertierung, damit der Client neue Notizen mit einem gültigen
			// Sekundäranker (elid + anchorEtag) anlegen kann.
			'etag' => $etag,
		];
	}
}
