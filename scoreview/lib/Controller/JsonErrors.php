<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\Service\SiblingFileException;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\JSONResponse;

/**
 * The error answers several controllers give in the same words, so that the
 * viewer sees one message (and the translators one string) per case.
 *
 * Expects `$this->l` (IL10N), which every using controller has.
 */
trait JsonErrors {
	/**
	 * Unresolvable file and missing access are one answer on purpose: a
	 * separate 403 would tell a stranger that the file id exists.
	 */
	private function notFound(): JSONResponse {
		return new JSONResponse(['error' => $this->l->t('File not found or no access.')], Http::STATUS_NOT_FOUND);
	}

	/** A file next to the score could not be saved (SiblingFileService). */
	private function refusedToSave(SiblingFileException $e): JSONResponse {
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
}
