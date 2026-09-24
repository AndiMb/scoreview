<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Db\Recording;
use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCA\ScoreView\Service\FeatureConfig;
use OCA\ScoreView\Service\RecordingException;
use OCA\ScoreView\Service\RecordingService;
use OCA\ScoreView\Service\RequestBodyReader;
use OCA\ScoreView\Service\UserFileResolver;
use OCA\ScoreView\Service\WavFormat;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\AnonRateLimit;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use OCP\AppFramework\Http\FileDisplayResponse;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\Response;
use OCP\IL10N;
use OCP\IRequest;

/**
 * Eigene Aufnahmen (Regeln in Service\RecordingService).
 *
 * - **Schalter `feature_recording` aus → 404** auf jedem Endpunkt -
 *   eine abgeschaltete Funktion sieht aus wie eine, die es nicht gibt.
 * - **Ohne Dateizugriff 404**, damit sich fileIds nicht abtasten lassen.
 * - **Fremde Aufnahme 404** (S8), auch fuer Leitungen und die Eigentuemerin
 *   der Partitur: Die Kennung einer fremden Aufnahme verraet nichts.
 *
 * Der Upload kommt **roh** (`Content-Type: audio/wav`), die Angaben zum
 * Zeitabgleich stehen in der Query. Ein Multipart-Formular haette die
 * PHP-Grenzen `upload_max_filesize`/`post_max_size` geerbt, die auf vielen
 * Instanzen bei 2 MB liegen - eine Aufnahme von zehn Minuten hat 19 MB.
 *
 * Alle Routen nehmen auch das Direct-Editing-Token (E8): In der iOS-App
 * gibt die WebView das Mikrofon voraussichtlich frei, und dort gibt es keine
 * Sitzung.
 */
