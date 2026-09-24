<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCA\ScoreView\Service\FeatureConfig;
use OCA\ScoreView\Service\FollowException;
use OCA\ScoreView\Service\FollowService;
use OCA\ScoreView\Service\UserFileResolver;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\AnonRateLimit;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\Response;
use OCP\Files\Node;
use OCP\IL10N;
use OCP\IRequest;

/**
 * „Folgt mir" (E10; die Regeln stehen in Service\FollowService).
 *
 * Zugriff wie bei den Leitungen:
 *
 * - **Schalter aus → 404** auf jedem Endpunkt. Nicht 403: Eine
 *   abgeschaltete Funktion soll aussehen wie eine, die es nicht gibt, und der
 *   Viewer zeigt dann nichts davon.
 * - **Ohne Dateizugriff 404**, damit sich fileIds nicht abtasten lassen.
 * - **Ohne Leitungsrolle 403** beim Starten, Senden und Beenden. Lesen und
 *   Anmelden darf jede Person mit Dateizugriff.
 *
 * **Die Dateipruefung laeuft bei jeder Abfrage**, auch wenn der
 * Zustand selbst aus dem Cache kommt. Gemessen macht sie nur einen
 * kleinen Teil der Kosten ausmacht - sie zu cachen liesse nach einem
 * Freigabeentzug ein Fenster offen, in dem jemand weiter mitliest.
 *
 * Jede Antwort traegt `serverNow` und `pollMs`: `serverNow`, damit das Geraet
 * das Alter eines Anfangstons an der Uhr des Servers misst, `pollMs`,
 * damit eine geaenderte Einstellung auch laufende Sitzungen erreicht.
 * Das 204 hat keinen Rumpf; dort steht `pollMs` im Kopf.
 *
 * Alle Routen sind auch mit Direct-Editing-Token offen (E8): Leiten und
 * Folgen gehen mobil uneingeschraenkt, es sind gewoehnliche Anfragen.
 */
class FollowController extends Controller {
	public const POLL_HEADER = 'X-ScoreView-Poll-Ms';

