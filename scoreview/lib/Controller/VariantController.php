<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\BackgroundJob\ConvertScoreJob;
use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Db\ScoreVariant;
use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCA\ScoreView\Service\ConversionBackend;
use OCA\ScoreView\Service\ConversionService;
use OCA\ScoreView\Service\UserFileResolver;
use OCA\ScoreView\Service\VariantKey;
use OCA\ScoreView\Service\VariantService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\StreamResponse;
use OCP\Files\NotFoundException;
use OCP\IL10N;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUserSession;
use OCP\Security\RateLimiting\ILimiter;
use OCP\Security\RateLimiting\IRateLimitExceededException;

/**
 * Display variants of a score (docs/architecture.md E19): a part, a phone
 * page, concert pitch, transposed notation. Same access rules as the base
 * conversion - whoever may read the file may ask for any variant of it: a
 * variant is derived, regenerable and the same for every reader, so asking
 * for write access would protect nothing.
 *
 * `status` answers like the base's status endpoint, and its `files` have the
 * same keys; `midi` points at the base's MIDI, because a variant changes the
 * picture, not the piece. That keeps the viewer's way of loading artifacts
 * the same for both.
 */
class VariantController extends Controller {
	private const IMMUTABLE_CACHE_SECONDS = 31536000;

	/** Runs per person and hour (S4): each is a process of 130-250 MB. */
	public const RUNS_PER_HOUR = 20;

