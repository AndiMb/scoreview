<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\AppInfo\Application;
use OCP\Files\IMimeTypeLoader;
use Psr\Log\LoggerInterface;
use Throwable;

/**
 * Traegt `application/x-musescore` selbst in die Instanz ein - ohne `occ` und
 * ohne Schreibzugriff auf `config/`.
 *
 * **Warum das noetig ist.** Nextcloud liest `mimetypemapping.json`
 * ausschliesslich aus `config/`, nie aus einer App
 * ([E6](architecture.md#e6-zwei-einstiege--mimetype-und-dateiendung)). Bis
 * hierher hing der Mimetype damit an zwei Handgriffen des Betreibers. Im
 * Browser faellt das nicht auf - dort springt die Dateiaktion auf der Endung
 * ein -, **in den mobilen Apps schon**: Deren Editorauswahl vergleicht allein
 * den Mimetype der Datei (`FileMenuFilter.filterEdit` ->
 * `EditorUtils.getAvailableEditor`, nachgesehen in nextcloud/android). Ohne
 * Registrierung fehlt dort der Eintrag „Bearbeiten" dauerhaft - und auf
 * verwaltetem Hosting liess er sich gar nicht herstellen, weil weder `occ`
 * noch `config/` erreichbar sind.
 *
 * **Was hier stattdessen passiert.** Dasselbe, was
 * `occ maintenance:mimetype:update-db` tut, nur aus der App heraus:
 *
 * - `IMimeTypeLoader::getId()` legt den Mimetype an, falls er fehlt.
 * - `IMimeTypeLoader::updateFilecache()` setzt ihn auf alle Zeilen des
 *   Filecache, deren Name auf `.mscz` endet - ein einziges UPDATE ueber alle
 *   Speicher hinweg, Gruppenordner und Freigaben eingeschlossen. Ein
 *   `occ files:scan` ist dafuer nicht noetig.
 *
 * Dasselbe Paar benutzt `BatPio/GuitarTabPlayer` fuer seine Guitar-Pro-Dateien;
 * es ist der eingefuehrte Weg, solange die Endung nicht in Nextclouds
 * `mimetypemapping.dist.json` steht.
 *
 * **Was hier bewusst NICHT passiert.** Die *Erkennung* neuer Uploads bleibt
 * unberuehrt: `IMimeTypeDetector` bietet dafuer nur Lesezugriff
 * (`getAllMappings()`), und die private `registerType()` wirkte ohnehin nur im
 * laufenden Request. Ein frisch hochgeladenes `.mscz` traegt deshalb weiterhin
 * zuerst `application/octet-stream`; nachgezogen wird es von
 * Listener\ScoreMimetypeListener. Auch das Dateisymbol bleibt aus - es haengt
 * an `mimetypealiases.json` und `occ maintenance:mimetype:update-js`, beides
 * ausserhalb der Reichweite einer App.
 */
class MimetypeRegistration {
	/** Die Endung, an der die Zeilen im Filecache erkannt werden - ohne Punkt. */
	public const EXTENSION = 'mscz';

	public function __construct(
		private IMimeTypeLoader $loader,
		private LoggerInterface $logger,
	) {
	}

	/**
	 * @return int|null Zahl der berichtigten Filecache-Zeilen - oder null,
	 *                  wenn es nicht geklappt hat.
	 *
	 * Nichts davon darf den Aufrufer scheitern lassen: Der eine ist ein
	 * Repair-Step waehrend `occ upgrade`, der andere ein Job hinter einem
	 * Upload. Ohne die Registrierung ist die App nicht kaputt, nur um den
	 * mobilen Einstieg aermer.
	 *
	 * Das `catch` faengt bewusst `Throwable` und nicht bloss `Exception`:
	 * `updateFilecache()` ist in `IMimeTypeLoader` erst seit Nextcloud 32
	 * zugesagt (die Implementierung `OC\Files\Type\Loader` hat sie schon in
	 * 31 - nachgesehen im Zweig stable31, `occ maintenance:mimetype:update-db`
	 * benutzt sie dort bereits). Sollte ein Server sie wider Erwarten nicht
	 * mitbringen, ist das ein `Error`, kein `Exception` - und der soll hier
	 * enden und nicht im Upload.
	 */
	public function apply(): ?int {
		try {
			$id = $this->loader->getId(Application::MSCZ_MIMETYPE);
			$rows = $this->loader->updateFilecache(self::EXTENSION, $id);
		} catch (Throwable $e) {
			$this->logger->warning('ScoreView: Mimetype konnte nicht registriert werden: {message}', [
				'message' => $e->getMessage(),
				'exception' => $e,
			]);
			return null;
		}

		if ($rows > 0) {
			$this->logger->info('ScoreView: {rows} Datei(en) auf {mimetype} berichtigt.', [
				'rows' => $rows,
				'mimetype' => Application::MSCZ_MIMETYPE,
			]);
		}

		return $rows;
	}
}
