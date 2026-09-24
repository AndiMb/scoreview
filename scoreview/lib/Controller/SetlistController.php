<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCA\ScoreView\Middleware\DirectAccessContext;
use OCA\ScoreView\Middleware\DirectAccessMiddleware;
use OCA\ScoreView\Service\CompanionTokenService;
use OCA\ScoreView\Service\SetlistException;
use OCA\ScoreView\Service\SetlistService;
use OCA\ScoreView\Service\UserFileResolver;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\AnonRateLimit;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use OCP\AppFramework\Http\JSONResponse;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\IL10N;
use OCP\IRequest;
use Psr\Log\LoggerInterface;

/**
 * Setlisten (E11). Die Regeln stehen in
 * Service\SetlistService; hier nur Zugriff und Abbildung auf HTTP.
 *
 * **Alle Routen nehmen auch ein Direct-Editing-Token** (E8): Die mobile
 * App kennt keine Sitzung. Das Token gilt fuer genau die Datei, mit der die
 * Seite geoeffnet wurde (Middleware\DirectAccessMiddleware) - fuer die Routen
 * an einer Partitur (`/api/scores/{fileId}/…`) also die offene Partitur. Jede
 * weitere Datei - die Setlisten-Datei selbst und die Stuecke darin - braucht
 * ein Begleit-Token (S1), das `tokens()` ausgibt. Die Routen sind so
 * geschnitten, dass sie dafuer nichts aendern muessen: Jede traegt die Datei,
 * um die es geht, als `fileId` in der Adresse.
 *
 * **Mit Token wird enger geschrieben als in der Sitzung** (S2):
 * Sonst liesse sich mit dem Token fuer EINE Partitur eine Liste mit
 * beliebigen Dateien der Nutzerin anlegen und fuer sie Begleit-Token
 * abholen - aus einer Erlaubnis fuer eine Datei wuerde eine fuer alle. Mit
 * Direct-Editing-Token kommen neue Eintraege deshalb nur aus der Auswahl
 * rund um die offene Partitur (`candidates`), mit Begleit-Token gar keine -
 * dort bleibt Umordnen und Entfernen. Beliebige Pfade gibt es nur in der
 * Browser-Sitzung.
 *
 * Wer eine Datei nicht sieht, bekommt 404 statt 403 - wie bei den Notizen,
 * damit sich fremde fileIds nicht abtasten lassen.
 */
class SetlistController extends Controller {
	public function __construct(
		IRequest $request,
		private UserFileResolver $fileResolver,
		private SetlistService $setlists,
		private IL10N $l,
		private DirectAccessContext $access,
		private CompanionTokenService $companions,
		private LoggerInterface $logger,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	/**
	 * Die Liste, aufgeloest aus Sicht der Anfragenden. Stoesst nebenbei die
	 * Konvertierung der Stuecke an - deshalb mit CSRF-Pruefung im
	 * Sitzungsfall, wie der Statusendpunkt.
	 */
	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession(companion: CompanionTokenService::PURPOSE_SETLIST)]
	public function show(int $fileId): JSONResponse {
		[$uid, $setlist] = $this->setlist($fileId);
		if ($setlist === null) {
			return $this->error(SetlistException::NOT_FOUND);
		}
		return $this->run(fn () => new JSONResponse($this->setlists->load($setlist, $uid)));
	}

