<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Service\LocalConverter;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\StreamResponse;
use OCP\IL10N;
use OCP\IRequest;

/**
 * Liefert die drei Dateien der scoreview-engine an den Browser aus - fuer den
 * Konvertierungsweg, der im Client laeuft, wo der Server nicht konvertieren
 * kann.
 *
 * **Warum eine eigene Route und nicht statisch aus dem App-Verzeichnis.**
 * Nextclouds `.htaccess` leitet jede Anfrage, deren Endung nicht in einer
 * festen Liste steht, auf `index.php` um. `.wasm` steht darin, das
 * Ressourcenpaket `.data` NICHT - statisch ausgeliefert wuerde es also
 * schlicht 404 liefern. Der uebliche Ausweg (umbenennen nach `.data.wasm`
 * und die Verweise im Glue patchen) haette die Datei entweder ein zweites Mal
 * ins Paket gebracht oder den Node-Weg denselben Patch mittragen lassen.
 * Ueber eine Route entfaellt beides, und sie ist ausserdem unabhaengig davon,
 * ob das App-Verzeichnis ueberhaupt im Webroot liegt (`apps_paths`).
 *
 * Preis: PHP liegt im Pfad eines rund 14 MB grossen Downloads. Wegen
 * `immutable` passiert das einmal je Browser und Engine-Version - dasselbe
 * Muster wie beim SoundFont (Controller\SoundFontController), das mit ~40 MB
 * dreimal so schwer wiegt.
 *
 * **Die Namen sind eine Allowlist, kein Pfad.** Drei feste Eintraege, jeder
 * mit seinem Inhaltstyp; alles andere ist 404. Damit gibt es keinen
 * Pfadanteil, den ein Aufruf beeinflussen koennte.
 *
 * **Die drei Dateien muessen unter demselben Praefix liegen.** Der Glue sucht
 * `scoreview.lib.wasm` und `scoreview.lib.data` relativ zu seiner eigenen
 * Script-URL (getSelfURL/locateFile im Engine-Paket). Bei `/api/engine/{name}`
 * stimmt das von selbst - deshalb ist der Routenzuschnitt hier keine
 * Geschmacksfrage.
 *
 * Zugriff fuer jede eingeloggte Nutzerin (#[NoAdminRequired]): appeigenes,
 * statisches Beiwerk wie ein Bundle, kein Nutzerinhalt.
 */
class EngineController extends Controller {
	/** Wie in ConversionController: der Inhalt ist fuer eine Version unveraenderlich. */
	private const IMMUTABLE_CACHE_SECONDS = 31536000;

	/**
	 * Was ausgeliefert werden darf, und als was. `text/javascript` fuer den
	 * Glue ist Pflicht, nicht Kosmetik: Der Browser fuehrt ein Modul aus einem
	 * anderen Typ gar nicht erst aus.
	 */
	private const FILES = [
		'scoreview.mjs' => 'text/javascript',
		'scoreview.lib.wasm' => 'application/wasm',
		// Emscriptens vorgeladenes Ressourcenpaket (Schriften, SMuFL-Metadaten).
		// Kein eigener Typ dafuer - der Glue liest es als Bytes.
		'scoreview.lib.data' => 'application/octet-stream',
	];

	public function __construct(
		IRequest $request,
		private LocalConverter $localConverter,
		private IL10N $l,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function get(string $name): Http\Response {
		$mimeType = self::FILES[$name] ?? null;
		if ($mimeType === null) {
			return new JSONResponse(['error' => $this->l->t('Requested file does not exist.')], Http::STATUS_NOT_FOUND);
		}

		$path = $this->localConverter->getConverterDir() . '/node_modules/scoreview-engine/' . $name;
		$handle = @fopen($path, 'rb');
		if ($handle === false) {
			// Kein 500: Das Engine-Paket fehlt im Auslieferungsbaum ist ein
			// Installationszustand, den die Betriebsdiagnose ohnehin nennt
			// (Service\LocalConverter::describe).
			return new JSONResponse(['error' => $this->l->t('Requested file does not exist.')], Http::STATUS_NOT_FOUND);
		}

		$response = new StreamResponse($handle);
		$response->addHeader('Content-Type', $mimeType);
		$size = @filesize($path);
		if ($size !== false) {
			$response->addHeader('Content-Length', (string)$size);
		}
		$response->setETag($this->localConverter->engineVersion());
		$response->cacheFor(self::IMMUTABLE_CACHE_SECONDS, false, true);
		return $response;
	}
}
