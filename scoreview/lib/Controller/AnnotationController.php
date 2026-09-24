<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Db\Annotation;
use OCA\ScoreView\Middleware\Attribute\DirectTokenOrSession;
use OCA\ScoreView\Service\AnnotationService;
use OCA\ScoreView\Service\ConversionService;
use OCA\ScoreView\Service\LeaderService;
use OCA\ScoreView\Service\UserFileResolver;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
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

	/** Die Breite der Spalte - siehe validateAnchorEtag(). */
	private const MAX_ANCHOR_ETAG_LENGTH = 64;

	/**
	 * Grenzen fuer die Zielstimmen einer Stimmnotiz. Die Spalte ist TEXT und
	 * wird wie `content` bei jedem Oeffnen mit ausgeliefert; ohne Grenze
	 * truege eine einzelne Notiz beliebig viel. 64 Stimmen deckt jede
	 * Chor- und Orchesterpartitur; MuseScore vergibt Stimmen-IDs als kurze
	 * Zahlen, 64 Zeichen sind dafuer reichlich, 128 fuer einen Stimmnamen
	 * ebenfalls.
	 */
	private const MAX_TARGET_PARTS = 64;
	private const MAX_PART_ID_LENGTH = 64;
	private const MAX_PART_NAME_LENGTH = 128;

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

	/**
	 * @param string $kind 'text' oder 'stamp'; Unbekanntes gilt als 'text'
	 * @param ?string $stamp Code aus Annotation::STAMPS, nur bei 'stamp'
	 * @param ?array $targetParts `[{id, name}]`, nur bei Sichtbarkeit 'parts'
	 */
	#[NoAdminRequired]
	#[PublicPage]
	#[NoCSRFRequired]
	#[DirectTokenOrSession]
	public function create(int $fileId, int $measureNumber, float $fraction, string $content = '', ?int $elid = null, ?string $anchorEtag = null, string $visibility = Annotation::VISIBILITY_PRIVATE, string $kind = Annotation::KIND_TEXT, ?string $stamp = null, ?array $targetParts = null): JSONResponse {
		$node = $this->fileResolver->resolveOwnNode($fileId);
		$userId = $this->fileResolver->currentUserId();
		if ($node === null || $userId === null) {
			return new JSONResponse(['error' => $this->l->t('File not found or no access.')], Http::STATUS_NOT_FOUND);
		}
		// Ein unbekannter Typ wird zur Textnotiz - der engere Fall: Sie
		// braucht Text, ein Tippfehler endet also als 400 statt als Stempel
		// ohne Bild.
		$kind = $kind === Annotation::KIND_STAMP ? Annotation::KIND_STAMP : Annotation::KIND_TEXT;
		$fehler = ($kind === Annotation::KIND_STAMP ? $this->validateStamp($stamp, $content) : $this->validateContent($content))
			?? $this->validateAnchorEtag($anchorEtag);
		if ($fehler !== null) {
			return $fehler;
		}
		if ($kind === Annotation::KIND_TEXT) {
			$stamp = null;
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
			$targetPartsJson = $this->normalizeTargetParts($targetParts);
			if ($targetPartsJson === null) {
				return new JSONResponse(['error' => $this->l->t('Choose at least one voice.')], Http::STATUS_BAD_REQUEST);
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

		$annotation = $this->annotationService->create($fileId, $userId, $measureNumber, $fraction, $elid, $anchorEtag, $content, $visibility, $kind, $stamp, $targetPartsJson, $byLeader);
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
	public function update(int $fileId, int $id, string $content = '', ?array $targetParts = null): JSONResponse {
		$node = $this->fileResolver->resolveOwnNode($fileId);
		$userId = $this->fileResolver->currentUserId();
		if ($node === null || $userId === null) {
			return new JSONResponse(['error' => $this->l->t('File not found or no access.')], Http::STATUS_NOT_FOUND);
		}
		// Nur die Laenge hier: Ob der Text leer sein darf, haengt an der Art
		// der Notiz (ein Stempel darf), und die kennt erst der Service.
		$fehler = $this->validateContentLength($content);
		if ($fehler !== null) {
			return $fehler;
		}
		$targetPartsJson = null;
		if ($targetParts !== null) {
			$targetPartsJson = $this->normalizeTargetParts($targetParts);
			if ($targetPartsJson === null) {
				return new JSONResponse(['error' => $this->l->t('Choose at least one voice.')], Http::STATUS_BAD_REQUEST);
			}
		}

		try {
			$annotation = $this->annotationService->updateContent($id, $fileId, $userId, $this->canWriteShared($node), $content, $this->leaders->isLeader($node, $userId), $targetPartsJson);
		} catch (\InvalidArgumentException) {
			return new JSONResponse(['error' => $this->l->t('Note must not be empty.')], Http::STATUS_BAD_REQUEST);
		} catch (\RuntimeException) {
			return new JSONResponse(['error' => $this->l->t('You do not have permission to change this note.')], Http::STATUS_FORBIDDEN);
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
		$node = $this->fileResolver->resolveOwnNode($fileId);
		$userId = $this->fileResolver->currentUserId();
		if ($node === null || $userId === null) {
			return new JSONResponse(['error' => $this->l->t('File not found or no access.')], Http::STATUS_NOT_FOUND);
		}

		try {
			$deleted = $this->annotationService->delete($id, $fileId, $userId, $this->canWriteShared($node), $this->leaders->isLeader($node, $userId));
		} catch (\RuntimeException) {
			return new JSONResponse(['error' => $this->l->t('You do not have permission to change this note.')], Http::STATUS_FORBIDDEN);
		}
		if (!$deleted) {
			return new JSONResponse(['error' => $this->l->t('Note not found or no access.')], Http::STATUS_NOT_FOUND);
		}
		return new JSONResponse(['status' => 'ok']);
	}

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
		return $this->validateContentLength($content);
	}

	private function validateContentLength(string $content): ?JSONResponse {
		// mb_strlen, nicht strlen: gezaehlt werden Zeichen, sonst haette eine
		// Notiz mit Umlauten weniger Platz als eine ohne.
		if (mb_strlen($content) > self::MAX_CONTENT_LENGTH) {
			return new JSONResponse(['error' => $this->l->t('Note is too long.')], Http::STATUS_BAD_REQUEST);
		}
		return null;
	}

	/**
	 * Ein Stempel braucht einen Code aus der festen Liste; sein Text ist ein
	 * freiwilliger Zusatz und nur in der Laenge begrenzt.
	 *
	 * @return ?JSONResponse null, wenn der Stempel in Ordnung ist
	 */
	private function validateStamp(?string $stamp, string $content): ?JSONResponse {
		if ($stamp === null || !in_array($stamp, Annotation::STAMPS, true)) {
			return new JSONResponse(['error' => $this->l->t('Unknown stamp.')], Http::STATUS_BAD_REQUEST);
		}
		return $this->validateContentLength($content);
	}

	/**
	 * Die Zielstimmen als geprueftes JSON `[{id, name}]`.
	 *
	 * Jede Stimme kommt mit ID UND Namen: Ob MuseScores Stimmen-ID einen
	 * Re-Upload uebersteht, ist nicht belegt - der Client ordnet zuerst ueber
	 * die ID, dann ueber den Namen zu (lib/annotationFilter.js). Doppelte
	 * Eintraege fallen weg, damit die Grenze nicht mit Wiederholungen
	 * ausgeschoepft wird.
	 *
	 * @param mixed $targetParts
	 * @return ?string null, wenn keine gueltige Stimme uebrig bleibt oder die
	 *                 Liste die Grenzen sprengt
	 */
	private function normalizeTargetParts(mixed $targetParts): ?string {
		if (!is_array($targetParts) || count($targetParts) === 0 || count($targetParts) > self::MAX_TARGET_PARTS) {
			return null;
		}
		$result = [];
		$seen = [];
		foreach ($targetParts as $part) {
			if (!is_array($part)) {
				return null;
			}
			$id = $part['id'] ?? null;
			$name = $part['name'] ?? '';
			if (is_int($id)) {
				$id = (string)$id;
			}
			if (!is_string($id) || $id === '' || mb_strlen($id) > self::MAX_PART_ID_LENGTH
				|| !is_string($name) || mb_strlen($name) > self::MAX_PART_NAME_LENGTH) {
				return null;
			}
			if (isset($seen[$id])) {
				continue;
			}
			$seen[$id] = true;
			$result[] = ['id' => $id, 'name' => $name];
		}
		return json_encode($result, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
	}

	/**
	 * Prueft den Sekundaeranker. Die Spalte ist VARCHAR(64)
	 * (Migration\Version000100Date20260823130000); ohne diese Pruefung endete
	 * ein laengerer Wert unter MySQL/PostgreSQL im Strict-Mode als 500er - fuer
	 * eine Eingabe, die der Client vollstaendig bestimmt, und als einziges
	 * Feld dieses Endpunkts ohne Pruefung (Text, Sichtbarkeit, Taktnummer und
	 * Bruchteil haben laengst eine).
	 *
	 * Geprueft wird nur die LAENGE, nicht der Inhalt: Ein etag ist fuer diese
	 * App undurchsichtig, und ob er noch zu einer Konvertierung passt,
	 * entscheidet ohnehin erst die Anzeige (AnnotationService::serialize
	 * markiert eine nicht mehr aufloesbare Notiz als `orphaned`, statt sie zu
	 * verwerfen).
	 *
	 * @return ?JSONResponse null, wenn der Anker in Ordnung ist
	 */
	private function validateAnchorEtag(?string $anchorEtag): ?JSONResponse {
		if ($anchorEtag !== null && mb_strlen($anchorEtag) > self::MAX_ANCHOR_ETAG_LENGTH) {
			return new JSONResponse(['error' => $this->l->t('Invalid note anchor.')], Http::STATUS_BAD_REQUEST);
		}
		return null;
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

	private function currentMeasureCount(int $fileId, string $etag): ?int {
		$meta = json_decode($this->conversionService->getMetaJsonFile($fileId, $etag)->getContent(), true);
		return isset($meta['measures']) ? (int)$meta['measures'] : null;
	}
}
