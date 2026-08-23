<?php

declare(strict_types=1);

namespace OCA\ScoreView\BackgroundJob;

use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Service\ConversionService;
use OCA\ScoreView\Service\SidecarClient;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\IJobList;
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
 * Reicht die Konvertierung beim Sidecar ein und übergibt das Pollen sofort
 * an PollConversionJob (siehe dort) - dieser Job selbst läuft in
 * Millisekunden durch und blockiert die Job-Queue nicht (Phase 7: der
 * vorherige blockierende sleep()-Poll-Loop hier belegte bis zu 300s lang
 * die gesamte Job-Queue der Instanz).
 */
class ConvertScoreJob extends QueuedJob {
	// Gesamt-Obergrenze für die Konvertierung inkl. aller Poll-Zyklen in
	// PollConversionJob, unabhängig vom Sidecar-eigenen Timeout - falls der
	// Sidecar selbst nicht erreichbar ist/hängt, soll die Konvertierung
	// trotzdem irgendwann in status=error münden statt endlos zu pollen.
	private const MAX_TOTAL_SECONDS = 300;

	public function __construct(
		ITimeFactory $time,
		private IRootFolder $rootFolder,
		private ConversionService $conversionService,
		private SidecarClient $sidecarClient,
		private IJobList $jobList,
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
		} catch (\Throwable $e) {
			$this->logger->error('ScoreView: Einreichen beim Sidecar fehlgeschlagen für fileId={fileId}: {message}', [
				'fileId' => $fileId,
				'message' => $e->getMessage(),
				'exception' => $e,
			]);
			$this->conversionService->markError($conversion, $e->getMessage());
			return;
		}

		$this->jobList->add(PollConversionJob::class, [
			'fileId' => $fileId,
			'etag' => $etag,
			'jobId' => $jobId,
			'deadline' => $this->time->getTime() + self::MAX_TOTAL_SECONDS,
		]);
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
