<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\BackgroundJob\ConvertScoreJob;
use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Service\ClientFallback;
use OCA\ScoreView\Service\ConversionService;
use OCA\ScoreView\Service\LocalConverter;
use OCA\ScoreView\Service\UserFileResolver;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\StreamResponse;
use OCP\BackgroundJob\IJobList;
use OCP\Files\Node;
use OCP\Files\NotFoundException;
use OCP\IAppConfig;
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
 * nur im IAppData-Pfad (siehe cacheBuster()). Ohne den Parameter zeigte
 * eine neu konvertierte Partitur unter unveraenderter URL weiter die alten
 * Seiten: Chrome revalidiert Unterressourcen beim Neuladen nicht, und
 * `immutable` verbietet es ausdruecklich - sichtbar wurde die neue Fassung
 * erst nach hartem Neuladen oder in einem frischen Profil.
 */
class ConversionController extends Controller {
	private const IMMUTABLE_CACHE_SECONDS = 31536000;

	/**
	 * Bis hierhin darf eine Partitur im BROWSER gesetzt werden. Viel kleiner
	 * als die Serverschranke (`max_score_bytes`, 100 MB): Dort raeumt der
	 * Prozessabbau auf, hier laeuft es auf einem Tablet im selben Speicher wie
	 * die Seite. Der Wert geht in der Antwort mit, damit der Client abbrechen
	 * kann, BEVOR er 14 MB Engine geladen hat.
	 */
	private const DEFAULT_CLIENT_MAX_BYTES = 10485760;

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
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	/**
	 * Kein #[NoCSRFRequired] hier (anders als auf den reinen
	 * Auslieferungsrouten unten) - dieser Endpunkt hat mit jobList->add()
	 * einen Seiteneffekt.
	 */
	#[NoAdminRequired]
	public function status(int $fileId): JSONResponse {
		$node = $this->fileResolver->resolveOwnNode($fileId);
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

		$body = ['status' => $conversion->getStatus()];
		if ($conversion->getStatus() === ScoreConversion::STATUS_ERROR) {
			$body['error'] = $conversion->getErrorMessage();
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
			$this->retryConversion($fileId);
		} elseif ($conversion->getStatus() === ScoreConversion::STATUS_READY) {
			if (!$this->conversionService->isCurrentFormat($conversion)) {
				// Aeltere Cache-Formatversion - wie "nicht fertig" behandeln
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
			$body['canReconvert'] = $node->isUpdateable();
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
	 */
	#[NoAdminRequired]
	public function reconvert(int $fileId): JSONResponse {
		$node = $this->fileResolver->resolveOwnNode($fileId);
		if ($node === null) {
			return new JSONResponse(['status' => 'error', 'error' => $this->l->t('File not found or no access.')], Http::STATUS_NOT_FOUND);
		}
		if (!$node->isUpdateable()) {
			return new JSONResponse(['status' => 'error', 'error' => $this->l->t('Not allowed to convert this score again.')], Http::STATUS_FORBIDDEN);
		}

		$conversion = $this->conversionService->find($fileId, $node->getEtag());
		if ($conversion !== null && in_array($conversion->getStatus(), [ScoreConversion::STATUS_PENDING, ScoreConversion::STATUS_PROCESSING], true)) {
			// Laeuft ohnehin gerade - nichts verwerfen, sonst schriebe der
			// laufende Job sein Ergebnis auf eine geloeschte Zeile und die
			// Konvertierung liefe ein zweites Mal.
			return new JSONResponse(['status' => $conversion->getStatus()]);
		}

		$this->conversionService->deleteAllForFile($fileId);
		$this->retryConversion($fileId);
		return new JSONResponse(['status' => ScoreConversion::STATUS_PENDING]);
	}

	/** Reiht eine (Neu-)Konvertierung ein - Idempotenz/Ueberspringen bereits laufender Jobs regelt ConvertScoreJob selbst. */
	private function retryConversion(int $fileId): void {
		$this->jobList->add(ConvertScoreJob::class, [
			'userId' => $this->fileResolver->currentUserId(),
			'fileId' => $fileId,
		]);
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
	 * steht (siehe cacheBuster()): Aendert sich die Datei, aendert sich die
	 * URL.
	 */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function source(int $fileId): Http\Response {
		$node = $this->fileResolver->resolveOwnNode($fileId);
		if ($node === null) {
			return new JSONResponse(['error' => $this->l->t('File not found or no access.')], Http::STATUS_NOT_FOUND);
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
		$response->addHeader('Content-Length', (string)$node->getSize());
		$response->setETag($node->getEtag());
		$response->cacheFor(self::IMMUTABLE_CACHE_SECONDS, false, true);
		return $response;
	}

	/**
	 * Es gibt (noch) nichts Fertiges - und jetzt entscheidet sich, wer weiter
	 * arbeitet. Kann der Server konvertieren, wird wie bisher ein Job
	 * eingereiht und der Viewer wartet. Kann er es nicht, waere das Warten
	 * endlos: Dann uebernimmt der Browser (Service\ClientFallback).
	 */
	private function pendingOrClient(int $fileId, Node $node): JSONResponse {
		$grund = $this->clientFallback->reason();
		if ($grund !== null) {
			return $this->clientResponse($node, $grund);
		}
		$this->retryConversion($fileId);
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
	private function clientResponse(Node $node, ?string $grund): JSONResponse {
		$etag = $node->getEtag();
		return new JSONResponse([
			'status' => ClientFallback::STATUS_CLIENT,
			// Als CODE, nicht als Satz - uebersetzt wird im Browser (E4).
			'reason' => $grund ?? ScoreConversion::ERROR_UNKNOWN,
			'sourceUrl' => $this->urlGenerator->linkToRoute(
				Application::APP_ID . '.conversion.source', ['fileId' => $node->getId(), 'v' => $etag]),
			// Die Engine-Version als Cache-Schluessel: Ein Wechsel des
			// Engine-Pakets muss beim Client ankommen, obwohl die Auslieferung
			// `immutable` ist.
			'engineUrl' => $this->urlGenerator->linkToRoute(
				Application::APP_ID . '.engine.get',
				['name' => 'scoreview.mjs', 'v' => $this->localConverter->engineVersion()]),
			'maxBytes' => $this->appConfig->getValueInt(
				Application::APP_ID, 'client_max_score_bytes', self::DEFAULT_CLIENT_MAX_BYTES),
			'soundFontUrl' => $this->soundFontUrl(),
			'etag' => $etag,
			// Anders als bei einer gecachten Konvertierung ohne Rechtepruefung:
			// Hier verwirft „neu konvertieren" nichts Gemeinsames, sondern
			// laesst denselben Browser noch einmal rechnen. Wer die Partitur
			// sehen darf, darf das.
			'canReconvert' => true,
		]);
	}

	private function serveCachedFile(int $fileId, string $name): Http\Response {
		$node = $this->fileResolver->resolveOwnNode($fileId);
		if ($node === null) {
			return new JSONResponse(['error' => $this->l->t('File not found or no access.')], Http::STATUS_NOT_FOUND);
		}

		$etag = $node->getEtag();
		$conversion = $this->conversionService->find($fileId, $etag);
		if ($conversion === null || $conversion->getStatus() !== ScoreConversion::STATUS_READY || !$this->conversionService->isCurrentFormat($conversion)) {
			return new JSONResponse(['error' => $this->l->t('Conversion not finished yet.')], Http::STATUS_NOT_FOUND);
		}

		try {
			[$file, $mimeType] = $this->conversionService->getArtifact($fileId, $etag, $name);
		} catch (NotFoundException) {
			return new JSONResponse(['error' => $this->l->t('Requested file does not exist.')], Http::STATUS_NOT_FOUND);
		}

		// StreamResponse akzeptiert auch ein resource-Handle (ISimpleFile::read())
		// statt eines Pfads - IAppData kann auf Objektspeicher liegen, ein lokaler
		// Dateipfad ist nicht garantiert. So landet der Dateiinhalt nie komplett
		// als PHP-String im Speicher (vorher: getContent()/DataDisplayResponse).
		$response = new StreamResponse($file->read());
		$response->addHeader('Content-Type', $mimeType);
		// $etag ist der Nextcloud-Datei-etag, nicht IAppData's eigener - bewusst
		// so: Inhalt ist fuer (fileId, etag) invariant (siehe ConversionService),
		// er reicht also als stabiler HTTP-ETag, ohne von
		// Speicher-Backend-Details von IAppData abzuhaengen.
		$response->setETag($etag);
		$response->setLastModified($conversion->getUpdatedAt());
		$response->cacheFor(self::IMMUTABLE_CACHE_SECONDS, false, true);
		return $response;
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
	 */
	private function soundFontUrl(): string {
		$configured = trim($this->appConfig->getValueString(Application::APP_ID, 'soundfont_url'));
		if ($configured !== '') {
			return $configured;
		}
		return $this->urlGenerator->linkToRoute(Application::APP_ID . '.sound_font.get');
	}

	/**
	 * Was die Artefakt-URL einer Konvertierung von der einer anderen
	 * unterscheidet. Der Server wertet den Parameter nicht aus (er loest den
	 * etag ohnehin aus der Datei auf) - er existiert allein als
	 * Cache-Schluessel des Browsers, damit `immutable` oben die Wahrheit
	 * sagt.
	 *
	 * Beides zusammen, weil es zwei verschiedene Aenderungen gibt: der etag
	 * benennt die Fassung der PARTITUR (Bearbeitung, Re-Upload), der
	 * Zeitstempel die KONVERTIERUNG dieser Fassung - ein Format-Upgrade oder
	 * ein manuelles „Neu konvertieren" laesst den etag unberuehrt und
	 * bliebe sonst unsichtbar.
	 */
	private function cacheBuster(ScoreConversion $conversion): string {
		return $conversion->getEtag() . '-' . $conversion->getUpdatedAt()->getTimestamp();
	}

	private function buildFileUrls(int $fileId, ScoreConversion $conversion): array {
		$etag = $conversion->getEtag();
		$pageCount = $this->conversionService->getPageCount($fileId, $etag);
		$version = $this->cacheBuster($conversion);
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