class RecordingController extends Controller {
	public function __construct(
		IRequest $request,
		private UserFileResolver $fileResolver,
		private RecordingService $recordings,
		private FeatureConfig $features,
		private RequestBodyReader $body,
		private IL10N $l,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	public function index(int $fileId): JSONResponse {
		$userId = $this->resolve($fileId);
		if ($userId === null) {
			return $this->notFound();
		}
		$response = new JSONResponse([
			'recordings' => array_map(fn (Recording $r) => $this->serialize($r), $this->recordings->list($fileId, $userId)),
			'maxPerScore' => $this->features->maxRecordingsPerScore(),
			'maxSeconds' => $this->features->maxRecordingSeconds(),
		]);
		$response->cacheFor(0);
		return $response;
	}

	/**
	 * @param int $scoreStartMs Partiturzeit des ersten Samples, schon um die
	 *                          Latenzen korrigiert (src/lib/recordingAlign.js)
	 * @param float $tempoFactor Tempofaktor waehrend der Aufnahme
	 * @param bool $replaceOldest die Nutzerin hat das Ersetzen bestaetigt - still
	 *                            ueberschrieben wird nichts
	 */
	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	// Jede Aufnahme sind bis zu hundert Megabyte, die gelesen, geprueft und
	// geschrieben werden - zehn je Minute liegen weit ueber dem, was eine
	// Probe erzeugt. Beide Grenzen, weil Anfragen mit Token fuer Nextclouds
	// RateLimitingMiddleware anonym sind (sie laeuft vor unserer Middleware,
	// die den Nutzer erst setzt) - dort zaehlt die Adresse.
	#[UserRateLimit(limit: 10, period: 60)]
	#[AnonRateLimit(limit: 10, period: 60)]
	public function create(
		int $fileId,
		int $scoreStartMs = 0,
		float $tempoFactor = 1.0,
		bool $withAccompaniment = false,
		bool $replaceOldest = false,
	): JSONResponse {
		$userId = $this->resolve($fileId);
		if ($userId === null) {
			return $this->notFound();
		}

		// Zuerst die angekuendigte Laenge, dann der gelesene Rumpf - beides
		// mit derselben Grenze. Die Angabe allein reicht nicht (sie kann
		// fehlen oder luegen), spart aber im ehrlichen Fall das Einlesen von
		// hundert Megabyte, nur um sie danach abzulehnen.
		$maxBytes = $this->features->maxRecordingSeconds() * WavFormat::BYTES_PER_SECOND + WavFormat::MAX_HEADER_BYTES;
		$declared = $this->request->getHeader('Content-Length');
		if ($declared !== '' && (int)$declared > $maxBytes) {
			return $this->refused(new RecordingException(RecordingException::TOO_LONG));
		}
		// Als Strom, nicht als String: siehe RequestBodyReader.
		$wav = $this->body->readToStream($maxBytes);
		if ($wav === null) {
			return $this->refused(new RecordingException(RecordingException::TOO_LONG));
		}

		// Unsinnige Zahlen begrenzen statt ablehnen: Sie verschieben nur die
		// Anzeige dieser einen Aufnahme, und die Aufnahme ist wertvoller als
		// eine exakte Fehlermeldung. Das Tempo in denselben Grenzen wie der
		// Regler (usePlayback.js), die Startzeit in einem Tag.
		$meta = [
			'scoreStartMs' => max(-86400000, min(86400000, $scoreStartMs)),
			'tempoFactor' => is_finite($tempoFactor) ? max(0.25, min(4.0, $tempoFactor)) : 1.0,
			'withAccompaniment' => $withAccompaniment,
		];
		try {
			$recording = $this->recordings->create($fileId, $userId, $wav, $meta, $replaceOldest);
		} catch (RecordingException $e) {
			return $this->refused($e);
		} finally {
			if (is_resource($wav)) {
				fclose($wav);
			}
		}
		return new JSONResponse($this->serialize($recording), Http::STATUS_CREATED);
	}

	/**
	 * Die WAV selbst - nur fuer die Aufnehmende.
	 */
	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	public function show(int $fileId, int $id): Response {
		$userId = $this->resolve($fileId);
		if ($userId === null) {
			return $this->notFound();
		}
		try {
			$file = $this->recordings->open($fileId, $userId, $id);
		} catch (RecordingException $e) {
			return $this->refused($e);
		}
		// Privat: Ein geteilter Cache (Proxy) darf die Stimme einer Person
		// nicht fuer die naechste Anfrage aufheben.
		return new FileDisplayResponse($file, Http::STATUS_OK, [
			'Content-Type' => 'audio/wav',
			'Cache-Control' => 'private, no-store',
		]);
	}

	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	public function destroy(int $fileId, int $id): JSONResponse {
		$userId = $this->resolve($fileId);
		if ($userId === null) {
			return $this->notFound();
		}
		try {
			$this->recordings->delete($fileId, $userId, $id);
		} catch (RecordingException $e) {
			return $this->refused($e);
		}
		return new JSONResponse(['status' => 'ok']);
	}

	/**
	 * @return ?string die Nutzerin, oder null, wenn die Funktion aus oder die
	 *                 Datei nicht sichtbar ist
	 */
	private function resolve(int $fileId): ?string {
		if (!$this->features->isEnabled(FeatureConfig::RECORDING)) {
			return null;
		}
		$userId = $this->fileResolver->currentUserId();
		if ($userId === null || $this->fileResolver->resolveOwnNode($fileId) === null) {
			return null;
		}
		return $userId;
	}

	/**
	 * @return array<string, mixed>
	 */
	private function serialize(Recording $recording): array {
		return [
			'id' => $recording->getId(),
			'createdAt' => $recording->getCreatedAt()->getTimestamp(),
			'durationMs' => $recording->getDurationMs(),
			'sizeBytes' => $recording->getSizeBytes(),
			'scoreStartMs' => $recording->getScoreStartMs(),
			'tempoFactor' => $recording->getTempoFactor(),
			'withAccompaniment' => (bool)$recording->getWithAccompaniment(),
		];
	}

	/**
	 * Volle Minuten als Minuten, alles andere in Sekunden - „0,2 Minuten"
	 * liest niemand gern.
	 */
	private function tooLongMessage(): string {
		$seconds = $this->features->maxRecordingSeconds();
		return $seconds % 60 === 0
			? $this->l->t('The recording is longer than the %s minutes allowed on this server.', [(string)intdiv($seconds, 60)])
			: $this->l->t('The recording is longer than the %s seconds allowed on this server.', [(string)$seconds]);
	}

	private function notFound(): JSONResponse {
		return new JSONResponse(['error' => $this->l->t('File not found or no access.')], Http::STATUS_NOT_FOUND);
	}

	private function refused(RecordingException $e): JSONResponse {
		return match ($e->getReason()) {
			RecordingException::INVALID => new JSONResponse(['error' => $this->l->t('This is not a recording made with ScoreView.')], Http::STATUS_BAD_REQUEST),
			RecordingException::TOO_LONG => new JSONResponse(['error' => $this->tooLongMessage()], Http::STATUS_REQUEST_ENTITY_TOO_LARGE),
			RecordingException::LIMIT_REACHED => new JSONResponse([
				'error' => $this->l->t('You already have the maximum number of recordings for this score. Replace the oldest one or delete one first.'),
				'reason' => 'limit',
			], Http::STATUS_CONFLICT),
			RecordingException::USER_STORAGE_FULL => new JSONResponse([
				'error' => $this->l->t('Your recordings use all the storage allowed per person. Delete older recordings first.'),
				'reason' => 'user_storage',
			], Http::STATUS_INSUFFICIENT_STORAGE),
			RecordingException::TOTAL_STORAGE_FULL => new JSONResponse([
				'error' => $this->l->t('The storage for recordings on this server is full. Please tell your administrator.'),
				'reason' => 'total_storage',
			], Http::STATUS_INSUFFICIENT_STORAGE),
			default => new JSONResponse(['error' => $this->l->t('Recording not found.')], Http::STATUS_NOT_FOUND),
		};
	}
}
