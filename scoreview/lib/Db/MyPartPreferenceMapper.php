<?php

declare(strict_types=1);

namespace OCA\ScoreView\Db;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Service\ViewerPreferences;
use OCP\IDBConnection;

/**
 * Die „Meine Stimme"-Eintraege (`my_part.<fileId>`, Service\ViewerPreferences)
 * aus Sicht des Aufraeum-Jobs: welche Dateien welche haben, und alle
 * Eintraege einer Datei auf einmal loeschen.
 *
 * **Warum direkt auf `preferences` statt ueber IConfig.** Gelesen und
 * geschrieben wird der Wert weiterhin nur ueber IConfig (ViewerPreferences).
 * Fuer das Aufraeumen fehlt dort aber die Frage "welche Schluessel dieser App
 * gibt es ueberhaupt": IConfig kennt Schluessel nur je Nutzerin
 * (getUserKeys), getUsersForUserValue() sucht nach einem bekannten WERT, und
 * deleteAppFromAllUsers() loescht alle Einstellungen der App. IUserConfig mit
 * deleteKey() kaeme erst mit Nextcloud 32 und haelt die Schluesselfrage
 * ebenfalls nicht - die App unterstuetzt 31. Ein Eintrag je Nutzerin und je
 * geoeffneter Partitur waechst sonst ohne Ende.
 *
 * Nur zwei Abfragen, beide auf (appid, configkey) eingeschraenkt; beruehrt
 * wird ausschliesslich, was diese App selbst unter diesem Praefix schreibt.
 * Ein zwischengespeicherter Wert im Speicher eines anderen PHP-Prozesses
 * lebt hoechstens bis zum Ende von dessen Anfrage.
 */
class MyPartPreferenceMapper {
	private const TABLE = 'preferences';

	public function __construct(
		private IDBConnection $db,
	) {
	}

	/**
	 * @return int[] alle fileIds, zu denen irgendwer eine Stimme gewaehlt hat
	 */
	public function findAllFileIds(): array {
		$prefix = ViewerPreferences::KEY_MY_PART_PREFIX;
		$qb = $this->db->getQueryBuilder();
		$qb->selectDistinct('configkey')
			->from(self::TABLE)
			->where($qb->expr()->eq('appid', $qb->createNamedParameter(Application::APP_ID)))
			->andWhere($qb->expr()->like('configkey', $qb->createNamedParameter($this->db->escapeLikeParameter($prefix) . '%')));
		$result = $qb->executeQuery();
		$ids = [];
		while (($row = $result->fetch()) !== false) {
			$suffix = substr((string)$row['configkey'], strlen($prefix));
			// Nur reine Zahlen: Ein fremder Schluessel mit demselben Praefix
			// darf nicht als fileId 0 in die Pruefung geraten.
			if (ctype_digit($suffix)) {
				$ids[] = (int)$suffix;
			}
		}
		$result->closeCursor();
		return array_values(array_unique($ids));
	}

	/**
	 * @return int Zahl der geloeschten Eintraege (ueber alle Nutzerinnen)
	 */
	public function deleteByFileId(int $fileId): int {
		$qb = $this->db->getQueryBuilder();
		$qb->delete(self::TABLE)
			->where($qb->expr()->eq('appid', $qb->createNamedParameter(Application::APP_ID)))
			->andWhere($qb->expr()->eq('configkey', $qb->createNamedParameter(ViewerPreferences::KEY_MY_PART_PREFIX . $fileId)));
		return $qb->executeStatement();
	}
}
