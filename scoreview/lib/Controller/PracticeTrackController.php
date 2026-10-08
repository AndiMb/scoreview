<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCA\ScoreView\Middleware\DirectAccessContext;
use OCA\ScoreView\Service\FeatureConfig;
use OCA\ScoreView\Service\PracticeTrackException;
use OCA\ScoreView\Service\PracticeTrackService;
use OCA\ScoreView\Service\RequestBodyReader;
use OCA\ScoreView\Service\UserFileResolver;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\AnonRateLimit;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IL10N;
use OCP\IRequest;

/**
 * Speichert einen Uebe-Track, den der Browser gerendert hat (E13, H1/H10).
 *
 * Der Browser schickt das fertige MP3 als Rumpf; Name, Ziel und „ersetzen"
 * kommen als Query-Parameter. Gerendert wird bewusst im Browser (Entwurf V3):
 * Er hat SoundFont und Mischung schon, und der Server muesste sonst eine
 * Synthese-Engine mitbringen.
 */
class PracticeTrackController extends Controller {
	public function __construct(
		IRequest $request,
		private UserFileResolver $fileResolver,
		private PracticeTrackService $tracks,
		private FeatureConfig $features,
		private RequestBodyReader $body,
		private DirectAccessContext $access,
		private IL10N $l,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	/**
	 * @param string $target folder | sub | own (PracticeTrackService)
	 * @param ?int $ownFolder nur bei `own`: fileId eines eigenen Ordners
	 */
	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	// Ein Track sind bis zu einige zig Megabyte. Dreissig je Minute reichen
	// fuer „Tracks fuer alle Stimmen" eines grossen Satzes; beide Grenzen,
	// weil Anfragen mit Token fuer die RateLimitingMiddleware anonym sind
	// (wie bei den Aufnahmen).
	#[UserRateLimit(limit: 30, period: 60)]
	#[AnonRateLimit(limit: 30, period: 60)]
	public function create(int $fileId, string $name = '', string $target = PracticeTrackService::TARGET_FOLDER, ?int $ownFolder = null, bool $replace = false): JSONResponse {
		if (!$this->features->isEnabled(FeatureConfig::PRACTICE_EXPORT)) {
			return $this->notFound();
		}
		$userId = $this->fileResolver->currentUserId();
		$score = $this->fileResolver->resolveOwnNode($fileId);
		// Nur neben eine Partitur: Ein Ordner als `fileId` schriebe neben den
		// Ordner - beim Nutzerordner selbst sogar ausserhalb von `files/`.
		if ($userId === null || !PracticeTrackService::isScore($score)) {
			return $this->notFound();
		}
		// S2: Mit einem Begleit-Token entsteht nichts Neues; mit dem Token der
		// Direct-Editing-Seite nur um die Partitur herum - ein frei gewaehlter
		// Ordner bleibt der Sitzung vorbehalten (dort gibt es auch erst die
		// Dateiauswahl).
		if (!$this->access->resolved()
			|| $this->access->mode() === DirectAccessContext::COMPANION
			|| ($this->access->isToken() && $target === PracticeTrackService::TARGET_OWN)) {
			return new JSONResponse(['error' => $this->l->t('Saving here is not possible from the mobile app.')], Http::STATUS_FORBIDDEN);
		}

		$maxBytes = $this->features->practiceTrackMaxBytes();
		$declared = $this->request->getHeader('Content-Length');
		if ($declared !== '' && (int)$declared > $maxBytes) {
			return $this->tooLarge();
		}
		$mp3 = $this->body->readToStream($maxBytes);
		if ($mp3 === null) {
			return $this->tooLarge();
		}
		try {
			if (!PracticeTrackService::looksLikeMp3($mp3)) {
				return new JSONResponse(['error' => $this->l->t('This is not an MP3 file.')], Http::STATUS_BAD_REQUEST);
			}
			$saved = $this->tracks->save($score, $userId, $mp3, $name, $target, $ownFolder, $replace);
		} catch (PracticeTrackException $e) {
			return $this->refused($e);
		} finally {
			if (is_resource($mp3)) {
				fclose($mp3);
			}
		}
		return new JSONResponse($saved, Http::STATUS_CREATED);
	}

	private function refused(PracticeTrackException $e): JSONResponse {
		return match ($e->getReason()) {
			PracticeTrackException::EXISTS => new JSONResponse([
				'error' => $this->l->t('A file with this name already exists.'),
				'reason' => 'exists',
				'suggested' => $e->getSuggested(),
			], Http::STATUS_CONFLICT),
			PracticeTrackException::FORBIDDEN => new JSONResponse(['error' => $this->l->t('You cannot save files in this folder.')], Http::STATUS_FORBIDDEN),
			PracticeTrackException::STORAGE_FULL => new JSONResponse(['error' => $this->l->t('Not enough storage space.')], Http::STATUS_INSUFFICIENT_STORAGE),
			default => new JSONResponse(['error' => $this->l->t('Invalid file name or folder.')], Http::STATUS_BAD_REQUEST),
		};
	}

	private function tooLarge(): JSONResponse {
		return new JSONResponse([
			'error' => $this->l->t('The practice track is larger than allowed ({mb} MB).', ['mb' => (int)($this->features->practiceTrackMaxBytes() / 1048576)]),
		], Http::STATUS_REQUEST_ENTITY_TOO_LARGE);
	}

	private function notFound(): JSONResponse {
		return new JSONResponse(['error' => $this->l->t('File not found or no access.')], Http::STATUS_NOT_FOUND);
	}
}
