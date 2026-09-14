<?php

declare(strict_types=1);

namespace OCA\ScoreView\Middleware;

use Exception;
use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\Middleware;
use OCP\DirectEditing\IManager;
use OCP\IRequest;
use OCP\IUserSession;
use ReflectionException;
use ReflectionMethod;
use Throwable;

/**
 * Laesst die mit #[DirectTokenOrSession] markierten Routen zusaetzlich zur
 * angemeldeten Sitzung auch gegen ein Direct-Editing-Token zu.
 *
 * **Warum ueberhaupt.** Die Seite, die eine mobile App vom Direct Editor
 * bekommt, traegt kein Sitzungscookie: Nextclouds OC\DirectEditing\Manager
 * nimmt den Token-Scope gleich nach open() wieder zurueck. Gemessen auf
 * Nextcloud 31.0.14 und 34.0.1 antworten ihre Folgeanfragen mit 401 - ohne
 * diesen Weg zeigte die Seite nichts an.
 *
 * Der Aufbau folgt nextcloud/text (#[RequireDocumentSession] + Middleware).
 * Drei Festlegungen, jede mit Grund:
 *
 * 1. **Header, kein Query-Parameter.** Ein Token in der URL landet in jedem
 *    Zugriffsprotokoll, im Referer und im Browserverlauf. text nimmt ihn als
 *    Parameter; das ist hier bewusst nicht nachgeahmt.
 * 2. **Der Dateivergleich ist Pflicht.** Ohne ihn waere ein Token fuer
 *    Partitur A ein Schluessel fuer jede andere Partitur derselben Nutzerin.
 *    Routen ohne `fileId` (SoundFont, Engine) liefern instanzweite, nicht
 *    nutzerbezogene Artefakte - dort gibt es nichts zu vergleichen, und es
 *    bleibt bei der Gueltigkeitspruefung des Tokens.
 * 3. **Der Scope wird zurueckgenommen.** `useTokenScope()` laeuft auf
 *    IUserSession::setUser() hinaus und kann damit in die Sitzung schreiben.
 *    Zurueckgenommen wird ausschliesslich, was diese Middleware selbst gesetzt
 *    hat - sonst meldete eine regulaer angemeldete Nutzerin, die den Header
 *    zufaellig mitschickt, sich mit jeder Anfrage selbst ab.
 */
class DirectAccessMiddleware extends Middleware {
	public const HEADER = 'X-ScoreView-Token';

	/** Siehe Festlegung 3 - nur der selbst gesetzte Scope wird zurueckgenommen. */
	private bool $scopeSetHere = false;

	public function __construct(
		private IRequest $request,
		private IUserSession $userSession,
		private IManager $directEditing,
	) {
	}

	public function beforeController(Controller $controller, string $methodName): void {
		$attribute = $this->attribute($controller, $methodName);
		if ($attribute === null) {
			return;
		}

		if ($this->userSession->getUser() !== null) {
			// Der Sitzungsfall bleibt, was er war. Die Pruefung steht hier nur
			// deshalb, weil #[NoCSRFRequired] sie Nextclouds SecurityMiddleware
			// aus der Hand genommen hat - nachgebildet wird genau deren
			// Reihenfolge (erst das Cookie, dann der Token).
			if ($attribute->csrfInSession
				&& (!$this->request->passesStrictCookieCheck() || !$this->request->passesCSRFCheck())) {
				throw new DirectAccessException(Http::STATUS_PRECONDITION_FAILED, 'csrf_check_failed');
			}
			return;
		}

		$header = $this->request->getHeader(self::HEADER);
		if ($header === '') {
			// Weder Sitzung noch Token: dieselbe Antwort, die Nextcloud ohne
			// #[PublicPage] gegeben haette.
			throw new DirectAccessException(Http::STATUS_UNAUTHORIZED, 'no_session');
		}

		try {
			$token = $this->directEditing->getToken($header);
			// Verlaengern, bevor der Scope gesetzt wird: Ein abgelaufener Token
			// soll gar nicht erst zu einer Sitzung fuehren.
			$token->extend();
			$token->useTokenScope();
			$this->scopeSetHere = true;
			$file = $token->getFile();
		} catch (Throwable) {
			// Ungueltig, abgelaufen, oder die Datei ist inzwischen weg - alles
			// derselbe Fall fuer die Seite: neu oeffnen. Ein eventuell schon
			// gesetzter Scope faellt ueber afterException wieder weg.
			throw new DirectAccessException(Http::STATUS_UNAUTHORIZED, 'token_expired');
		}

		$fileId = $this->request->getParam('fileId');
		if ($fileId !== null && (int)$fileId !== $file->getId()) {
			throw new DirectAccessException(Http::STATUS_FORBIDDEN, 'token_file_mismatch');
		}
	}

	public function afterController(Controller $controller, string $methodName, Response $response): Response {
		$this->revertScope();
		return $response;
	}

	public function afterException(Controller $controller, string $methodName, Exception $exception): Response {
		$this->revertScope();

		if ($exception instanceof DirectAccessException) {
			return new JSONResponse(
				['status' => 'error', 'errorCode' => $exception->getErrorCode()],
				$exception->getStatus(),
			);
		}

		throw $exception;
	}

	/**
	 * Das Attribut der aufgerufenen Methode - oder null, wenn die Route diesen
	 * Weg gar nicht anbietet. Dann ruehrt die Middleware nichts an.
	 */
	private function attribute(Controller $controller, string $methodName): ?DirectTokenOrSession {
		try {
			$reflection = new ReflectionMethod($controller, $methodName);
		} catch (ReflectionException) {
			return null;
		}

		$attributes = $reflection->getAttributes(DirectTokenOrSession::class);
		if ($attributes === []) {
			return null;
		}

		return $attributes[0]->newInstance();
	}

	private function revertScope(): void {
		if (!$this->scopeSetHere) {
			return;
		}
		$this->scopeSetHere = false;
		$this->userSession->setUser(null);
	}
}
