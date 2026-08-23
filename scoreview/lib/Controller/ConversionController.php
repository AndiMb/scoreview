<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\BackgroundJob\ConvertScoreJob;
use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Service\ConversionService;
use OCA\ScoreView\Service\UserFileResolver;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\StreamResponse;
use OCP\BackgroundJob\IJobList;
use OCP\Files\NotFoundException;
use OCP\IConfig;
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
 * unveraenderlich (der etag steckt bereits im IAppData-Cache-Pfad, siehe
 * ConversionService) - ETag/Last-Modified/Cache-Control:immutable setzen,
 * damit ein zweites Oeffnen derselben Datei 304 statt einer erneuten
 * Uebertragung bekommt (Phase 7 - vorher wurde bei jedem Oeffnen alles neu
 * uebertragen). Die eigentliche 304-Antwort baut Nextclouds
 * NotModifiedMiddleware anhand von setETag()/setLastModified() automatisch,
 * hier wird nur gesetzt.
 */
class ConversionController extends Controller {
	private const IMMUTABLE_CACHE_SECONDS = 31536000;

	public function __construct(
		IRequest $request,
		private UserFileResolver $fileResolver,
		private ConversionService $conversionService,
		private IJobList $jobList,
		private IURLGenerator $urlGenerator,
		private IConfig $config,
		private IL10N $l,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	/**
	 * Kein #[NoCSRFRequired] hier (anders als auf den reinen
	 * Auslieferungsrouten unten) - dieser Endpunkt hat mit jobList->add()
	 * einen Seiteneffekt (siehe PLAN.md Phase 7).
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
			// (Standardfall seit Phase 7 - siehe ScoreFileListener). Bewusst
			// KEIN eigenes createPending() hier: ConvertScoreJob::run() legt
			// die Zeile selbst an. Würde der Controller sie vorab anlegen,
			// fände der Job beim Start bereits eine (von ihm selbst noch gar
			// nicht bearbeitete) "pending"-Zeile vor und würde die
			// Konvertierung wegen seiner eigenen Idempotenz-Prüfung
			// (status !== error => überspringen) fälschlich als "läuft
			// schon" überspringen - die Konvertierung würde für immer auf
			// "pending" hängen bleiben.
			$this->retryConversion($fileId);
			return new JSONResponse(['status' => ScoreConversion::STATUS_PENDING]);
		}

		$body = ['status' => $conversion->getStatus()];
		if ($conversion->getStatus() === ScoreConversion::STATUS_ERROR) {
			$body['error'] = $conversion->getErrorMessage();
			// error_code statt uebersetztem error_message (Phase 14): der Text wird
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
			$this->retryConversion($fileId);
		} elseif ($conversion->getStatus() === ScoreConversion::STATUS_READY) {
			if (!$this->conversionService->isCurrentFormat($conversion)) {
				// Aeltere Cache-Formatversion (PLAN.md Phase 12 "Neu gefundene
				// Luecke"/Phase 14 format_version) - wie "nicht fertig" behandeln
				// statt Cache-Dateien auszuliefern, die nicht mehr zum aktuellen
				// Controller/Sidecar-Format passen, und eine Neukonvertierung
				// anstossen statt manuellem Eingriff in der DB.
				$this->retryConversion($fileId);
				return new JSONResponse(['status' => ScoreConversion::STATUS_PENDING]);
			}
			try {
				$body['files'] = $this->buildFileUrls($fileId, $etag);
			} catch (NotFoundException) {
				// Cache-Datei fehlt trotz status=ready (z.B. Ordner ausserhalb der
				// App geloescht) - wie "nicht fertig" behandeln statt eines 500ers,
				// analog zur format_version-Pruefung oben (PLAN.md Phase 12).
				$this->retryConversion($fileId);
				return new JSONResponse(['status' => ScoreConversion::STATUS_PENDING]);
			}
			// Kein Cache-Artefakt einer bestimmten Partitur, sondern eine
			// instanzweite Ressource (Phase 9/E1) - deshalb hier statt in
			// buildFileUrls() mitgegeben.
			$body['soundFontUrl'] = $this->soundFontUrl();
		}
		return new JSONResponse($body);
	}

	/** Reiht eine (Neu-)Konvertierung ein - Idempotenz/Ueberspringen bereits laufender Jobs regelt ConvertScoreJob selbst. */
	private function retryConversion(int $fileId): void {
		$this->jobList->add(ConvertScoreJob::class, [
			'userId' => $this->fileResolver->currentUserId(),
			'fileId' => $fileId,
		]);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function page(int $fileId, int $page): Http\Response {
		return $this->serveCachedFile($fileId, 'image/svg+xml', fn (int $id, string $etag) => $this->conversionService->getPage($id, $etag, $page));
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function midi(int $fileId): Http\Response {
		return $this->serveCachedFile($fileId, 'audio/midi', fn (int $id, string $etag) => $this->conversionService->getMidi($id, $etag));
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function timing(int $fileId): Http\Response {
		return $this->serveCachedFile($fileId, 'application/json', fn (int $id, string $etag) => $this->conversionService->getTimingJson($id, $etag));
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function measures(int $fileId): Http\Response {
		return $this->serveCachedFile($fileId, 'application/json', fn (int $id, string $etag) => $this->conversionService->getMeasuresJson($id, $etag));
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function meta(int $fileId): Http\Response {
		return $this->serveCachedFile($fileId, 'application/json', fn (int $id, string $etag) => $this->conversionService->getMetaJsonFile($id, $etag));
	}

	/**
	 * @param callable(int, string): \OCP\Files\SimpleFS\ISimpleFile $fileGetter
	 */
	private function serveCachedFile(int $fileId, string $mimeType, callable $fileGetter): Http\Response {
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
			$file = $fileGetter($fileId, $etag);
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
	 * SoundFont); ohne sie liefert die App selbst aus, was der ohnehin
	 * vorausgesetzte Sidecar mitbringt (Controller\SoundFontController).
	 *
	 * Vorher hiess "keine Admin-URL gesetzt" schlicht "kein Ton" - und weil
	 * das der Auslieferungszustand ist, war die App fuer jeden stumm, der
	 * nicht selbst ein 40-MB-SF3 CORS-faehig gehostet hat.
	 */
	private function soundFontUrl(): string {
		$configured = trim($this->config->getAppValue(Application::APP_ID, 'soundfont_url', ''));
		if ($configured !== '') {
			return $configured;
		}
		return $this->urlGenerator->linkToRoute(Application::APP_ID . '.sound_font.get');
	}

	private function buildFileUrls(int $fileId, string $etag): array {
		$pageCount = $this->conversionService->getPageCount($fileId, $etag);
		$pages = [];
		for ($n = 1; $n <= $pageCount; $n++) {
			$pages[] = $this->urlGenerator->linkToRoute(Application::APP_ID . '.conversion.page', ['fileId' => $fileId, 'page' => $n]);
		}
		return [
			'pageCount' => $pageCount,
			'pages' => $pages,
			'midi' => $this->urlGenerator->linkToRoute(Application::APP_ID . '.conversion.midi', ['fileId' => $fileId]),
			'timingJson' => $this->urlGenerator->linkToRoute(Application::APP_ID . '.conversion.timing', ['fileId' => $fileId]),
			'measuresJson' => $this->urlGenerator->linkToRoute(Application::APP_ID . '.conversion.measures', ['fileId' => $fileId]),
			'metaJson' => $this->urlGenerator->linkToRoute(Application::APP_ID . '.conversion.meta', ['fileId' => $fileId]),
			// Anker-Etag für Notizen (Phase 11) - der aktuelle etag dieser
			// Konvertierung, damit der Client neue Notizen mit einem gültigen
			// Sekundäranker (elid + anchorEtag) anlegen kann.
			'etag' => $etag,
		];
	}
}
