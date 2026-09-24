<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCP\App\IAppManager;
use Psr\Container\ContainerInterface;
use Psr\Log\LoggerInterface;

/**
 * Der schnelle Weg fuer „Folgt mir" (E10): Ein Ereignis ueber die
 * App `notify_push`, auf das jedes Folgegeraet einmal den Zustand holt -
 * statt alle 800 ms zu fragen.
 *
 * **Optional, ohne harte Abhaengigkeit.** ScoreView geht in den
 * App Store und darf nicht an einer zweiten App haengen. Deshalb:
 *
 * - kein `use OCA\NotifyPush\...` - die Schnittstelle steht nur als
 *   Zeichenkette hier, sonst liefe schon das Laden dieser Klasse auf einer
 *   Instanz ohne notify_push in einen Autoload-Fehler;
 * - aufgeloest wird erst, wenn die App fuer die Person aktiv ist, und jeder
 *   Fehler beim Aufloesen heisst schlicht „kein Push". Die Geraete fragen dann
 *   ab, wie sie es ohne Push ohnehin tun.
 *
 * Die Form des Aufrufs ist an notify_push geprueft (dessen `DEVELOPING.md`):
 * `push('notify_custom', ['user', 'message', 'body'])`, der Body seit 0.1.x.
 */
class PushNotifier {
	/** Die Warteschlange von notify_push - bewusst nur als Name, siehe oben. */
	public const QUEUE_INTERFACE = 'OCA\\NotifyPush\\Queue\\IQueue';
	/** Der Name, auf den der Viewer mit `listen()` hoert. */
	public const EVENT = 'scoreview_follow';

	public function __construct(
		private IAppManager $appManager,
		private ContainerInterface $container,
		private LoggerInterface $logger,
	) {
	}

	/**
	 * Ob Push gerade zur Verfuegung steht - fuer die Betriebsdiagnose und fuer
	 * die Antwort auf `join`.
	 */
	public function isAvailable(): bool {
		return $this->queue() !== null;
	}

	/**
	 * @param list<string> $userIds wer das Ereignis bekommt
	 * @return int an wie viele Personen es ging - 0 ohne Push
	 */
	public function notify(array $userIds, int $fileId, string $version): int {
		if ($userIds === []) {
			return 0;
		}
		$queue = $this->queue();
		if ($queue === null) {
			return 0;
		}
		$sent = 0;
		foreach ($userIds as $uid) {
			try {
				$queue->push('notify_custom', [
					'user' => $uid,
					'message' => self::EVENT,
					'body' => ['fileId' => $fileId, 'version' => $version],
				]);
				$sent++;
			} catch (\Throwable $e) {
				// Ein verlorenes Ereignis kostet nur Latenz: Das Geraet fragt
				// ohnehin in groesserem Abstand nach (useFollowSession). Die
				// Aktion der Leitung darf daran nicht scheitern.
				$this->logger->info('ScoreView: Push an {uid} fehlgeschlagen: {message}', [
					'uid' => $uid,
					'message' => $e->getMessage(),
				]);
			}
		}
		return $sent;
	}

	private function queue(): ?object {
		try {
			if (!$this->appManager->isEnabledForUser('notify_push')) {
				return null;
			}
			$queue = $this->container->get(self::QUEUE_INTERFACE);
		} catch (\Throwable) {
			// Nicht installiert, nicht geladen, eine inkompatible Fassung -
			// fuer „Folgt mir" ist das alles dasselbe: abfragen statt Push.
			return null;
		}
		return is_object($queue) && method_exists($queue, 'push') ? $queue : null;
	}
}
