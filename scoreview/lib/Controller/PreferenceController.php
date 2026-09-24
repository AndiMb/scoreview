<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCA\ScoreView\Service\ViewerPreferences;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IL10N;
use OCP\IRequest;
use OCP\IUserSession;

/**
 * Die Anzeigeeinstellungen des Viewers - nur schreibend.
 *
 * Gelesen werden sie nicht ueber HTTP, sondern aus dem Anfangszustand der
 * Files-Seite (Listener\FilesLoadAdditionalScriptsListener): Der Viewer
 * braucht sie beim allerersten Rendern, ein zusaetzlicher Rundlauf waere
 * genau die Verzoegerung, in der die Partitur noch in der alten Farbe
 * aufleuchtet.
 *
 * Getrennt von Controller\SettingsController, weil dort jede Methode
 * ausdruecklich Admin-Rechte verlangt (AuthorizedAdminSetting) - hier ist
 * das Gegenteil richtig: jede angemeldete Nutzerin stellt ihre eigene
 * Anzeige ein, und mehr als die eigene kann sie nicht erreichen (die
 * Nutzerkennung kommt aus der Sitzung, nie aus der Anfrage).
 *
 * **Auch mit Direct-Editing-Token** (E8): In der mobilen App gibt
 * es keine Sitzung, und Dunkelmodus, Hervorhebung und Stereobild sollen dort
 * genauso gemerkt werden. Die Route ist nicht dateibezogen - der
 * Pflichtvergleich der Middleware hat hier nichts zu vergleichen, und das ist
 * richtig so: Das Token weist die Nutzerin aus, und mehr als ihre eigenen
 * Einstellungen erreicht auch sie hier nicht (die Kennung kommt aus dem
 * gesetzten Nutzer, nie aus der Anfrage). Ein Begleit-Token nimmt die Route
 * nicht an (`companion: null`) - es ist fuer weitere DATEIEN gedacht. Die
 * CSRF-Pruefung im Sitzungsfall holt die Middleware nach.
 */
class PreferenceController extends Controller {
	public function __construct(
		IRequest $request,
		private IUserSession $userSession,
		private ViewerPreferences $preferences,
		private IL10N $l,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	/**
	 * @param ?bool $stereoMyPart null = nicht mitgeschickt, bleibt unveraendert
	 * @param ?string $noteTheme null = nicht mitgeschickt, bleibt unveraendert
	 */
	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession(companion: null)]
	public function update(string $highlightColor = '', string $highlightMode = '', ?bool $stereoMyPart = null, ?string $noteTheme = null): JSONResponse {
		$userId = $this->userSession->getUser()?->getUID();
		if ($userId === null) {
			return new JSONResponse(['error' => $this->l->t('Not logged in.')], Http::STATUS_UNAUTHORIZED);
		}
		// Antwortet mit dem, was wirklich gespeichert wurde - eine unbekannte
		// Farbe faellt damit sichtbar auf die Vorgabe zurueck, statt im
		// Browser weiterzuleben und beim naechsten Oeffnen zu verschwinden.
		return new JSONResponse(
			$this->preferences->set($userId, $highlightColor, $highlightMode)
			+ $this->preferences->setDisplay($userId, $stereoMyPart, $noteTheme),
		);
	}
}
