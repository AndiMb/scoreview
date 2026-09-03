<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Db\ScoreConversion;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IAppConfig;

/**
 * Kann dieser Server ueberhaupt konvertieren - und wenn nicht, warum?
 *
 * Der Rueckfall auf die Konvertierung im Browser ist **kein dritter
 * Konvertierungsweg**: Er greift nur, wo der gewaehlte Weg nicht laufen kann,
 * und er ist nirgends waehlbar. Damit das so bleibt, faellt die Entscheidung
 * hier an genau EINER Stelle - so wie die Wahl zwischen Sidecar und lokalem
 * Weg allein in BackgroundJob\ConvertScoreJob faellt (docs/architecture.md E3).
 * Gefragt wird von drei Stellen: Controller\ConversionController (welchen
 * Status die Partitur bekommt), Listener\AddCspListener (ob die CSP gelockert
 * werden muss) und Listener\ScoreFileListener (ob ein Vorab-Job ueberhaupt
 * Sinn hat).
 *
 * **Warum ein gespeichertes Urteil und keine Pruefung je Anfrage.** Die
 * ehrliche Antwort kostet auf dem lokalen Weg einen Prozessstart
 * (`node --version`, siehe LocalConverter::describe) und auf dem Sidecar-Weg
 * eine HTTP-Anfrage. Beides je Statusabruf waere unbezahlbar - der Viewer
 * pollt im Sekundentakt. Das Urteil gilt deshalb {@see self::TTL_SECONDS}
 * lang; Einstellungsaenderungen und der Selbsttest verwerfen es sofort
 * ({@see forget()}), damit eine Reparatur nicht erst abgewartet werden muss.
 *
 * **Warum das Urteil auch aus Fehlern lernt.** Ein Sidecar gilt als
 * lauffaehig, solange nichts dagegen spricht - deshalb reicht die
 * Lebendpruefung. Faellt er zwischen zwei Pruefungen aus, meldet es der erste
 * gescheiterte Konvertierungslauf; {@see noteConversionError()} nimmt das auf.
 * Umgekehrt gilt: **Ein Inhaltsfehler ist kein Grund.** Wenn die Partitur
 * kaputt ist, scheitert der Browser mit derselben Engine genauso - nur 14 MB
 * spaeter. Deshalb loesen nur die beiden Infrastrukturcodes aus.
 */
class ClientFallback {
	/**
	 * Wie lange ein Urteil gilt. Fuenf Minuten sind der Handel zwischen "eine
	 * reparierte Instanz merkt es bald" und "der Statusendpunkt startet nicht
	 * dauernd Prozesse".
	 */
	private const TTL_SECONDS = 300;

	/**
	 * Der dritte Wert, den der Statusendpunkt neben pending/processing/ready/
	 * error kennt. Er steht bewusst NICHT in Db\ScoreConversion: Es gibt
	 * keinen Datensatz mit diesem Status - er wird nie gespeichert, weil auf
	 * diesem Weg nichts gespeichert wird.
	 */
	public const STATUS_CLIENT = 'client';

	/** Das Urteil selbst ist der Grund - `ok` heisst: Der Server kann. */
	public const CONFIG_VERDICT = 'client_fallback_verdict';
	public const CONFIG_VERDICT_AT = 'client_fallback_verdict_at';
	private const VERDICT_OK = 'ok';

	/**
	 * Fehlercodes, die "der Server KONNTE nicht" bedeuten - im Unterschied zu
	 * "diese Partitur ging nicht" (`conversion_failed`, `no_pages`,
	 * `too_large`).
	 */
	private const INFRASTRUKTURFEHLER = [
		ScoreConversion::ERROR_LOCAL_UNAVAILABLE,
		ScoreConversion::ERROR_SIDECAR_UNREACHABLE,
	];

	public function __construct(
		private IAppConfig $appConfig,
		private ConversionBackend $backend,
		private LocalConverter $localConverter,
		private SidecarClient $sidecarClient,
		private ITimeFactory $time,
	) {
	}

	/** Muss der Browser ran? */
	public function applies(): bool {
		return $this->reason() !== null;
	}

	/**
	 * Warum der Browser ran muss - einer der Fehlercodes aus
	 * Db\ScoreConversion, oder null, wenn der Server selbst konvertieren kann.
	 * Der Code geht so an den Viewer und wird erst dort uebersetzt (E4).
	 */
	public function reason(): ?string {
		$urteil = $this->urteil();
		return $urteil === self::VERDICT_OK ? null : $urteil;
	}

	/**
	 * Nimmt einen gescheiterten Konvertierungslauf zur Kenntnis. Nur
	 * Infrastrukturfehler aendern etwas - alles andere laesst das Urteil
	 * unberuehrt.
	 *
	 * @return bool ob dieser Fehler den Rueckfall ausloest
	 */
	public function noteConversionError(?string $errorCode): bool {
		if ($errorCode === null || !in_array($errorCode, self::INFRASTRUKTURFEHLER, true)) {
			return false;
		}
		$this->merke($errorCode);
		return true;
	}

	/**
	 * Verwirft das gespeicherte Urteil. Aufzurufen, wenn sich etwas geaendert
	 * haben KANN - nach dem Speichern der Admin-Einstellungen und nach einem
	 * Selbsttest. Ohne das haette ein Betreiber nach der Reparatur bis zu
	 * fuenf Minuten das alte Verhalten vor sich, ohne zu wissen, warum.
	 */
	public function forget(): void {
		$this->appConfig->deleteKey(Application::APP_ID, self::CONFIG_VERDICT);
		$this->appConfig->deleteKey(Application::APP_ID, self::CONFIG_VERDICT_AT);
	}

	private function urteil(): string {
		$gespeichert = $this->appConfig->getValueString(Application::APP_ID, self::CONFIG_VERDICT);
		$erhobenAm = $this->appConfig->getValueInt(Application::APP_ID, self::CONFIG_VERDICT_AT);
		if ($gespeichert !== '' && ($this->time->getTime() - $erhobenAm) < self::TTL_SECONDS) {
			return $gespeichert;
		}
		$neu = $this->pruefe();
		$this->merke($neu);
		return $neu;
	}

	/**
	 * Die teure, ehrliche Antwort. Beide Wege beantworten dieselbe Frage
	 * unterschiedlich teuer: Der lokale Weg fragt seine eigene Umgebung ab,
	 * der Sidecar muss dafuer angesprochen werden.
	 */
	private function pruefe(): string {
		if ($this->backend->isLocal()) {
			return $this->localConverter->describe()['available']
				? self::VERDICT_OK
				: ScoreConversion::ERROR_LOCAL_UNAVAILABLE;
		}
		// Die Lebendpruefung kostet nichts, wenn gar keine URL eingetragen ist
		// (SidecarClient::checkHealth) - der Fall "Sidecar gewaehlt, aber nie
		// konfiguriert" faellt damit ebenfalls hierher und nicht in einen
		// Konvertierungsfehler.
		return $this->sidecarClient->checkHealth()['reachable']
			? self::VERDICT_OK
			: ScoreConversion::ERROR_SIDECAR_UNREACHABLE;
	}

	private function merke(string $urteil): void {
		$this->appConfig->setValueString(Application::APP_ID, self::CONFIG_VERDICT, $urteil);
		$this->appConfig->setValueInt(Application::APP_ID, self::CONFIG_VERDICT_AT, $this->time->getTime());
	}
}
