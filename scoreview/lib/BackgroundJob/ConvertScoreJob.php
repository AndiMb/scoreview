<?php

declare(strict_types=1);

namespace OCA\ScoreView\BackgroundJob;

use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Service\ConversionService;
use OCA\ScoreView\Service\SidecarClient;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\QueuedJob;
use OCP\Files\IRootFolder;
use OCP\Files\Node;
use Psr\Log\LoggerInterface;

/**
 * Läuft NICHT über <background-jobs> in info.xml (das wäre für periodische
 * Jobs ohne eigenes Argument gedacht), sondern wird pro Datei gezielt über
 * IJobList::add() eingereiht - siehe Listener\ScoreFileListener und
 * Controller\ConversionController.
 *
 * Blockiert bewusst innerhalb eines einzigen Jobdurchlaufs, bis der Sidecar
 * fertig ist (Sidecar hat selbst einen Timeout-Guard, Risiko 6) - für den
 * Prototyp einfacher als eine mehrstufige Requeue-Logik; siehe Risiko 4
 * (Background-Job-Latenz je nach Cron-Modus der Instanz).
 */
class ConvertScoreJob extends QueuedJob {
	// Polling-Obergrenze, unabhaengig vom Sidecar-eigenen Timeout - falls der
	// Sidecar selbst nicht erreichbar ist/haengt, soll der Job trotzdem
	// irgendwann in status=error muenden statt endlos zu pollen.
	private const MAX_POLL_SECONDS = 300;
	private const POLL_INTERVAL_SECONDS = 2;

	public function __construct(
		ITimeFactory $time,
		private IRootFolder $rootFolder,
		private ConversionService $conversionService,
		private SidecarClient $sidecarClient,
		private LoggerInterface $logger,
	) {
		parent::__construct($time);
	}

	/**
	 * @param array{userId: string, fileId: int} $argument
	 */
	protected function run($argument): void {
		$userId = $argument['userId'];
		$fileId = (int)$argument['fileId'];

		$node = $this->resolveNode($userId, $fileId);
		if ($node === null) {
			$this->logger->warning('ScoreView: Datei fileId={fileId} für userId={userId} nicht auffindbar, Job übersprungen.', [
				'fileId' => $fileId,
				'userId' => $userId,
			]);
			return;
		}

		$etag = $node->getEtag();
		$conversion = $this->conversionService->find($fileId, $etag);
		if ($conversion !== null && $conversion->getStatus() !== ScoreConversion::STATUS_ERROR) {
			// Bereits angestoßen oder fertig (z.B. NodeCreatedEvent UND
			// NodeWrittenEvent für denselben Upload, oder Status-Endpunkt hat
			// zwischenzeitlich schon selbst nachgelegt) - nicht doppelt tun.
			return;
		}
		if ($conversion === null) {
			$conversion = $this->conversionService->createPending($fileId, $etag);
		}

		$this->conversionService->markProcessing($conversion);

		try {
			$jobId = $this->sidecarClient->submitConversion($node->getContent(), $node->getName());
			$result = $this->pollUntilDone($jobId);

			if ($result['status'] === 'error') {
				$this->conversionService->markError($conversion, (string)($result['error'] ?? 'Unbekannter Sidecar-Fehler'));
				return;
			}

			$musicxml = $this->sidecarClient->fetchFile($result['files']['musicxml']);
			$audio = $this->sidecarClient->fetchFile($result['files']['audio']);
			$timingJson = $this->sidecarClient->fetchFile($result['files']['timingJson']);
			$this->conversionService->markReady($conversion, $musicxml, $audio, $timingJson);
		} catch (\Throwable $e) {
			$this->logger->error('ScoreView: Konvertierung fehlgeschlagen für fileId={fileId}: {message}', [
				'fileId' => $fileId,
				'message' => $e->getMessage(),
				'exception' => $e,
			]);
			$this->conversionService->markError($conversion, $e->getMessage());
		}
	}

	/**
	 * @return array{status: string, error?: string, files?: array{musicxml: string, audio: string, timingJson: string}}
	 */
	private function pollUntilDone(string $jobId): array {
		$elapsed = 0;
		while (true) {
			$result = $this->sidecarClient->pollStatus($jobId);
			if (in_array($result['status'], ['ready', 'error'], true)) {
				return $result;
			}
			if ($elapsed >= self::MAX_POLL_SECONDS) {
				return ['status' => 'error', 'error' => 'Sidecar-Timeout: Konvertierung nach ' . self::MAX_POLL_SECONDS . 's nicht abgeschlossen.'];
			}
			sleep(self::POLL_INTERVAL_SECONDS);
			$elapsed += self::POLL_INTERVAL_SECONDS;
		}
	}

	private function resolveNode(string $userId, int $fileId): ?Node {
		try {
			$userFolder = $this->rootFolder->getUserFolder($userId);
			$nodes = $userFolder->getById($fileId);
		} catch (\Throwable) {
			return null;
		}
		return $nodes[0] ?? null;
	}
}
