<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Db\ScoreConversion;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IAppConfig;
use OCP\ICache;
use OCP\ICacheFactory;
use OCP\IMemcache;

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
 *
 * **Where the verdict is kept.** In the distributed cache where the instance
 * has one: every write to IAppConfig invalidates that config's cache for all
 * processes of the instance, and this verdict is rewritten every five
 * minutes. Without a distributed cache IAppConfig is the only store all PHP
 * processes share, so it stays the fallback there.
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

	/**
	 * What a visitor gets instead of `client` where "hide download" closes
	 * the source the browser would have to set (see sourceOpenTo()).
	 */
	public const SOURCE_HIDDEN = 'client_source_hidden';

	/** Das Urteil selbst ist der Grund - `ok` heisst: Der Server kann. */
	public const CONFIG_VERDICT = 'client_fallback_verdict';
	public const CONFIG_VERDICT_AT = 'client_fallback_verdict_at';
	private const VERDICT_OK = 'ok';
	private const CACHE_PREFIX = 'scoreview-client-fallback';
	private const CACHE_KEY = 'verdict';

	/**
	 * The lock for renewing an expired verdict, see urteil(). Held at most
	 * this long: longer than the slowest check (the sidecar's health request
	 * gives up after 5 s, `node --version` is quicker), short enough that a
	 * process dying mid-check does not keep the old verdict much longer.
	 */
	private const REFRESH_KEY = 'refresh';
	private const REFRESH_LOCK_SECONDS = 30;

	/**
	 * How long the cache keeps a verdict - longer than it counts as fresh, so
	 * that an expired one is still there to answer with while a single
	 * process renews it.
	 */
	private const CACHE_KEEP_SECONDS = 4 * self::TTL_SECONDS;

	/** Null where the instance has no distributed cache. */
	private ?ICache $cache;

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
		ICacheFactory $cacheFactory,
	) {
		$this->cache = $cacheFactory->isAvailable() ? $cacheFactory->createDistributed(self::CACHE_PREFIX) : null;
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
	 * Whether the browser may take over for this request, should the server
	 * be unable to: it sets the score from its source file (E7), and a
	 * public link with "hide download" keeps that file closed
	 * (conversion#source answers 403). Saying so here, where the fallback is
	 * decided, rather than in the viewer: otherwise the visitor would get
	 * `client`, fail on the source and see a transport error - and the
	 * viewer would need a branch for the kind of page it runs on.
	 *
	 * Static because it asks nothing of the stored verdict: it is a rule
	 * about the request, the same for the status answer and the page's CSP
	 * (Controller\PageController::publicViewer, no blob workers then).
	 *
	 * @param ?PublicShareGrant $grant the visitor's link, null for a member
	 */
	public static function sourceOpenTo(?PublicShareGrant $grant): bool {
		return $grant === null || !$grant->hideDownload;
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
		$this->cache?->remove(self::CACHE_KEY);
		// Also with a cache: a verdict kept in IAppConfig before the instance
		// got one would otherwise be read again should the cache go away.
		$this->appConfig->deleteKey(Application::APP_ID, self::CONFIG_VERDICT);
		$this->appConfig->deleteKey(Application::APP_ID, self::CONFIG_VERDICT_AT);
	}

	/**
	 * When the verdict expires, every viewer polling at that moment would
	 * start its own check - a process or an HTTP request each, all at once.
	 * So only the process that wins the refresh lock checks; the others go on
	 * with the expired verdict for the few seconds that takes. Without any
	 * stored verdict (the first request, or after forget()) there is nothing
	 * to go on with, and checking is the only answer.
	 */
	private function urteil(): string {
		[$gespeichert, $erhobenAm] = $this->lies();
		if ($gespeichert !== '' && ($this->time->getTime() - $erhobenAm) < self::TTL_SECONDS) {
			return $gespeichert;
		}
		if ($gespeichert !== '' && !$this->claimRefresh()) {
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

	/**
	 * Whether this process renews the verdict. Only a memcache can hand out
	 * the lock atomically (add() succeeds once); a plain ICache, or none at
	 * all, cannot - then every process checks, as it always did. With
	 * IAppConfig as the only store a lock there would cost the same
	 * instance-wide invalidation the cache spares (see the class comment).
	 */
	private function claimRefresh(): bool {
		if (!$this->cache instanceof IMemcache) {
			return true;
		}
		return (bool)$this->cache->add(self::REFRESH_KEY, 1, self::REFRESH_LOCK_SECONDS);
	}

	/** @return array{0: string, 1: int} verdict ('' for none) and when it was reached */
	private function lies(): array {
		if ($this->cache !== null) {
			$entry = $this->cache->get(self::CACHE_KEY);
			return is_array($entry) && is_string($entry[0] ?? null) && is_int($entry[1] ?? null) ? [$entry[0], $entry[1]] : ['', 0];
		}
		return [
			$this->appConfig->getValueString(Application::APP_ID, self::CONFIG_VERDICT),
			$this->appConfig->getValueInt(Application::APP_ID, self::CONFIG_VERDICT_AT),
		];
	}

	private function merke(string $urteil): void {
		if ($this->cache !== null) {
			// The age check in urteil() decides; the cache's own TTL only
			// keeps a forgotten entry from staying for ever. Longer than the
			// age check, so an expired verdict is still there to answer with
			// while one process renews it.
			$this->cache->set(self::CACHE_KEY, [$urteil, $this->time->getTime()], self::CACHE_KEEP_SECONDS);
			return;
		}
		$this->appConfig->setValueString(Application::APP_ID, self::CONFIG_VERDICT, $urteil);
		$this->appConfig->setValueInt(Application::APP_ID, self::CONFIG_VERDICT_AT, $this->time->getTime());
	}
}
