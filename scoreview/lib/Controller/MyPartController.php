<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCA\ScoreView\Service\UserFileResolver;
use OCA\ScoreView\Service\ViewerPreferences;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IL10N;
use OCP\IRequest;

/**
 * „Meine Stimme" je Partitur (Service\ViewerPreferences::getMyPart).
 *
 * Ein eigener Endpunkt statt eines weiteren Schluessels in
 * `/api/preferences`: Der Wert gilt je Datei, und damit passt er unter die
 * dateibezogenen Routen - dort, wo die Middleware ein Direct-Editing-Token
 * gegen genau diese fileId pruefen kann. So ist die Wahl auch in der
 * Mobil-App speicherbar (E8), was `/api/preferences` als nicht dateibezogene
 * Route nicht ist (Middleware\DirectAccessMiddleware).
 *
 * Gelesen wird ueber GET auf derselben Adresse, nicht ueber den
 * Anfangszustand der Seite wie die Hervorhebungsfarbe: Die Files-Seite weiss
 * beim Laden noch nicht, welche Partitur geoeffnet wird, und der Viewer
 * wechselt die Datei ohne neue Seite. Die Anfrage laeuft parallel zu den
 * Artefakten und verzoegert das erste Bild nicht.
 *
 * Wer die Datei nicht sieht, bekommt 404 - wie bei den Notizen, damit sich
 * fremde fileIds nicht abtasten lassen.
 */
class MyPartController extends Controller {
	public function __construct(
		IRequest $request,
		private UserFileResolver $fileResolver,
		private ViewerPreferences $preferences,
		private IL10N $l,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	public function show(int $fileId): JSONResponse {
		$userId = $this->userWithAccess($fileId);
		if ($userId === null) {
			return $this->notFound();
		}
		return new JSONResponse(['partId' => $this->preferences->getMyPart($userId, $fileId)]);
	}

	/**
	 * @param ?string $partId Stimme aus meta.json `parts[].id`, null = keine
	 */
	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	public function update(int $fileId, ?string $partId = null): JSONResponse {
		$userId = $this->userWithAccess($fileId);
		if ($userId === null) {
			return $this->notFound();
		}
		// Antwortet mit dem, was gilt - eine unbrauchbare ID wird sichtbar zu
		// „keine Stimme", statt im Browser weiterzuleben.
		return new JSONResponse(['partId' => $this->preferences->setMyPart($userId, $fileId, $partId)]);
	}

	/**
	 * Die Nutzerin, wenn sie die Datei sieht - sonst null. Die Kennung kommt
	 * aus der Sitzung bzw. dem Token-Scope, nie aus der Anfrage.
	 */
	private function userWithAccess(int $fileId): ?string {
		$userId = $this->fileResolver->currentUserId();
		if ($userId === null || $this->fileResolver->resolveOwnNode($fileId) === null) {
			return null;
		}
		return $userId;
	}

	private function notFound(): JSONResponse {
		return new JSONResponse(['error' => $this->l->t('File not found or no access.')], Http::STATUS_NOT_FOUND);
	}
}
