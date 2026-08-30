<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Db\Annotation;
use OCA\ScoreView\Service\AnnotationService;
use OCA\ScoreView\Service\ConversionService;
use OCA\ScoreView\Service\UserFileResolver;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\JSONResponse;
use OCP\Constants;
use OCP\Files\Node;
use OCP\IL10N;
use OCP\IRequest;

/**
 * Notizen: privat und geteilt. fileId wird wie in
 * ConversionController ausschliesslich ueber UserFileResolver aufgeloest
 * (Zugriffskontrolle ueber den Dateibaum), die eigentliche Annotation-Zeile
 * zusaetzlich ueber (id, fileId) in AnnotationService/-Mapper geprueft -
 * bei privaten Notizen gegen die userId (Owner-only, wie bisher), bei
 * geteilten gegen `PERMISSION_UPDATE` am aufgeloesten Node (siehe
 * canWriteShared() - wer die Datei bearbeiten darf, darf auch geteilte
 * Notizen dazu anlegen/aendern/loeschen, unabhaengig davon, wer sie
 * urspruenglich angelegt hat).
 */
class AnnotationController extends Controller {
	/**
	 * Obergrenze fuer den Text einer Notiz. Die Spalte ist TEXT und haette
	 * selbst keine, aber `content` ist das einzige frei formulierte Feld der
	 * App: ohne Grenze traegt eine einzelne Notiz so viel, wie die
	 * Anfragegroesse der Instanz durchlaesst, und wird danach bei JEDEM
	 * Oeffnen der Partitur mit ausgeliefert (listForFile laedt alle Notizen
	 * einer Datei auf einmal). 10000 Zeichen sind weit jenseits einer
	 * Probennotiz und decken auch einen langen Absatz ab.
	 */
	private const MAX_CONTENT_LENGTH = 10000;

