<?php

declare(strict_types=1);

namespace OCA\ScoreView\DirectEditing;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Service\FeatureConfig;
use OCA\ScoreView\Service\ViewerPreferences;
use OCP\AppFramework\Http\FeaturePolicy;
use OCP\AppFramework\Http\NotFoundResponse;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\DirectEditing\IEditor;
use OCP\DirectEditing\IToken;
use OCP\IRequest;
use OCP\Util;

/**
 * Der Einstieg fuer die mobilen Nextcloud-Apps.
 *
 * **Warum ueberhaupt.** Die Android-App laedt keine App-Skripte der
 * Files-Seite und kennt Nextclouds Weboberflaeche nicht - der regulaere
 * Einstieg des Viewers (Listener\FilesLoadAdditionalScriptsListener) greift
 * dort nicht. Der einzige Weg zu einer eigenen Oberflaeche ist Nextclouds
 * Direct Editing: Die App blendet den Menueeintrag „Bearbeiten" genau dann
 * ein, wenn der Server fuer den Mimetype der Datei einen Editor meldet
 * (nachgesehen in nextcloud/android, FileMenuFilter/EditorUtils - es gibt
 * dort keine Allowlist, jeder registrierte Editor zaehlt), und oeffnet dessen
 * Seite in einer Vollbild-WebView.
 *
 * Die Auswahl laeuft dabei **allein ueber den Mimetype**. Die Krücke aus
 * E6 - eine Dateiaktion auf der Endung, falls `application/x-musescore` nicht
 * registriert ist - hat in der App keine Entsprechung. Ohne registrierten
 * Mimetype bleibt der Menueeintrag aus; siehe docs/installation.md, Schritt 4.
 *
 * **Was `open()` ausliefert.** Denselben Viewer wie die beiden anderen
 * Einstiege, nur ohne Nextclouds Oberflaeche drumherum: eine eigenstaendige
 * Seite mit einer schmalen Kopfzeile (templates/standalone.php,
 * src/components/StandaloneFrame.vue). Die Kopfzeile ist noetig, weil sonst
 * niemand das Schliesskreuz stellt - in den anderen Einstiegen tut das der
 * Wirt.
 *
 * Gemessen in der WebView der Android-App (Galaxy S23): AudioWorklet und
 * WebAssembly laufen, der Ton ist hoerbar, und `navigator.wakeLock` wird
 * erteilt. Nur die Vollbild-API ist dort abgeschaltet - der Viewer blendet
 * seinen Vollbildknopf deshalb aus, wo `document.fullscreenEnabled` falsch
 * ist (composables/useZoom.js).
 *
 * Kein Eintrag in appinfo/routes.php: Diese Seite hat keine eigene URL. Sie
 * wird ausschliesslich unter /apps/files/directEditing/{token} ausgeliefert,
 * und nur gegen einen Einmal-Token, den die Files-App ausgestellt hat. Die
 * Zusage aus info.xml bleibt damit sachlich gewahrt - kein eigener Einstieg,
 * nur eine eigene Auslieferungsform fuer Clients, die die Files-Seite nicht
 * kennen.
 */
class ScoreDirectEditor implements IEditor {
	public function __construct(
		private IInitialState $initialState,
		private IRequest $request,
		private ViewerPreferences $preferences,
		private FeatureConfig $features,
	) {
	}

	public function getId(): string {
		return Application::APP_ID;
	}

	/**
	 * Der Produktname, bewusst ohne $l->t(): Er ist in jeder Sprache
	 * derselbe, und eine Uebersetzungszeile „ScoreView" -> „ScoreView" waere
	 * nur Pflegeaufwand (E4 gilt fuer Oberflaechentexte, nicht fuer Namen).
	 */
	public function getName(): string {
		return 'ScoreView';
	}

	public function getMimetypes(): array {
		return [Application::MSCZ_MIMETYPE];
	}

	/**
	 * Bewusst leer. `application/octet-stream` hier einzutragen waere
	 * technisch wirksam - auf einer Instanz ohne Mimetype-Registrierung
	 * stehen .mscz-Dateien genau darauf - und fachlich falsch: Die App boete
	 * „Bearbeiten mit ScoreView" dann fuer jede unbekannte Datei an, vom
	 * Archiv bis zum Firmware-Abbild.
	 */
	public function getMimetypesOptional(): array {
		return [];
	}

