<?php

declare(strict_types=1);

namespace OCA\ScoreView\Middleware;

use Exception;
use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCA\ScoreView\Service\CompanionTokenException;
use OCA\ScoreView\Service\CompanionTokenService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\Middleware;
use OCP\DirectEditing\IManager;
use OCP\Files\IRootFolder;
use OCP\IRequest;
use OCP\IUserManager;
use OCP\IUserSession;
use ReflectionException;
use ReflectionMethod;
use Throwable;

/**
 * Laesst die mit #[DirectTokenOrSession] markierten Routen zusaetzlich zur
 * angemeldeten Sitzung auch gegen ein Direct-Editing-Token zu - und, fuer
 * weitere Dateien einer Setliste, gegen ein Begleit-Token dazu.
 *
 * **Warum ueberhaupt.** Die Seite, die eine mobile App vom Direct Editor
 * bekommt, traegt kein Sitzungscookie: Nextclouds OC\DirectEditing\Manager
 * nimmt den Token-Scope gleich nach open() wieder zurueck. Gemessen auf
 * Nextcloud 31.0.14 und 34.0.1 antworten ihre Folgeanfragen mit 401 - ohne
 * diesen Weg zeigte die Seite nichts an.
 *
 * Der Aufbau folgt nextcloud/text (#[RequireDocumentSession] + Middleware).
 * Vier Festlegungen, jede mit Grund:
 *
 * 1. **Header, kein Query-Parameter.** Ein Token in der URL landet in jedem
 *    Zugriffsprotokoll, im Referer und im Browserverlauf. text nimmt ihn als
 *    Parameter; das ist hier bewusst nicht nachgeahmt.
 * 2. **Der Dateivergleich ist Pflicht** - und laeuft ueber getParam(), also
 *    ueber das, was auch der Controller bekommt, nicht nur ueber den Pfad.
 *    Ohne ihn waere ein Token fuer Partitur A ein Schluessel fuer jede
 *    andere Partitur derselben Nutzerin. Routen ohne `fileId` (SoundFont,
 *    Anzeigeeinstellungen) beruehren keine Datei - dort bleibt es bei der
 *    Gueltigkeit des Tokens: Das SoundFont ist instanzweites Beiwerk, die
 *    Einstellungen gehoeren der Nutzerin, die das Token ohnehin ausweist.
 * 3. **Der Scope wird zurueckgenommen.** `useTokenScope()` laeuft auf
 *    IUserSession::setUser() hinaus und kann damit in die Sitzung schreiben.
 *    Zurueckgenommen wird ausschliesslich, was diese Middleware selbst gesetzt
 *    hat - sonst meldete eine regulaer angemeldete Nutzerin, die den Header
 *    zufaellig mitschickt, sich mit jeder Anfrage selbst ab.
 * 4. **Ein Begleit-Token gilt nie allein** (S1). Es kommt zusammen
 *    mit dem Direct-Editing-Token, aus dem es ausgegeben wurde; beide werden
 *    bei jeder Anfrage geprueft - das Direct-Editing-Token muss noch leben
 *    und zum Fingerabdruck `dt` passen, die Epoche der Nutzerin muss stimmen,
 *    sie muss existieren und aktiv sein, und die Datei wird neu aufgeloest.
 *    Ein Freigabeentzug, ein Passwortwechsel oder ein abgelaufenes
 *    Direct-Editing-Token beenden damit auch alle Begleiter.
 */
class DirectAccessMiddleware extends Middleware {
	public const HEADER = 'X-ScoreView-Token';
	public const COMPANION_HEADER = 'X-ScoreView-Companion';

	/** Siehe Festlegung 3 - nur der selbst gesetzte Scope wird zurueckgenommen. */
	private bool $scopeSetHere = false;
	private bool $volatileSetHere = false;

	public function __construct(
		private IRequest $request,
		private IUserSession $userSession,
		private IManager $directEditing,
		private IUserManager $userManager,
		private IRootFolder $rootFolder,
		private CompanionTokenService $companions,
		private DirectAccessContext $context,
	) {
	}