	/**
	 * @param mixed $entries siehe SetlistService::save()
	 * @param ?string $etag der gelesene Stand - gegen gleichzeitiges Bearbeiten im Texteditor
	 */
	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession(companion: CompanionTokenService::PURPOSE_SETLIST)]
	// Jedes Speichern loest alle Eintraege im Dateibaum auf und schreibt die
	// Datei neu; gespeichert wird aus dem Editor heraus, nicht bei jedem
	// Tastendruck. Beide Grenzen, weil Anfragen mit Token anonym zaehlen.
	#[UserRateLimit(limit: 30, period: 60)]
	#[AnonRateLimit(limit: 30, period: 60)]
	public function update(int $fileId, mixed $entries = null, ?string $etag = null): JSONResponse {
		[$uid, $setlist] = $this->setlist($fileId);
		if ($setlist === null) {
			return $this->error(SetlistException::NOT_FOUND);
		}
		return $this->run(fn () => new JSONResponse(
			$this->setlists->save($setlist, $uid, $entries, $etag, $this->allowedForTokenWrite())));
	}

	/**
	 * Eine neue Liste in `folderFileId`. Mit Token nur im Ordner der offenen
	 * Partitur - das prueft die Middleware ueber `folderParam` - und
	 * nie mit einem Begleit-Token (S1).
	 *
	 * @param mixed $entries siehe SetlistService::create()
	 */
	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession(folderParam: 'folderFileId', companion: null)]
	#[UserRateLimit(limit: 30, period: 60)]
	#[AnonRateLimit(limit: 30, period: 60)]
	public function create(int $folderFileId = 0, string $name = '', mixed $entries = []): JSONResponse {
		$uid = $this->fileResolver->currentUserId();
		$folder = $uid === null ? null : $this->fileResolver->resolveOwnNode($folderFileId);
		if (!$folder instanceof Folder) {
			return $this->error(SetlistException::NOT_FOUND);
		}
		return $this->run(function () use ($folder, $uid, $name, $entries) {
			$file = $this->setlists->create($folder, $uid, $name, $entries, $this->allowedForTokenWrite());
			return new JSONResponse($this->setlists->load($file, $uid), Http::STATUS_CREATED);
		});
	}

	/**
	 * Weg 2 (E11): die Listen im Ordner der Partitur, die sie enthalten.
	 * Ohne Begleit-Token (S1): Die mobile Seite fragt das nur fuer
	 * die Partitur, mit der sie geoeffnet wurde.
	 */
	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession(companion: null)]
	public function forScore(int $fileId): JSONResponse {
		[$uid, $score] = $this->file($fileId);
		if ($score === null) {
			return $this->error(SetlistException::NOT_FOUND);
		}
		return new JSONResponse([
			'setlists' => $this->setlists->containing($score, $uid),
			// Wo „Neue Setliste" anlegt, und ob es das darf - der Editor
			// fragt nicht eigens nach.
			'folderFileId' => $score->getParent()->getId(),
			'canCreate' => $score->getParent()->isCreatable(),
		]);
	}

	/** Die Auswahl fuer den Editor, auch ohne Nextclouds Dateiauswahl. */
	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession(companion: null)]
	public function candidates(int $fileId): JSONResponse {
		[, $score] = $this->file($fileId);
		if ($score === null) {
			return $this->error(SetlistException::NOT_FOUND);
		}
		return new JSONResponse(['candidates' => $this->setlists->candidates($score)]);
	}

	/**
	 * Begleit-Token fuer eine Setliste (S1): eines je
	 * Stueck, das die Nutzerin sehen darf, und eines fuer die Liste selbst.
	 *
	 * Nur mit dem Direct-Editing-Token der Partitur `{fileId}` - weder aus
	 * einer Sitzung noch aus einem Begleiter heraus (das Attribut). Und nur
	 * fuer eine Liste, die diese Partitur enthaelt und neben ihr liegt
	 * (`containing`, dieselbe Suche wie Weg 2): Die Seite kann so nie mehr
	 * aufschliessen als die Setlisten, die ihr ohnehin angeboten werden.
	 *
	 * Die Token selbst werden nicht protokolliert, nur wer wie viele bekam.
	 */
	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession(companion: null, directOnly: true)]
	public function tokens(int $fileId, int $setlistId): JSONResponse {
		[$uid, $score] = $this->file($fileId);
		$digest = $this->access->directDigest();
		if ($score === null || $uid === null || $digest === null || $this->access->mode() !== DirectAccessContext::DIRECT) {
			return $this->error(SetlistException::NOT_FOUND);
		}
		$offered = array_column($this->setlists->containing($score, $uid), 'id');
		if (!in_array($setlistId, $offered, true)) {
			return $this->error(SetlistException::NOT_FOUND);
		}
		[, $setlist] = $this->setlist($setlistId);
		if ($setlist === null) {
			return $this->error(SetlistException::NOT_FOUND);
		}

		return $this->run(function () use ($setlist, $setlistId, $uid, $fileId, $score, $digest) {
			$loaded = $this->setlists->load($setlist, $uid, false);
			$tokens = [[
				'fileId' => $setlistId,
				'token' => $this->companions->issue($uid, $setlistId, CompanionTokenService::PURPOSE_SETLIST, $digest),
			]];
			$seen = [$score->getId() => true, $setlistId => true];
			foreach ($loaded['entries'] as $entry) {
				$id = $entry['fileId'];
				// Nur, was aus ihrer Sicht aufgeloest ist - ein `missing`
				// bekommt kein Token, auch nicht auf Verdacht. Die offene
				// Partitur braucht keins, sie hat das Direct-Editing-Token.
				if ($entry['status'] !== SetlistService::STATUS_OK || $id === null || isset($seen[$id])) {
					continue;
				}
				$seen[$id] = true;
				$tokens[] = [
					'fileId' => $id,
					'token' => $this->companions->issue($uid, $id, CompanionTokenService::PURPOSE_SCORE, $digest),
				];
			}
			$this->logger->info('ScoreView: Begleit-Token ausgegeben', [
				'uid' => $uid,
				'fileId' => $fileId,
				'setlistId' => $setlistId,
				'count' => count($tokens),
			]);
			return new JSONResponse(['tokens' => $tokens, 'expiresAt' => $this->companions->expiresAt()]);
		});
	}

	/**
	 * S2: was mit einem Token NEU in eine Liste darf. `null` = ohne Grenze
	 * (Sitzung), `[]` = nichts Neues (Begleit-Token: nur umordnen und
	 * entfernen), sonst die Partituren rund um die Datei des
	 * Direct-Editing-Tokens.
	 *
	 * Hat die Middleware die Anfrage nicht eingeordnet, wird abgelehnt statt
	 * als Sitzung behandelt: Die Voreinstellung SESSION hiesse „ohne Grenze",
	 * und eine Anfrage mit Token, deren Einordnung verloren ging, bekaeme
	 * damit mehr als jede richtig eingeordnete.
	 *
	 * @return ?list<int>
	 * @throws SetlistException FORBIDDEN
	 */
	private function allowedForTokenWrite(): ?array {
		if (!$this->access->resolved()) {
			$this->logger->error('ScoreView: Setliste ohne eingeordneten Ausweis geschrieben - DirectAccessContext nicht geteilt?', [
				'token' => $this->request->getHeader(DirectAccessMiddleware::HEADER) !== '',
				'companion' => $this->request->getHeader(DirectAccessMiddleware::COMPANION_HEADER) !== '',
			]);
			throw new SetlistException(SetlistException::FORBIDDEN);
		}
		return match ($this->access->mode()) {
			DirectAccessContext::SESSION => null,
			DirectAccessContext::DIRECT => $this->candidateIdsOfOrigin(),
			default => [],
		};
	}

	/** @return list<int> */
	private function candidateIdsOfOrigin(): array {
		$origin = $this->access->originFileId();
		$score = $origin === null ? null : $this->fileResolver->resolveOwnNode($origin);
		if (!$score instanceof File) {
			return [];
		}
		return array_map(static fn (array $c) => $c['fileId'], $this->setlists->candidates($score));
	}

	/**
	 * @return array{0: ?string, 1: ?File}
	 */
	private function file(int $fileId): array {
		$uid = $this->fileResolver->currentUserId();
		$node = $uid === null ? null : $this->fileResolver->resolveOwnNode($fileId);
		return $node instanceof File ? [$uid, $node] : [$uid, null];
	}

	/**
	 * @return array{0: ?string, 1: ?File}
	 */
	private function setlist(int $fileId): array {
		[$uid, $file] = $this->file($fileId);
		return $file !== null && SetlistService::isSetlist($file) ? [$uid, $file] : [$uid, null];
	}

	/**
	 * @param callable(): JSONResponse $action
	 */
	private function run(callable $action): JSONResponse {
		try {
			return $action();
		} catch (SetlistException $e) {
			return $this->error($e->getReason());
		}
	}

	private function error(string $reason): JSONResponse {
		[$status, $message] = match ($reason) {
			SetlistException::NOT_FOUND => [Http::STATUS_NOT_FOUND, $this->l->t('File not found or no access.')],
			SetlistException::FORBIDDEN => [Http::STATUS_FORBIDDEN, $this->l->t('You are not allowed to change this setlist.')],
			SetlistException::CONFLICT => [Http::STATUS_CONFLICT, $this->l->t('The setlist was changed in the meantime. Please reload it and try again.')],
			SetlistException::EXISTS => [Http::STATUS_CONFLICT, $this->l->t('A setlist with this name already exists.')],
			SetlistException::TOO_LARGE => [Http::STATUS_REQUEST_ENTITY_TOO_LARGE, $this->l->t('The file is too large for a setlist.')],
			default => [Http::STATUS_BAD_REQUEST, $this->l->t('The setlist could not be saved.')],
		};
		return new JSONResponse(['error' => $message, 'reason' => $reason], $status);
	}
}
