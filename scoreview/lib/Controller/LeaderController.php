<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCA\ScoreView\Service\LeaderException;
use OCA\ScoreView\Service\LeaderService;
use OCA\ScoreView\Service\UserFileResolver;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\AnonRateLimit;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use OCP\AppFramework\Http\JSONResponse;
use OCP\Files\Node;
use OCP\IL10N;
use OCP\IRequest;

/**
 * Die Leitungen einer Partitur (B1, Regeln in Service\LeaderService).
 *
 * Zugriff in zwei Stufen, wie bei den Notizen:
 *
 * - **Wer die Datei nicht sieht, bekommt 404** - auf jedem Endpunkt, auch
 *   beim Lesen. Sonst liesse sich abtasten, welche fileIds es gibt.
 * - **Wer sie sieht, aber keine Leitung ist, bekommt beim Aendern und bei
 *   der Suche 403**. Die Pruefung sitzt hier auf dem Server; dass
 *   der Viewer die Knoepfe gar nicht erst zeigt, ist Bequemlichkeit, keine
 *   Absicherung.
 *
 * **UIDs nur an Leitungen.** Die Notizen verschicken die Kennung der Autorin
 * bewusst nicht (`mine` statt `userId`). Eine Leitung braucht sie aber, um
 * jemanden abzuberufen; alle anderen bekommen nur die Anzeigenamen -
 * sehen sollen sie, wer leitet, nicht die Kontonamen der Instanz sammeln.
 *
 * Alle Routen sind auch mit Direct-Editing-Token offen (E8): In der Mobil-App
 * gibt es keine Sitzung, und die Leitung soll auch dort ernennen koennen.
 * Die Leitungsrolle haengt an keinem Feature-Schalter - sie ist die Grundlage
 * fuer Stimmnotizen ebenso wie fuer „Folgt mir", und erst deren Endpunkte
 * fragen nach ihrem Schalter.
 */
class LeaderController extends Controller {
	public function __construct(
		IRequest $request,
		private UserFileResolver $fileResolver,
		private LeaderService $leaders,
		private IL10N $l,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	public function index(int $fileId): JSONResponse {
		[$node, $userId] = $this->resolve($fileId);
		if ($node === null) {
			return $this->notFound();
		}
		return new JSONResponse($this->listing($node, $userId));
	}

	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	public function create(int $fileId, string $userId = ''): JSONResponse {
		[$node, $actor] = $this->resolve($fileId);
		if ($node === null) {
			return $this->notFound();
		}
		try {
			$this->leaders->appoint($node, $actor, $userId);
		} catch (LeaderException $e) {
			return $this->refused($e);
		}
		return new JSONResponse($this->listing($node, $actor), Http::STATUS_CREATED);
	}

	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	public function destroy(int $fileId, string $uid): JSONResponse {
		[$node, $actor] = $this->resolve($fileId);
		if ($node === null) {
			return $this->notFound();
		}
		try {
			$this->leaders->revoke($node, $actor, $uid);
		} catch (LeaderException $e) {
			return $this->refused($e);
		}
		return new JSONResponse($this->listing($node, $actor));
	}

	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	// S4: Die Suche ist teuer - je Treffer ein Blick in den Dateibaum einer
	// anderen Nutzerin. 30 je Minute reichen fuers Tippen mit Verzoegerung im
	// Browser bei weitem. Beide Grenzen, weil Anfragen mit Token fuer
	// Nextclouds RateLimitingMiddleware anonym sind (sie laeuft vor unserer
	// Middleware, die den Nutzer erst setzt) - dort zaehlt die Adresse.
	#[UserRateLimit(limit: 30, period: 60)]
	#[AnonRateLimit(limit: 30, period: 60)]
	public function candidates(int $fileId, string $q = ''): JSONResponse {
		[$node, $actor] = $this->resolve($fileId);
		if ($node === null) {
			return $this->notFound();
		}
		try {
			return new JSONResponse($this->leaders->candidates($node, $actor, $q));
		} catch (LeaderException $e) {
			return $this->refused($e);
		}
	}

	/**
	 * Die Liste in der Form, die die anfragende Person sehen darf.
	 *
	 * @return array{isLeader: bool, leaders: list<array<string, mixed>>}
	 */
	private function listing(Node $node, string $userId): array {
		$isLeader = $this->leaders->isLeader($node, $userId);
		$leaders = [];
		foreach ($this->leaders->listLeaders($node) as $leader) {
			// `me` ist keine Kennung, sondern eine Aussage ueber die eigene
			// Person - sie darf auch an Nicht-Leitungen.
			$row = [
				'displayName' => $leader['displayName'],
				'isOwner' => $leader['isOwner'],
				'me' => $leader['userId'] === $userId,
			];
			if ($isLeader) {
				$row['userId'] = $leader['userId'];
				$row['canRevoke'] = !$leader['isOwner'];
			}
			$leaders[] = $row;
		}
		return ['isLeader' => $isLeader, 'leaders' => $leaders];
	}

	/**
	 * @return array{0: ?Node, 1: string} Node und Person, oder [null, ''],
	 *                                    wenn die Datei nicht sichtbar ist
	 */
	private function resolve(int $fileId): array {
		$userId = $this->fileResolver->currentUserId();
		$node = $userId === null ? null : $this->fileResolver->resolveOwnNode($fileId);
		return $node === null ? [null, ''] : [$node, $userId];
	}

	private function notFound(): JSONResponse {
		return new JSONResponse(['error' => $this->l->t('File not found or no access.')], Http::STATUS_NOT_FOUND);
	}

	private function refused(LeaderException $e): JSONResponse {
		return match ($e->getReason()) {
			LeaderException::NOT_LEADER => new JSONResponse(['error' => $this->l->t('Only leaders of this score can do that.')], Http::STATUS_FORBIDDEN),
			LeaderException::NOT_APPOINTABLE => new JSONResponse(['error' => $this->l->t('Only people who can open this score can lead it.')], Http::STATUS_BAD_REQUEST),
			LeaderException::OWNER => new JSONResponse(['error' => $this->l->t('The owner always leads the score and cannot be removed.')], Http::STATUS_BAD_REQUEST),
			default => new JSONResponse(['error' => $this->l->t('This person is not a leader of this score.')], Http::STATUS_NOT_FOUND),
		};
	}
}