	public function beforeController(Controller $controller, string $methodName): void {
		$attribute = $this->attribute($controller, $methodName);
		if ($attribute === null) {
			return;
		}

		if ($this->userSession->getUser() !== null) {
			if ($attribute->directOnly) {
				// Begleit-Token gibt es nur fuer die Seite der mobilen Apps -
				// aus einer Sitzung heraus braucht sie niemand, und jedes
				// ausgegebene Token ist eines mehr, das irgendwo liegen kann.
				throw new DirectAccessException(Http::STATUS_FORBIDDEN, 'direct_token_required');
			}
			// Der Sitzungsfall bleibt, was er war. Die Pruefung steht hier nur
			// deshalb, weil #[NoCSRFRequired] sie Nextclouds SecurityMiddleware
			// aus der Hand genommen hat - nachgebildet wird genau deren
			// Reihenfolge (erst das Cookie, dann der Token).
			if ($attribute->csrfInSession
				&& (!$this->request->passesStrictCookieCheck() || !$this->request->passesCSRFCheck())) {
				throw new DirectAccessException(Http::STATUS_PRECONDITION_FAILED, 'csrf_check_failed');
			}
			$this->context->setSession();
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
			// soll gar nicht erst zu einer Sitzung fuehren. Auch Anfragen mit
			// Begleit-Token halten es am Leben - sie kommen von derselben
			// offenen Seite.
			$token->extend();
			$uid = $token->getUser();
			$file = $token->getFile();
		} catch (Throwable) {
			// Ungueltig, abgelaufen, oder die Datei ist inzwischen weg - alles
			// derselbe Fall fuer die Seite: neu oeffnen.
			throw new DirectAccessException(Http::STATUS_UNAUTHORIZED, 'token_expired');
		}

		// Ein deaktiviertes Konto hat keine Anfragen mehr - auch nicht ueber
		// ein Token, das vor dem Deaktivieren ausgestellt wurde. Nextclouds
		// Direct Editing prueft das selbst nicht.
		$user = $this->userManager->get($uid);
		if ($user === null || !$user->isEnabled()) {
			throw new DirectAccessException(Http::STATUS_UNAUTHORIZED, 'user_disabled');
		}

		$digest = CompanionTokenService::digest($header);
		$companion = $this->request->getHeader(self::COMPANION_HEADER);
		if ($companion !== '') {
			$this->companion($attribute, $companion, $uid, $digest);
			$this->userSession->setVolatileActiveUser($user);
			$this->volatileSetHere = true;
			$this->context->setToken(DirectAccessContext::COMPANION, $file->getId(), $digest);
			return;
		}

		try {
			$token->useTokenScope();
			$this->scopeSetHere = true;
		} catch (Throwable) {
			throw new DirectAccessException(Http::STATUS_UNAUTHORIZED, 'token_expired');
		}

		$fileId = $this->request->getParam('fileId');
		if ($fileId !== null && (int)$fileId !== $file->getId()) {
			throw new DirectAccessException(Http::STATUS_FORBIDDEN, 'token_file_mismatch');
		}

		if ($attribute->folderParam !== null) {
			// Festlegung 2 fuer Ordner: angelegt wird nur neben der Datei des
			// Tokens. Fehlt der Parameter, ist das kein Freibrief.
			$folderId = $this->request->getParam($attribute->folderParam);
			try {
				$parentId = $file->getParent()->getId();
			} catch (Throwable) {
				$parentId = null;
			}
			if ($folderId === null || $parentId === null || (int)$folderId !== $parentId) {
				throw new DirectAccessException(Http::STATUS_FORBIDDEN, 'token_folder_mismatch');
			}
		}

		$this->context->setToken(DirectAccessContext::DIRECT, $file->getId(), $digest);
	}

	/**
	 * Festlegung 4: ein Begleit-Token neben dem Direct-Editing-Token.
	 *
	 * Die Reihenfolge ist die der Kosten - erst, was ohne Zugriff geht
	 * (Route, Signatur, Bindung), dann die Nutzereinstellung, zuletzt der
	 * Dateibaum.
	 *
	 * @throws DirectAccessException
	 */
	private function companion(DirectTokenOrSession $attribute, string $companion, string $uid, string $digest): void {
		// Welche Routen ueberhaupt einen Begleiter nehmen, steht am Attribut:
		// weder die Ausgabe (keine Kette) noch das Anlegen einer Liste
		// noch Routen ohne Datei.
		$fileId = $this->request->getParam('fileId');
		if ($attribute->directOnly || $attribute->companion === null || $attribute->folderParam !== null || $fileId === null) {
			throw new DirectAccessException(Http::STATUS_FORBIDDEN, 'companion_not_allowed');
		}

		try {
			$claims = $this->companions->verify($companion);
		} catch (CompanionTokenException $e) {
			throw new DirectAccessException(
				Http::STATUS_UNAUTHORIZED,
				$e->getReason() === CompanionTokenException::EXPIRED ? 'companion_expired' : 'companion_invalid',
			);
		}

		// Gebunden an DIESES Direct-Editing-Token und DIESE Nutzerin: Ein
		// Begleiter aus einer anderen Seite - oder einer, dessen Seite es
		// nicht mehr gibt - gilt nicht.
		if (!hash_equals($claims['dt'], $digest) || $claims['uid'] !== $uid) {
			throw new DirectAccessException(Http::STATUS_UNAUTHORIZED, 'companion_invalid');
		}
		if ($claims['ep'] !== $this->companions->epoch($uid)) {
			throw new DirectAccessException(Http::STATUS_UNAUTHORIZED, 'companion_revoked');
		}
		if ($claims['purpose'] !== $attribute->companion) {
			throw new DirectAccessException(Http::STATUS_FORBIDDEN, 'companion_purpose');
		}
		if ((int)$fileId !== $claims['fid']) {
			throw new DirectAccessException(Http::STATUS_FORBIDDEN, 'token_file_mismatch');
		}

		// Die Datei neu aufloesen, aus Sicht der Nutzerin: Ein Token
		// ueberlebt keinen Freigabeentzug. 404 wie in den Controllern, damit
		// sich auch hier keine fileIds abtasten lassen.
		try {
			$nodes = $this->rootFolder->getUserFolder($uid)->getById($claims['fid']);
		} catch (Throwable) {
			$nodes = [];
		}
		if ($nodes === []) {
			throw new DirectAccessException(Http::STATUS_NOT_FOUND, 'not_found');
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
		if ($this->volatileSetHere) {
			$this->volatileSetHere = false;
			$this->userSession->setVolatileActiveUser(null);
		}
		if (!$this->scopeSetHere) {
			return;
		}
		$this->scopeSetHere = false;
		$this->userSession->setUser(null);
	}
}
