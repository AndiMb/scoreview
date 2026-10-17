<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCA\ScoreView\Middleware\DirectAccessContext;
use OCA\ScoreView\Service\FeatureConfig;
use OCA\ScoreView\Service\PracticeTrackService;
use OCA\ScoreView\Service\RequestBodyReader;
use OCA\ScoreView\Service\SiblingFileException;
use OCA\ScoreView\Service\SiblingFileService;
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
 * Saves the PDF file of a score next to it in Files (A1b, E16).
 *
 * The browser writes the PDF from the page SVGs it already shows
 * (src/lib/svgToPdf.js, pdfWriter.js) and sends it as the body - the server
 * renders nothing. A server-side PDF would need the sidecar (MuseScore can
 * write one) and so break E3: the local path cannot.
 *
 * The server checks what it can without parsing: the score is the
 * person's (404 first, S8), the folder is writable, the size is within
 * `pdf_max_mb`, and the body starts like a PDF. Nextcloud never executes a
 * file in Files, so that check only keeps accidents out.
 */
class PdfController extends Controller {
	public const EXTENSION = '.pdf';

	public function __construct(
		IRequest $request,
		private UserFileResolver $fileResolver,
		private SiblingFileService $files,
		private FeatureConfig $features,
		private RequestBodyReader $body,
		private DirectAccessContext $access,
		private IL10N $l,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	/**
	 * @param string $name file name without extension; empty = the score's name
	 * @param bool $replace overwrite an existing file of that name
	 */
	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	// One file per click; ten a minute leave room for a retry after "replace?".
	// Both limits, because token requests are anonymous for the
	// RateLimitingMiddleware (as with practice tracks).
	#[UserRateLimit(limit: 10, period: 60)]
	#[AnonRateLimit(limit: 10, period: 60)]
	public function create(int $fileId, string $name = '', bool $replace = false): JSONResponse {
		$userId = $this->fileResolver->currentUserId();
		$score = $this->fileResolver->resolveOwnNode($fileId);
		// Only next to a score: a folder as `fileId` would write next to the
		// folder - for the user folder itself even outside `files/`.
		if ($userId === null || !PracticeTrackService::isScore($score)) {
			return new JSONResponse(['error' => $this->l->t('File not found or no access.')], Http::STATUS_NOT_FOUND);
		}
		// S2: nothing new comes into being with a companion token.
		if (!$this->access->resolved() || $this->access->mode() === DirectAccessContext::COMPANION) {
			return new JSONResponse(['error' => $this->l->t('Saving here is not possible from the mobile app.')], Http::STATUS_FORBIDDEN);
		}
		// Before reading the body: a refused upload should not cost the transfer.
		if (!PracticeTrackService::canWriteNextTo($score)) {
			return new JSONResponse(['error' => $this->l->t('You cannot save files in this folder.')], Http::STATUS_FORBIDDEN);
		}

		$maxBytes = $this->features->pdfMaxBytes();
		$declared = $this->request->getHeader('Content-Length');
		if ($declared !== '' && (int)$declared > $maxBytes) {
			return $this->tooLarge();
		}
		$pdf = $this->body->readToStream($maxBytes);
		if ($pdf === null) {
			return $this->tooLarge();
		}
		try {
			if (!self::looksLikePdf($pdf)) {
				return new JSONResponse(['error' => $this->l->t('This is not a PDF file.')], Http::STATUS_UNSUPPORTED_MEDIA_TYPE);
			}
			if (trim($name) === '') {
				$name = pathinfo($score->getName(), PATHINFO_FILENAME);
			}
			$saved = $this->files->save($score->getParent(), $userId, $pdf, $name, self::EXTENSION, $replace);
		} catch (SiblingFileException $e) {
			return $this->refused($e);
		} finally {
			if (is_resource($pdf)) {
				fclose($pdf);
			}
		}
		return new JSONResponse($saved, Http::STATUS_CREATED);
	}

	/**
	 * @param resource $stream set back to its start afterwards
	 */
	public static function looksLikePdf($stream): bool {
		$head = (string)fread($stream, 5);
		rewind($stream);
		return $head === '%PDF-';
	}

	private function refused(SiblingFileException $e): JSONResponse {
		return match ($e->getReason()) {
			SiblingFileException::EXISTS => new JSONResponse([
				'error' => $this->l->t('A file with this name already exists.'),
				'reason' => 'exists',
				'suggested' => $e->getSuggested(),
			], Http::STATUS_CONFLICT),
			SiblingFileException::FORBIDDEN => new JSONResponse(['error' => $this->l->t('You cannot save files in this folder.')], Http::STATUS_FORBIDDEN),
			SiblingFileException::STORAGE_FULL => new JSONResponse(['error' => $this->l->t('Not enough storage space.')], Http::STATUS_INSUFFICIENT_STORAGE),
			SiblingFileException::BUSY => new JSONResponse(['error' => $this->l->t('The file or folder is in use right now. Try again in a moment.')], Http::STATUS_SERVICE_UNAVAILABLE),
			default => new JSONResponse(['error' => $this->l->t('Invalid file name or folder.')], Http::STATUS_BAD_REQUEST),
		};
	}

	private function tooLarge(): JSONResponse {
		return new JSONResponse([
			'error' => $this->l->t('The PDF file is larger than allowed ({mb} MB).', ['mb' => (int)($this->features->pdfMaxBytes() / 1048576)]),
		], Http::STATUS_REQUEST_ENTITY_TOO_LARGE);
	}
}