	public function __construct(
		IRequest $request,
		private UserFileResolver $fileResolver,
		private AnnotationService $annotationService,
		private ConversionService $conversionService,
		private IL10N $l,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	public function index(int $fileId): JSONResponse {
		$node = $this->fileResolver->resolveOwnNode($fileId);
		$userId = $this->fileResolver->currentUserId();
		if ($node === null || $userId === null) {
			return new JSONResponse(['error' => $this->l->t('File not found or no access.')], Http::STATUS_NOT_FOUND);
		}

		$currentMeasureCount = null;
		try {
			$currentMeasureCount = $this->currentMeasureCount($fileId, $node->getEtag());
		} catch (\Throwable) {
			// Konvertierung (noch) nicht fertig/verfuegbar - orphaned-Markierung
			// entfaellt dann einfach (null), die Notizen selbst bleiben trotzdem
			// abrufbar (Notizen ueberleben unabhaengig vom Cache-Status).
		}

		return new JSONResponse($this->annotationService->listForFile($fileId, $userId, $currentMeasureCount));
	}

	#[NoAdminRequired]
	public function create(int $fileId, int $measureNumber, float $fraction, string $content, ?int $elid = null, ?string $anchorEtag = null, string $visibility = Annotation::VISIBILITY_PRIVATE): JSONResponse {
		$node = $this->fileResolver->resolveOwnNode($fileId);
		$userId = $this->fileResolver->currentUserId();
		if ($node === null || $userId === null) {
			return new JSONResponse(['error' => $this->l->t('File not found or no access.')], Http::STATUS_NOT_FOUND);
		}
		$fehler = $this->validateContent($content);
		if ($fehler !== null) {
			return $fehler;
		}
		// Unbekannte Werte defensiv auf 'private' abbilden statt sie
		// ungeprueft in die Spalte zu schreiben - visibility steuert
		// Sichtbarkeit fuer ALLE mit Dateizugriff, ein Tippfehler im Client
		// darf hier nicht versehentlich "geteilt" bedeuten.
		$visibility = $visibility === Annotation::VISIBILITY_SHARED ? Annotation::VISIBILITY_SHARED : Annotation::VISIBILITY_PRIVATE;
		if ($visibility === Annotation::VISIBILITY_SHARED && !$this->canWriteShared($node)) {
			return new JSONResponse(['error' => $this->l->t('You do not have permission to create shared notes for this file.')], Http::STATUS_FORBIDDEN);
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

		$annotation = $this->annotationService->create($fileId, $userId, $measureNumber, $fraction, $elid, $anchorEtag, $content, $visibility);
		return new JSONResponse($this->annotationService->serialize($annotation, $userId), Http::STATUS_CREATED);
	}

	#[NoAdminRequired]
	public function update(int $fileId, int $id, string $content): JSONResponse {
		$node = $this->fileResolver->resolveOwnNode($fileId);
		$userId = $this->fileResolver->currentUserId();
		if ($node === null || $userId === null) {
			return new JSONResponse(['error' => $this->l->t('File not found or no access.')], Http::STATUS_NOT_FOUND);
		}
		$fehler = $this->validateContent($content);
		if ($fehler !== null) {
			return $fehler;
		}

		try {
			$annotation = $this->annotationService->updateContent($id, $fileId, $userId, $this->canWriteShared($node), $content);
		} catch (\RuntimeException) {
			return new JSONResponse(['error' => $this->l->t('You do not have permission to change this note.')], Http::STATUS_FORBIDDEN);
		}
		if ($annotation === null) {
			return new JSONResponse(['error' => $this->l->t('Note not found or no access.')], Http::STATUS_NOT_FOUND);
		}
		return new JSONResponse($this->annotationService->serialize($annotation, $userId));
	}

	#[NoAdminRequired]
	public function destroy(int $fileId, int $id): JSONResponse {
		$node = $this->fileResolver->resolveOwnNode($fileId);
		$userId = $this->fileResolver->currentUserId();
		if ($node === null || $userId === null) {
			return new JSONResponse(['error' => $this->l->t('File not found or no access.')], Http::STATUS_NOT_FOUND);
		}

		try {
			$deleted = $this->annotationService->delete($id, $fileId, $userId, $this->canWriteShared($node));
		} catch (\RuntimeException) {
			return new JSONResponse(['error' => $this->l->t('You do not have permission to change this note.')], Http::STATUS_FORBIDDEN);
		}
		if (!$deleted) {
			return new JSONResponse(['error' => $this->l->t('Note not found or no access.')], Http::STATUS_NOT_FOUND);
		}
		return new JSONResponse(['status' => 'ok']);
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
	/**
	 * Prueft den Text einer Notiz - leer und zu lang an EINER Stelle, weil
	 * create() und update() dieselbe Zusage geben muessen: was angelegt
	 * werden darf, darf auch hineingeaendert werden.
	 *
	 * @return ?JSONResponse null, wenn der Text in Ordnung ist
	 */
	private function validateContent(string $content): ?JSONResponse {
		if (trim($content) === '') {
			return new JSONResponse(['error' => $this->l->t('Note must not be empty.')], Http::STATUS_BAD_REQUEST);
		}
		// mb_strlen, nicht strlen: gezaehlt werden Zeichen, sonst haette eine
		// Notiz mit Umlauten weniger Platz als eine ohne.
		if (mb_strlen($content) > self::MAX_CONTENT_LENGTH) {
			return new JSONResponse(['error' => $this->l->t('Note is too long.')], Http::STATUS_BAD_REQUEST);
		}
		return null;
	}

	private function canWriteShared(Node $node): bool {
		return ($node->getPermissions() & Constants::PERMISSION_UPDATE) !== 0;
	}

	private function currentMeasureCount(int $fileId, string $etag): ?int {
		$meta = json_decode($this->conversionService->getMetaJsonFile($fileId, $etag)->getContent(), true);
		return isset($meta['measures']) ? (int)$meta['measures'] : null;
	}
}
