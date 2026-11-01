<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCA\ScoreView\Service\FeatureConfig;
use OCA\ScoreView\Service\LeaderService;
use OCA\ScoreView\Service\PracticeLogService;
use OCA\ScoreView\Service\UserFileResolver;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\AnonRateLimit;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use OCP\AppFramework\Http\JSONResponse;
use OCP\Files\Node;
use OCP\IL10N;
use OCP\IRequest;

/**
 * The practice log and the weekly goal (E20, rules in
 * Service\PracticeLogService).
 *
 * - **Switch `feature_practice_log` off → 404** on every endpoint, like the
 *   other switchable features.
 * - **No file access → 404**, so file ids cannot be probed.
 * - **Only one's own log**: there is no endpoint that reads someone else's,
 *   for leaders neither - a goal is an offer, not a check-up.
 * - **The goal** is set by leaders only, checked here (E9: enforced on the
 *   server, not just hidden in the viewer).
 *
 * Token or session like the viewer's other routes: the mobile apps practise
 * too (E8).
 */
class PracticeLogController extends Controller {
	use JsonErrors;

	public function __construct(
		IRequest $request,
		private UserFileResolver $fileResolver,
		private PracticeLogService $practice,
		private LeaderService $leaders,
		private FeatureConfig $features,
		private IL10N $l,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	public function show(int $fileId): JSONResponse {
		[$node, $userId] = $this->resolve($fileId);
		if ($node === null) {
			return $this->notFound();
		}
		$response = new JSONResponse($this->practice->summary($fileId, $userId));
		$response->cacheFor(0);
		return $response;
	}

	/**
	 * @param string $day the singer's local calendar day, `YYYY-MM-DD`
	 * @param int $seconds practised since the last report
	 */
	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	// One report a minute while practising, plus one on each pause - thirty a
	// minute leave room for a restless play button and still bound a script.
	#[UserRateLimit(limit: 30, period: 60)]
	#[AnonRateLimit(limit: 30, period: 60)]
	public function create(int $fileId, string $day = '', int $seconds = 0): JSONResponse {
		[$node, $userId] = $this->resolve($fileId);
		if ($node === null) {
			return $this->notFound();
		}
		try {
			$total = $this->practice->add($fileId, $userId, $day, $seconds);
		} catch (\InvalidArgumentException) {
			return new JSONResponse(['error' => $this->l->t('Invalid practice time.')], Http::STATUS_BAD_REQUEST);
		}
		return new JSONResponse(['day' => $day, 'seconds' => $total]);
	}

	/**
	 * @param int $minutesPerWeek 0 removes the goal
	 */
	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	#[UserRateLimit(limit: 20, period: 60)]
	#[AnonRateLimit(limit: 20, period: 60)]
	public function updateGoal(int $fileId, int $minutesPerWeek = 0): JSONResponse {
		[$node, $userId] = $this->resolve($fileId);
		if ($node === null) {
			return $this->notFound();
		}
		if (!$this->leaders->isLeader($node, $userId)) {
			return new JSONResponse(['error' => $this->l->t('Only leaders can set a practice goal.')], Http::STATUS_FORBIDDEN);
		}
		$stored = $this->practice->setGoal($fileId, $userId, $minutesPerWeek);
		return new JSONResponse(['minutesPerWeek' => $stored]);
	}

	/**
	 * @return array{0: ?Node, 1: string}
	 */
	private function resolve(int $fileId): array {
		if (!$this->features->isEnabled(FeatureConfig::PRACTICE_LOG)) {
			return [null, ''];
		}
		$userId = $this->fileResolver->currentUserId();
		if ($userId === null) {
			return [null, ''];
		}
		return [$this->fileResolver->resolveOwnNode($fileId), $userId];
	}
}
