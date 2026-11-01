<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCA\ScoreView\Service\FeatureConfig;
use OCA\ScoreView\Service\SingRunService;
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
 * Scored runs of one's own part (E24, rules in Service\SingRunService).
 *
 * - **Switch `feature_sing_score` or `feature_intonation` off → 404**: without
 *   the intonation there are no frames to score.
 * - **No file access → 404**, so file ids cannot be probed.
 * - **Only one's own runs**: no route reads someone else's, for leaders
 *   neither (E20, E24).
 *
 * Token or session like the viewer's other routes: the mobile apps sing too
 * (E8).
 */
class SingRunController extends Controller {
	use JsonErrors;

	public function __construct(
		IRequest $request,
		private UserFileResolver $fileResolver,
		private SingRunService $runs,
		private FeatureConfig $features,
		private IL10N $l,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	public function index(int $fileId, ?int $from = null, ?int $to = null, string $level = 'choir'): JSONResponse {
		$userId = $this->resolve($fileId);
		if ($userId === null) {
			return $this->notFound();
		}
		$response = new JSONResponse($this->runs->list($fileId, $userId, $from, $to, $level));
		$response->cacheFor(0);
		return $response;
	}

	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	// A run lasts as long as the piece or the loop; twelve a minute is one
	// every five seconds - a short loop sung over and over, and still a bound
	// for a script.
	#[UserRateLimit(limit: 12, period: 60)]
	#[AnonRateLimit(limit: 12, period: 60)]
	public function create(
		int $fileId,
		?int $from = null,
		?int $to = null,
		string $level = '',
		int $tempoPct = 0,
		?int $totalPct = null,
		?int $pitchPct = null,
		?int $onsetPct = null,
		?int $releasePct = null,
		int $notesScored = 0,
	): JSONResponse {
		$userId = $this->resolve($fileId);
		if ($userId === null) {
			return $this->notFound();
		}
		try {
			$run = $this->runs->add($fileId, $userId, [
				'from' => $from,
				'to' => $to,
				'level' => $level,
				'tempoPct' => $tempoPct,
				'totalPct' => $totalPct,
				'pitchPct' => $pitchPct,
				'onsetPct' => $onsetPct,
				'releasePct' => $releasePct,
				'notesScored' => $notesScored,
			]);
		} catch (\InvalidArgumentException) {
			return new JSONResponse(['error' => $this->l->t('Invalid singing result.')], Http::STATUS_BAD_REQUEST);
		}
		return new JSONResponse($run, Http::STATUS_CREATED);
	}

	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	#[UserRateLimit(limit: 10, period: 60)]
	#[AnonRateLimit(limit: 10, period: 60)]
	public function destroy(int $fileId): JSONResponse {
		$userId = $this->resolve($fileId);
		if ($userId === null) {
			return $this->notFound();
		}
		return new JSONResponse(['deleted' => $this->runs->clear($fileId, $userId)]);
	}

	private function resolve(int $fileId): ?string {
		if (!$this->features->isEnabled(FeatureConfig::SING_SCORE) || !$this->features->isEnabled(FeatureConfig::INTONATION)) {
			return null;
		}
		$userId = $this->fileResolver->currentUserId();
		if ($userId === null || $this->fileResolver->resolveOwnNode($fileId) === null) {
			return null;
		}
		return $userId;
	}
}
