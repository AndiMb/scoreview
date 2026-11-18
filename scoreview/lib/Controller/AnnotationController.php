<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Db\Annotation;
use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCA\ScoreView\Service\AnnotationException;
use OCA\ScoreView\Service\AnnotationService;
use OCA\ScoreView\Service\AnnotationValidator;
use OCA\ScoreView\Service\ConversionService;
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
use OCP\Constants;
use OCP\Files\Node;
use OCP\IL10N;
use OCP\IRequest;

/**
 * Notizen: privat, geteilt und fuer Stimmen (B2), dazu Stempel (B3). fileId wird wie in
 * ConversionController ausschliesslich ueber UserFileResolver aufgeloest
 * (Zugriffskontrolle ueber den Dateibaum), die eigentliche Annotation-Zeile
 * zusaetzlich ueber (id, fileId) in AnnotationService/-Mapper geprueft -
 * bei privaten Notizen gegen die userId (nur die Autorin), bei
 * geteilten gegen `PERMISSION_UPDATE` am aufgeloesten Node (siehe
 * canWriteShared() - wer die Datei bearbeiten darf, darf auch geteilte
 * Notizen dazu anlegen/aendern/loeschen, unabhaengig davon, wer sie
 * urspruenglich angelegt hat). Stimmnotizen (`parts`) haengen an der
 * Leitungsrolle (LeaderService::isLeader) statt am Schreibrecht - eine
 * Chorleitung muss die Partitur nicht bearbeiten duerfen, um ihrem Tenor
 * etwas zu sagen.
 */
class AnnotationController extends Controller {
	use JsonErrors;

