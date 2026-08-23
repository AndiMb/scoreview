<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Service\AnnotationService;
use OCA\ScoreView\Service\ConversionService;
use OCA\ScoreView\Service\UserFileResolver;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;

/**
 * Private Notizen (Phase 11) - immer nur zur eigenen Sicht auf eine Datei,
 * nie fremde Notizen. fileId wird wie in ConversionController ausschliesslich
 * ueber UserFileResolver aufgeloest (Zugriffskontrolle ueber den Dateibaum),
 * die eigentliche Annotation-Zeile zusaetzlich ueber (id, fileId, userId) in
 * AnnotationService/-Mapper (Zugriffskontrolle auf die Notiz selbst).
 */
class AnnotationController extends Controller {
	public function __construct(
		IRequest $request,
		private UserFileResolver $fileResolver,
		private AnnotationService $annotationService,
		private ConversionService $conversionService,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	public function index(int $fileId): JSONResponse {
		$node = $this->fileResolver->resolveOwnNode($fileId);
		$userId = $this->fileResolver->currentUserId();
		if ($node === null || $userId === null) {
			return new JSONResponse(['error' => 'Datei nicht gefunden oder kein Zugriff.'], Http::STATUS_NOT_FOUND);
		}

		$currentMeasureCount = null;
		try {
			$currentMeasureCount = $this->currentMeasureCount($fileId, $node->getEtag());
		} catch (\Throwable) {
			// Konvertierung (noch) nicht fertig/verfuegbar - orphaned-Markierung
			// entfaellt dann einfach (null), die Notizen selbst bleiben trotzdem
			// abrufbar (siehe PLAN.md Phase 11: Notizen ueberleben unabhaengig
			// vom Cache-Status).
		}

		return new JSONResponse($this->annotationService->listForFile($fileId, $userId, $currentMeasureCount));
	}

	#[NoAdminRequired]
	public function create(int $fileId, int $measureNumber, float $fraction, string $content, ?int $elid = null, ?string $anchorEtag = null): JSONResponse {
		$userId = $this->requireOwnAccess($fileId);
		if ($userId === null) {
			return new JSONResponse(['error' => 'Datei nicht gefunden oder kein Zugriff.'], Http::STATUS_NOT_FOUND);
		}
		if (trim($content) === '') {
			return new JSONResponse(['error' => 'Notiz darf nicht leer sein.'], Http::STATUS_BAD_REQUEST);
		}

		$annotation = $this->annotationService->create($fileId, $userId, $measureNumber, $fraction, $elid, $anchorEtag, $content);
		return new JSONResponse($annotation->jsonSerialize(), Http::STATUS_CREATED);
	}

	#[NoAdminRequired]
	public function update(int $fileId, int $id, string $content): JSONResponse {
		$userId = $this->requireOwnAccess($fileId);
		if ($userId === null) {
			return new JSONResponse(['error' => 'Datei nicht gefunden oder kein Zugriff.'], Http::STATUS_NOT_FOUND);
		}
		if (trim($content) === '') {
			return new JSONResponse(['error' => 'Notiz darf nicht leer sein.'], Http::STATUS_BAD_REQUEST);
		}

		try {
			$annotation = $this->annotationService->updateContent($id, $fileId, $userId, $content);
		} catch (\RuntimeException $e) {
			return new JSONResponse(['error' => $e->getMessage()], Http::STATUS_NOT_FOUND);
		}
		return new JSONResponse($annotation->jsonSerialize());
	}

	#[NoAdminRequired]
	public function destroy(int $fileId, int $id): JSONResponse {
		$userId = $this->requireOwnAccess($fileId);
		if ($userId === null) {
			return new JSONResponse(['error' => 'Datei nicht gefunden oder kein Zugriff.'], Http::STATUS_NOT_FOUND);
		}

		try {
			$this->annotationService->delete($id, $fileId, $userId);
		} catch (\RuntimeException $e) {
			return new JSONResponse(['error' => $e->getMessage()], Http::STATUS_NOT_FOUND);
		}
		return new JSONResponse(['status' => 'ok']);
	}

	private function requireOwnAccess(int $fileId): ?string {
		if ($this->fileResolver->resolveOwnNode($fileId) === null) {
			return null;
		}
		return $this->fileResolver->currentUserId();
	}

	private function currentMeasureCount(int $fileId, string $etag): ?int {
		$meta = json_decode($this->conversionService->getMetaJsonFile($fileId, $etag)->getContent(), true);
		return isset($meta['measures']) ? (int)$meta['measures'] : null;
	}
}