	/**
	 * Bewusst leer: ScoreView erzeugt keine Partituren. Ein Creator erschiene
	 * im „+"-Menue der mobilen Apps als Eintrag „Neue Partitur", der
	 * nirgendwohin fuehrte.
	 */
	public function getCreators(): array {
		return [];
	}

	/** Kein „secure view"-Modus (Wasserzeichen, Weiterleitungssperre) - den kennt der Bestand nicht. */
	public function isSecure(): bool {
		return false;
	}

	public function open(IToken $token): Response {
		// Nur fuer DIESEN Request: OC\DirectEditing\Manager nimmt den Scope
		// gleich nach open() wieder zurueck (revertTokenScope() im finally).
		// Die Folgeanfragen der Seite weisen sich deshalb mit dem Token aus -
		// siehe Middleware\DirectAccessMiddleware und src/standalone.js.
		$token->useTokenScope();

		try {
			$file = $token->getFile();
			$fileId = $file->getId();
			$fileName = $file->getName();
		} catch (\Throwable) {
			return new NotFoundResponse();
		}

		$this->initialState->provideInitialState('standalone', [
			'fileId' => $fileId,
			'fileName' => $fileName,
			// Der Ausweis der Folgeanfragen (src/standalone.js).
			//
			// Nicht ueber IToken::getToken(): die Methode gibt es erst seit
			// Nextcloud 35, die App unterstuetzt ab 31. Der Router legt den
			// URL-Parameter der Route /apps/files/directEditing/{token} in die
			// Request-Parameter; dass er dort auf 31 wie auf 34 ankommt, ist
			// nachgemessen.
			'token' => (string)$this->request->getParam('token', ''),
			// Woran die Seite sich selbst erkennt - etwa, um statt Nextclouds
			// Dateiauswahl (braucht eine Sitzung) nur die Partituren rund um
			// die offene anzubieten (components/SetlistEditor.vue).
			'directEditing' => true,
		]);

		// Dieselben Anzeigeeinstellungen wie auf der Dateien-Seite und unter
		// demselben Schluessel (Listener\FilesLoadAdditionalScriptsListener):
		// Der Viewer braucht sie beim allerersten Rendern, sonst leuchtet die
		// Partitur einen Moment in der Vorgabefarbe auf. Der Nutzername kommt
		// aus dem Token, nicht aus der Sitzung - die gibt es hier nicht.
		$this->initialState->provideInitialState(
			'viewer-preferences', $this->preferences->get($token->getUser()));
		// Die Schalter der Administration gelten auch hier: Eine abgeschaltete
		// Funktion darf in der App nicht auftauchen, nur weil der Einstieg ein
		// anderer ist.
		$this->initialState->provideInitialState('features', $this->features->forViewer());

		Util::addScript(Application::APP_ID, Application::APP_ID . '-standalone');

		// RENDER_AS_BASE: Seite ohne Navigation und ohne Files-Oberflaeche.
		// Dasselbe tut nextcloud/whiteboard fuer seinen Direct Editor.
		$response = new TemplateResponse(
			Application::APP_ID, 'standalone', [], TemplateResponse::RENDER_AS_BASE);

		// Das Mikrofon fuer Aufnahme, Intonation und Mitverfolgen - direkt an
		// DIESER Antwort statt ueber das instanzweite Ereignis (S3):
		// Die Richtlinie gilt dann fuer genau diese Seite. Nextclouds
		// FeaturePolicyMiddleware fuehrt sie mit der Vorgabe zusammen, weil es
		// eine FeaturePolicy ist und keine EmptyFeaturePolicy - die ersetzte
		// die Vorgabe ganz und naehme der Seite etwa das Vollbild. Nur wenn
		// eine Mikrofonfunktion eingeschaltet ist: Eine Freigabe, die niemand
		// nutzt, waere eine Tuer ohne Zweck. Ob die WebView der App das
		// Mikrofon dann wirklich hergibt, entscheidet sie selbst (E8).
		if ($this->features->usesMicrophone()) {
			$policy = new FeaturePolicy();
			$policy->addAllowedMicrophoneDomain("'self'");
			$response->setFeaturePolicy($policy);
		}
		return $response;
	}
}