	public function __construct(
		IRequest $request,
		private UserFileResolver $fileResolver,
		private ConversionService $conversionService,
		private VariantService $variantService,
		private ConversionBackend $backend,
		private ConvertScoreJob $convertJob,
		private ILimiter $limiter,
		private IUserSession $userSession,
		private IURLGenerator $urlGenerator,
		private IL10N $l,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	/**
	 * Engraves the variant if it is not cached yet - inside this request
	 * (ConvertScoreJob::convertVariant() says why), so the answer is
	 * usually `ready` right away. `pending` means another request is
	 * engraving the same variant at this moment; the viewer asks again.
	 *
	 * Side effect, hence CSRF in the session case, as for the base status
	 * (see ConversionController::status()).
	 */
	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	public function status(int $fileId, string $key): JSONResponse {
		$node = $this->fileResolver->resolveOwnNode($fileId);
		$parsed = VariantKey::parse($key);
		if ($node === null || $parsed === null) {
			return new JSONResponse(['status' => 'error', 'error' => $this->l->t('File not found or no access.')], Http::STATUS_NOT_FOUND);
		}

		$etag = $node->getEtag();
		$base = $this->conversionService->find($fileId, $etag);
		if ($base === null || $base->getStatus() !== ScoreConversion::STATUS_READY || !$this->conversionService->isCurrentFormat($base)) {
			// The viewer asks for a variant only once the base is shown; a
			// base that is not ready (any more) is a new version of the file.
			return new JSONResponse(['status' => 'error', 'errorCode' => 'base_not_ready'], Http::STATUS_CONFLICT);
		}
		if (!$this->backend->supportsVariants()) {
			return new JSONResponse(['status' => ScoreConversion::STATUS_ERROR, 'errorCode' => ScoreVariant::ERROR_UNSUPPORTED]);
		}
		try {
			$meta = json_decode($this->conversionService->getMetaJsonFile($fileId, $etag)->getContent(), true);
		} catch (NotFoundException) {
			$meta = null;
		}
		if (!is_array($meta) || !VariantKey::fitsScore($parsed, $meta)) {
			return new JSONResponse(['status' => 'error', 'error' => $this->l->t('This score has no such part.')], Http::STATUS_NOT_FOUND);
		}

		$variant = $this->variantService->find($fileId, $etag, $key);
		if ($variant !== null && $this->variantService->isCurrent($variant)) {
			$this->variantService->touch($variant);
			return new JSONResponse($this->readyBody($fileId, $base, $variant));
		}
		if ($variant !== null && $this->variantService->isRunning($variant)) {
			return new JSONResponse(['status' => ScoreConversion::STATUS_PENDING]);
		}
		if ($variant !== null && !$this->variantService->mayRetry($variant)) {
			return new JSONResponse($this->errorBody($variant));
		}

		$user = $this->userSession->getUser();
		if ($user !== null) {
			try {
				$this->limiter->registerUserRequest('scoreview-variant', self::RUNS_PER_HOUR, 3600, $user);
			} catch (IRateLimitExceededException) {
				return new JSONResponse(['status' => ScoreConversion::STATUS_ERROR, 'errorCode' => 'rate_limited'], Http::STATUS_TOO_MANY_REQUESTS);
			}
		}

		if ($variant === null) {
			$variant = $this->variantService->claim($fileId, $etag, $key);
			if ($variant === null) {
				// Claimed a moment ago by another request.
				return new JSONResponse(['status' => ScoreConversion::STATUS_PENDING]);
			}
		} else {
			$variant = $this->variantService->restart($variant);
		}

		$this->convertJob->convertVariant($node, $variant);

		return new JSONResponse($this->variantService->isCurrent($variant)
			? $this->readyBody($fileId, $base, $variant)
			: $this->errorBody($variant));
	}

	/**
	 * One artifact of a cached variant: `page-N`, `timing`, `measures`,
	 * `meta`. Delivered as the base's are - immutable, as an attachment, with
	 * the file's etag (see ConversionController::serveCachedFile()).
	 */
	#[NoAdminRequired]
	#[NoCSRFRequired]
	#[PublicPage]
	#[DirectTokenOrSession(csrfInSession: false)]
	public function artifact(int $fileId, string $key, string $name): Http\Response {
		$node = $this->fileResolver->resolveOwnNode($fileId);
		if ($node === null || VariantKey::parse($key) === null) {
			return new JSONResponse(['error' => $this->l->t('File not found or no access.')], Http::STATUS_NOT_FOUND);
		}
		$etag = $node->getEtag();
		$variant = $this->variantService->find($fileId, $etag, $key);
		if ($variant === null || !$this->variantService->isCurrent($variant)) {
			return new JSONResponse(['error' => $this->l->t('Conversion not finished yet.')], Http::STATUS_NOT_FOUND);
		}
		try {
			[$file, $mimeType] = $this->variantService->getArtifact($variant, $name);
		} catch (NotFoundException) {
			return new JSONResponse(['error' => $this->l->t('Requested file does not exist.')], Http::STATUS_NOT_FOUND);
		}
		$response = new StreamResponse($file->read());
		$response->addHeader('Content-Type', $mimeType);
		$response->addHeader('Content-Disposition', 'attachment');
		$response->setETag($etag);
		$response->setLastModified($variant->getUpdatedAt());
		$response->cacheFor(self::IMMUTABLE_CACHE_SECONDS, false, true);
		return $response;
	}

	/**
	 * The `files` of a variant in the shape of the base's
	 * (ConversionController::buildFileUrls()). `etag` stays the file's: it is
	 * the anchor notes are stored against, and a note made in a variant is
	 * stored against the base (E19).
	 */
	private function readyBody(int $fileId, ScoreConversion $base, ScoreVariant $variant): array {
		$version = $variant->getEtag() . '-' . $variant->getUpdatedAt()->getTimestamp();
		$artifact = fn (string $name) => $this->urlGenerator->linkToRoute(
			Application::APP_ID . '.variant.artifact',
			['fileId' => $fileId, 'key' => $variant->getVariant(), 'name' => $name, 'v' => $version]);
		$pages = [];
		for ($n = 1; $n <= (int)$variant->getPageCount(); $n++) {
			$pages[] = $artifact("page-{$n}");
		}
		return [
			'status' => ScoreConversion::STATUS_READY,
			'variant' => $variant->getVariant(),
			'files' => [
				'pageCount' => count($pages),
				'pages' => $pages,
				'midi' => $this->urlGenerator->linkToRoute(
					Application::APP_ID . '.conversion.artifact',
					['fileId' => $fileId, 'name' => 'midi', 'v' => $base->getEtag() . '-' . $base->getUpdatedAt()->getTimestamp()]),
				'timingJson' => $artifact('timing'),
				'measuresJson' => $artifact('measures'),
				'metaJson' => $artifact('meta'),
				'etag' => $base->getEtag(),
			],
		];
	}

	private function errorBody(ScoreVariant $variant): array {
		return [
			'status' => ScoreConversion::STATUS_ERROR,
			'variant' => $variant->getVariant(),
			'errorCode' => $variant->getErrorCode() ?? ScoreConversion::ERROR_UNKNOWN,
			'error' => $variant->getErrorMessage(),
		];
	}
}