	public function __construct(
		IRequest $request,
		private UserFileResolver $fileResolver,
		private FollowService $follow,
		private FeatureConfig $features,
		private IL10N $l,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	/**
	 * @param string $since die Version, die das Geraet schon hat
	 * @param bool $push das Geraet empfaengt Push und haelt so seine
	 *                   Anmeldung am Leben (FollowService::refreshMember)
	 */
	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	public function show(int $fileId, string $since = '', bool $push = false): Response {
		[$node, $userId] = $this->resolve($fileId);
		if ($node === null) {
			return $this->notFound();
		}
		if ($push) {
			$this->follow->refreshMember($fileId, $userId);
		}
		$snapshot = $this->follow->read($fileId, $since === '' ? null : $since);
		if ($snapshot === null) {
			$response = new Response(Http::STATUS_NO_CONTENT);
			$response->addHeader(self::POLL_HEADER, (string)$this->features->followPollMs());
			$response->cacheFor(0);
			return $response;
		}
		return $this->respond($snapshot, $userId);
	}

	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	// Starten und Beenden verteilen je einen Push an alle Folgenden; 30 je
	// Minute sind weit mehr, als eine Probe braucht (wie beim Ernennen von
	// Leitungen). Beide Grenzen, weil Anfragen mit Token fuer die
	// RateLimitingMiddleware anonym sind.
	#[UserRateLimit(limit: 30, period: 60)]
	#[AnonRateLimit(limit: 30, period: 60)]
	public function create(int $fileId, ?int $measure = null, ?string $mark = null): JSONResponse {
		[$node, $userId] = $this->resolve($fileId);
		if ($node === null) {
			return $this->notFound();
		}
		try {
			return $this->respond($this->follow->start($node, $userId, $measure, $mark), $userId, Http::STATUS_CREATED);
		} catch (FollowException $e) {
			return $this->refused($e);
		}
	}

	/**
	 * @param ?array{measure?: int, mark?: ?string} $position
	 * @param ?array{from?: int, to?: int} $loop
	 */
	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	// Die Leitung blaettert, springt und setzt Schleifen oft in schneller
	// Folge; dazu kommt der Herzschlag. 120 je Minute lassen dem Spielraum
	// und deckeln doch, was ein festhaengender Knopf oder ein Skript an
	// Schreibzugriffen und Verteilungen an alle Folgenden ausloesen kann.
	// Beide Grenzen aus demselben Grund wie bei den Aufnahmen: Mit Token ist
	// die Anfrage fuer die RateLimitingMiddleware anonym.
	#[UserRateLimit(limit: 120, period: 60)]
	#[AnonRateLimit(limit: 120, period: 60)]
	public function update(
		int $fileId,
		?array $position = null,
		?array $loop = null,
		bool $clearLoop = false,
		bool $tone = false,
		bool $heartbeat = false,
	): JSONResponse {
		[$node, $userId] = $this->resolve($fileId);
		if ($node === null) {
			return $this->notFound();
		}
		$changes = ['clearLoop' => $clearLoop, 'tone' => $tone, 'heartbeat' => $heartbeat];
		if ($position !== null) {
			$changes['position'] = $position;
		}
		if ($loop !== null) {
			$changes['loop'] = $loop;
		}
		try {
			return $this->respond($this->follow->change($node, $userId, $changes), $userId);
		} catch (FollowException $e) {
			return $this->refused($e);
		}
	}

	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	#[UserRateLimit(limit: 30, period: 60)]
	#[AnonRateLimit(limit: 30, period: 60)]
	public function destroy(int $fileId): JSONResponse {
		[$node, $userId] = $this->resolve($fileId);
		if ($node === null) {
			return $this->notFound();
		}
		try {
			return $this->respond($this->follow->end($node, $userId), $userId);
		} catch (FollowException $e) {
			return $this->refused($e);
		}
	}

	/**
	 * Anmelden fuer Push (E10). Die Antwort sagt, ob sich das Geraet darauf
	 * verlassen darf - `push: false` heisst: weiter abfragen.
	 */
	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	// Ein Geraet meldet sich beim Oeffnen und nach jedem Verbindungsabbruch
	// neu an - 30 je Minute lassen auch einem wackligen WLAN Luft.
	#[UserRateLimit(limit: 30, period: 60)]
	#[AnonRateLimit(limit: 30, period: 60)]
	public function join(int $fileId): JSONResponse {
		[$node, $userId] = $this->resolve($fileId);
		if ($node === null) {
			return $this->notFound();
		}
		return new JSONResponse(['push' => $this->follow->join($fileId, $userId)]);
	}

	/**
	 * Der Stand in der Form, die ein Geraet sieht. Die Kennung der Leitung
	 * geht nicht mit (wie in LeaderController): Angezeigt wird der
	 * Name, und ob man es selbst ist, sagt `me`.
	 */
	private function respond(array $snapshot, string $userId, int $status = Http::STATUS_OK): JSONResponse {
		$body = [
			'version' => $snapshot['version'],
			'active' => $snapshot['active'],
			'serverNow' => $this->follow->nowMs(),
			'pollMs' => $this->features->followPollMs(),
		];
		if ($snapshot['active']) {
			$body['leader'] = [
				'displayName' => $snapshot['leaderName'],
				'me' => $snapshot['leaderUid'] === $userId,
			];
			$body['state'] = $snapshot['state'];
		}
		$response = new JSONResponse($body, $status);
		$response->cacheFor(0);
		return $response;
	}

	/**
	 * @return array{0: ?Node, 1: string} Node und Person, oder [null, ''],
	 *                                    wenn die Funktion aus oder die Datei
	 *                                    nicht sichtbar ist
	 */
	private function resolve(int $fileId): array {
		if (!$this->features->isEnabled(FeatureConfig::FOLLOW_SESSION)) {
			return [null, ''];
		}
		$userId = $this->fileResolver->currentUserId();
		$node = $userId === null ? null : $this->fileResolver->resolveOwnNode($fileId);
		return $node === null ? [null, ''] : [$node, $userId];
	}

	private function notFound(): JSONResponse {
		return new JSONResponse(['error' => $this->l->t('File not found or no access.')], Http::STATUS_NOT_FOUND);
	}

	private function refused(FollowException $e): JSONResponse {
		return match ($e->getReason()) {
			FollowException::NOT_LEADER => new JSONResponse(['error' => $this->l->t('Only leaders of this score can do that.')], Http::STATUS_FORBIDDEN),
			FollowException::NO_SESSION => new JSONResponse(['error' => $this->l->t('No “Follow me” session is running for this score.')], Http::STATUS_CONFLICT),
			FollowException::OTHER_LEADER => new JSONResponse(['error' => $this->l->t('Another leader is leading this session. Take it over first.')], Http::STATUS_CONFLICT),
			FollowException::INVALID => new JSONResponse(['error' => $this->l->t('This position or loop does not exist.')], Http::STATUS_BAD_REQUEST),
			default => new JSONResponse(['error' => $this->l->t('Another leader changed the session at the same moment. Please try again.')], Http::STATUS_CONFLICT),
		};
	}
}