	public function __construct(
		IRequest $request,
		private UserFileResolver $fileResolver,
		private AnnotationService $annotationService,
		private ConversionService $conversionService,
		private IL10N $l,
		private LeaderService $leaders,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	public function index(int $fileId): JSONResponse {
		$score = $this->fileResolver->resolveUserScore($fileId);
		if ($score === null) {
			return $this->notFound();
		}
		[$node, $userId] = $score;

		$currentMeasureCount = null;
		try {
			$currentMeasureCount = $this->conversionService->getMeasureCount($fileId, $node->getEtag());
		} catch (\Throwable) {
			// Konvertierung (noch) nicht fertig/verfuegbar - orphaned-Markierung
			// entfaellt dann einfach (null), die Notizen selbst bleiben trotzdem
			// abrufbar (Notizen ueberleben unabhaengig vom Cache-Status).
		}

		return new JSONResponse($this->annotationService->listForFile($fileId, $userId, $currentMeasureCount));
	}

	/**
	 * @param string $kind 'text' oder 'stamp'; Unbekanntes gilt als 'text'
	 * @param ?string $stamp Code aus Annotation::STAMPS, nur bei 'stamp'
	 * @param ?array $targetParts `[{id, name}]`, nur bei Sichtbarkeit 'parts'
	 */
	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	// Stempel setzt man in der Probe schnell hintereinander - 60 je Minute
	// lassen dem Raum und deckeln doch, was ein Skript in eine Partitur
	// schreiben kann, die bei jedem Oeffnen allen ausgeliefert wird. Beide
	// Grenzen, weil Anfragen mit Token fuer Nextclouds
	// RateLimitingMiddleware anonym sind (wie bei den Aufnahmen).
	#[UserRateLimit(limit: 60, period: 60)]
	#[AnonRateLimit(limit: 60, period: 60)]
	public function create(int $fileId, int $measureNumber, float $fraction, string $content = '', ?int $elid = null, ?string $anchorEtag = null, string $visibility = Annotation::VISIBILITY_PRIVATE, string $kind = Annotation::KIND_TEXT, ?string $stamp = null, ?array $targetParts = null, ?int $endMeasure = null): JSONResponse {
		$score = $this->fileResolver->resolveUserScore($fileId);
		if ($score === null) {
			return $this->notFound();
		}
		[$node, $userId] = $score;
		$kind = AnnotationValidator::kind($kind);
		try {
			AnnotationValidator::forCreate($kind, $measureNumber, $endMeasure, $content, $stamp, $anchorEtag);
		} catch (AnnotationException $e) {
			return $this->refused($e);
		}
		if ($kind !== Annotation::KIND_STAMP) {
			$stamp = null;
		}
		if ($kind === Annotation::KIND_LOOP) {
			// A loop is a range of whole measures: it has no point within a
			// measure and no note to hang on. Its name may be empty - the
			// range names it then.
			$fraction = 0.0;
			$elid = null;
			$anchorEtag = null;
		} else {
			$endMeasure = null;
		}
		if ($kind === Annotation::KIND_DRAWING) {
			// Anchored by measure and fraction alone, like a stamp: its
			// strokes are relative to that point (drawingLayout.js).
			$elid = null;
		}
		// Unbekannte Werte defensiv auf 'private' abbilden statt sie
		// ungeprueft in die Spalte zu schreiben - visibility steuert
		// Sichtbarkeit fuer ALLE mit Dateizugriff, ein Tippfehler im Client
		// darf hier nicht versehentlich "geteilt" bedeuten.
		$visibility = in_array($visibility, [Annotation::VISIBILITY_SHARED, Annotation::VISIBILITY_PARTS], true)
			? $visibility
			: Annotation::VISIBILITY_PRIVATE;
		if ($visibility === Annotation::VISIBILITY_SHARED && !$this->canWriteShared($node)) {
			return new JSONResponse(['error' => $this->l->t('You do not have permission to create shared notes for this file.')], Http::STATUS_FORBIDDEN);
		}
		// Die Rolle wird nur gefragt, wo sie etwas entscheidet - bei einer
		// privaten Notiz sieht ohnehin niemand sonst, von wem sie ist.
		$byLeader = $visibility !== Annotation::VISIBILITY_PRIVATE && $this->leaders->isLeader($node, $userId);
		$targetPartsJson = null;
		if ($visibility === Annotation::VISIBILITY_PARTS) {
			// Serverseitig geprueft, nicht nur im Client ausgeblendet (E9).
			if (!$byLeader) {
				return new JSONResponse(['error' => $this->l->t('Only leaders can address notes to voices.')], Http::STATUS_FORBIDDEN);
			}
			try {
				$targetPartsJson = AnnotationValidator::targetParts($targetParts);
			} catch (AnnotationException $e) {
				return $this->refused($e);
			}
		}

		// Anker in den Bereich zwingen, den die Anzeige voraussetzt: Takte
		// zaehlen ab 1, `fraction` ist der Anteil IM Takt (0.0-1.0, siehe
		// Migration\Version000100Date20260823130000). Der Viewer liefert das
		// ohnehin so (scoreLayout.js klemmt beim Ausrechnen), ein anderer
		// Aufrufer aber nicht - und ein Anker ausserhalb des Bereichs waere
		// keine sichtbare Notiz, sondern eine unauffindbare.
		//
		// Nach OBEN wird bewusst nicht begrenzt: eine Taktnummer jenseits der
		// Partitur ist ein regulaerer Zustand (ein Re-Upload kann Takte
		// entfernt haben) und wird als `orphaned` angezeigt statt verworfen -
		// siehe AnnotationService::serialize().
		$measureNumber = max(1, $measureNumber);
		$fraction = is_finite($fraction) ? min(1.0, max(0.0, $fraction)) : 0.0;

		try {
			$annotation = $this->annotationService->create($fileId, $userId, $measureNumber, $fraction, $elid, $anchorEtag, $content, $visibility, $kind, $stamp, $targetPartsJson, $byLeader, $endMeasure);
		} catch (AnnotationException $e) {
			return $this->refused($e);
		}
		return new JSONResponse($this->annotationService->serialize($annotation, $userId), Http::STATUS_CREATED);
	}

	/**
	 * @param ?array $targetParts neue Zielstimmen einer Stimmnotiz, null =
	 *                            unveraendert
	 */
	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	#[UserRateLimit(limit: 60, period: 60)]
	#[AnonRateLimit(limit: 60, period: 60)]
	public function update(int $fileId, int $id, string $content = '', ?array $targetParts = null): JSONResponse {
		$score = $this->fileResolver->resolveUserScore($fileId);
		if ($score === null) {
			return $this->notFound();
		}
		[$node, $userId] = $score;
		// The text is checked by the service: whether it may be empty depends
		// on the kind of the note (a stamp's may), which only the stored row
		// knows.
		try {
			$targetPartsJson = $targetParts === null ? null : AnnotationValidator::targetParts($targetParts);
			$annotation = $this->annotationService->updateContent($id, $fileId, $userId, $this->canWriteShared($node), $content, $this->leaders->isLeader($node, $userId), $targetPartsJson);
		} catch (AnnotationException $e) {
			return $this->refused($e);
		}
		if ($annotation === null) {
			return new JSONResponse(['error' => $this->l->t('Note not found or no access.')], Http::STATUS_NOT_FOUND);
		}
		return new JSONResponse($this->annotationService->serialize($annotation, $userId));
	}

	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	public function destroy(int $fileId, int $id): JSONResponse {
		$score = $this->fileResolver->resolveUserScore($fileId);
		if ($score === null) {
			return $this->notFound();
		}
		[$node, $userId] = $score;

		try {
			$deleted = $this->annotationService->delete($id, $fileId, $userId, $this->canWriteShared($node), $this->leaders->isLeader($node, $userId));
		} catch (AnnotationException $e) {
			return $this->refused($e);
		}
		if (!$deleted) {
			return new JSONResponse(['error' => $this->l->t('Note not found or no access.')], Http::STATUS_NOT_FOUND);
		}
		return new JSONResponse(['status' => 'ok']);
	}

	/**
	 * One answer per refusal (AnnotationException), so that create, update
	 * and delete word the same case the same way.
	 */
	private function refused(AnnotationException $e): JSONResponse {
		return match ($e->getReason()) {
			AnnotationException::FORBIDDEN => new JSONResponse(['error' => $this->l->t('You do not have permission to change this note.')], Http::STATUS_FORBIDDEN),
			AnnotationException::LIMIT => new JSONResponse([
				'error' => $this->l->t('You already have the maximum number of notes for this score. Delete some notes first.'),
				'reason' => 'limit',
			], Http::STATUS_CONFLICT),
			AnnotationException::EMPTY => new JSONResponse(['error' => $this->l->t('Note must not be empty.')], Http::STATUS_BAD_REQUEST),
			AnnotationException::TOO_LONG => new JSONResponse(['error' => $this->l->t('Note is too long.')], Http::STATUS_BAD_REQUEST),
			AnnotationException::INVALID_LOOP => new JSONResponse(['error' => $this->l->t('A loop needs an end measure at or after its start.')], Http::STATUS_BAD_REQUEST),
			AnnotationException::INVALID_DRAWING => new JSONResponse(['error' => $this->l->t('Invalid drawing.')], Http::STATUS_BAD_REQUEST),
			AnnotationException::UNKNOWN_STAMP => new JSONResponse(['error' => $this->l->t('Unknown stamp.')], Http::STATUS_BAD_REQUEST),
			AnnotationException::INVALID_ANCHOR => new JSONResponse(['error' => $this->l->t('Invalid note anchor.')], Http::STATUS_BAD_REQUEST),
			default => new JSONResponse(['error' => $this->l->t('Choose at least one voice.')], Http::STATUS_BAD_REQUEST),
		};
	}

	/**
	 * Ob die anfragende Nutzerin geteilte Notizen dieser Datei anlegen/
	 * aendern/loeschen darf - an den Dateirechten festgemacht, statt eine
	 * eigene Rechteverwaltung zu bauen. Der aufgeloeste Node spiegelt
	 * bereits die Rechte AUS SICHT der anfragenden Nutzerin wider
	 * (UserFileResolver liest ueber deren eigenen Dateibaum) - bei einer
	 * geteilten Datei ist das genau die vom Share gewaehrte Berechtigung.
	 *
	 * Nimmt den bereits aufgeloesten Node entgegen statt einer fileId: jede
	 * Aufloesung ist ein `getUserFolder()->getById()` samt
	 * Filesystem-Aufbau, und vorher lief das pro Schreibanfrage zweimal -
	 * einmal in requireOwnAccess(), einmal hier.
	 */
	private function canWriteShared(Node $node): bool {
		return ($node->getPermissions() & Constants::PERMISSION_UPDATE) !== 0;
	}
}
