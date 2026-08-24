<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\AppInfo\Application;
use OCP\IAppConfig;
use OCP\IDBConnection;

/**
 * Betriebsdiagnose für die Admin-Seite. Beantwortet die drei
 * Fragen, deren Antwort bisher nur im Log oder gar nicht stand:
 * Ist der Sidecar erreichbar? Ist ein SoundFont da? **Läuft der
 * Nextcloud-Cron?**
 *
 * Der Cron-Punkt ist ausdrücklich Teil des Plans („Dessen Fehlen hat schon
 * Zeit gekostet und ist von außen nur als ‚bleibt auf pending stehen'
 * sichtbar") - ohne laufenden Cron werden Background-Jobs nie ausgeführt
 * und jede Konvertierung bleibt für immer auf `pending`, ohne dass
 * irgendwo ein Fehler erscheint.
 */
class HealthService {
	public function __construct(
		private SidecarClient $sidecarClient,
		private SoundFontService $soundFontService,
		private IAppConfig $appConfig,
		private IDBConnection $db,
	) {
	}

	/**
	 * @return array<string, mixed>
	 */
	public function collect(): array {
		return [
			'sidecar' => $this->sidecarStatus(),
			'soundFont' => $this->soundFontStatus(),
			'cron' => $this->cronStatus(),
			'conversions' => $this->conversionStats(),
		];
	}

	private function sidecarStatus(): array {
		$configured = $this->sidecarClient->isConfigured();
		$health = $this->sidecarClient->checkHealth();
		return [
			'configured' => $configured,
			'reachable' => $health['reachable'],
			'error' => $health['error'] ?? null,
			'url' => $this->appConfig->getValueString(Application::APP_ID, 'sidecar_url'),
		];
	}

	private function soundFontStatus(): array {
		// Zwei getrennte Fragen: liegt schon eine Kopie im IAppData-Cache
		// (dann funktioniert Wiedergabe auch bei gerade nicht erreichbarem
		// Sidecar), und was meldet der Sidecar? Ein Override per
		// `soundfont_url` sticht beides.
		$override = $this->appConfig->getValueString(Application::APP_ID, 'soundfont_url');
		$cachedVersion = $this->appConfig->getValueString(Application::APP_ID, 'soundfont_cache_version');
		$sidecarInfo = null;
		$error = null;
		try {
			$sidecarInfo = $this->sidecarClient->fetchSoundFontInfo();
		} catch (\Throwable $e) {
			$error = $e->getMessage();
		}
		return [
			'overrideUrl' => $override,
			'cached' => $cachedVersion !== '',
			'availableInSidecar' => $sidecarInfo['available'] ?? false,
			'name' => $sidecarInfo['name'] ?? null,
			'size' => $sidecarInfo['size'] ?? null,
			'error' => $error,
		];
	}

	/**
	 * Läuft der Nextcloud-Cron? Gemessen am `lastcron`-Zeitstempel, den
	 * Nextcloud selbst nach jedem Durchlauf schreibt - kein eigener
	 * Mechanismus, damit hier nichts behauptet wird, was nicht ohnehin
	 * schon Systemwahrheit ist. Schwelle bewusst großzügig (15 min): der
	 * Standard-Intervall ist 5 min, ein einzelner verpasster Lauf soll
	 * keinen Fehlalarm auslösen.
	 */
	private function cronStatus(): array {
		$last = $this->appConfig->getValueInt('core', 'lastcron');
		$mode = $this->appConfig->getValueString('core', 'backgroundjobs_mode', 'ajax');
		$ageSeconds = $last > 0 ? (time() - $last) : null;
		return [
			'mode' => $mode,
			'lastRun' => $last > 0 ? $last : null,
			'ageSeconds' => $ageSeconds,
			'healthy' => $ageSeconds !== null && $ageSeconds < 900,
		];
	}

	/**
	 * Wie viele Konvertierungen hängen? Ein hoher `pending`-Stand bei
	 * gleichzeitig totem Cron ist genau das Fehlerbild, das ohne diese
	 * Anzeige nur als "die App tut nichts" sichtbar wäre.
	 */
	private function conversionStats(): array {
		$counts = ['pending' => 0, 'processing' => 0, 'ready' => 0, 'error' => 0];
		try {
			$qb = $this->db->getQueryBuilder();
			$qb->select('status')
				->selectAlias($qb->createFunction('COUNT(*)'), 'cnt')
				->from('scoreview_conversions')
				->groupBy('status');
			$result = $qb->executeQuery();
			while ($row = $result->fetch()) {
				$counts[$row['status']] = (int)$row['cnt'];
			}
			$result->closeCursor();
		} catch (\Throwable) {
			// Tabelle fehlt (App gerade erst installiert) - dann sind alle
			// Zaehler schlicht 0, kein Grund die ganze Health-Seite zu kippen.
		}
		return $counts;
	}
}
