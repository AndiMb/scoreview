<?php

declare(strict_types=1);

namespace OCA\ScoreView\BackgroundJob;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Service\ConversionService;
use OCA\ScoreView\Service\SidecarClient;
use OCA\ScoreView\Service\SidecarException;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\IJobList;
use OCP\BackgroundJob\QueuedJob;
use OCP\Files\IRootFolder;
use OCP\Files\Node;
use OCP\IAppConfig;
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

	/**
	 * Obergrenze fuer die Dateigroesse (Codereview-Befund A7), ueberschreibbar
	 * ueber die App-Einstellung `max_score_bytes`.
	 *
	 * Bis Phase 23 gab es gar keine: die App reichte jede Datei weiter, egal
	 * wie gross. Seit dem Umstieg auf einen Stream (SidecarClient) ist das
	 * kein Speicherproblem mehr - aber eine absurd grosse Datei belegt
	 * weiterhin einen MuseScore-Prozess, bis der Timeout greift. 100 MB liegen
	 * weit ueber jeder echten Partitur (die groesste gemessene .mscz im
	 * Testbestand ist unter 1 MB) und unter dem Upload-Limit des Sidecars
	 * (200 MB), damit die Ablehnung hier passiert - mit eigenem Fehlercode
	 * statt als undurchsichtiges 413 von dort.
	 */
	private const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

	public function __construct(
		ITimeFactory $time,
		private IRootFolder $rootFolder,
		private ConversionService $conversionService,
		private SidecarClient $sidecarClient,
		private IJobList $jobList,
		private IAppConfig $appConfig,
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
		if ($conversion !== null) {
			$alreadyInProgress = in_array($conversion->getStatus(), [ScoreConversion::STATUS_PENDING, ScoreConversion::STATUS_PROCESSING], true);
			// "ready" allein reicht nicht mehr aus (Phase 14): ein Datensatz kann
			// "ready" UND veraltet sein (aeltere format_version, siehe
			// ConversionController::status() -> retryConversion()) - der reicht
			// diesen Job gezielt fuer GENAU diesen Fall neu ein und braucht ihn
			// nicht uebersprungen.
			$alreadyReadyAndCurrent = $conversion->getStatus() === ScoreConversion::STATUS_READY && $this->conversionService->isCurrentFormat($conversion);
			if ($alreadyInProgress || $alreadyReadyAndCurrent) {
				// Bereits angestoßen oder fertig (z.B. NodeCreatedEvent UND
				// NodeWrittenEvent für denselben Upload, oder Status-Endpunkt hat
				// zwischenzeitlich schon selbst nachgelegt) - nicht doppelt tun.
				return;
			}
		}
		if ($conversion === null) {
			$conversion = $this->conversionService->createPending($fileId, $etag);
		}

		$maxBytes = $this->appConfig->getValueInt(Application::APP_ID, 'max_score_bytes', self::DEFAULT_MAX_BYTES);
		if ($maxBytes > 0 && $node->getSize() > $maxBytes) {
			$this->conversionService->markError(
				$conversion,
				sprintf('Datei ist mit %d Byte groesser als das Limit von %d Byte.', $node->getSize(), $maxBytes),
				ScoreConversion::ERROR_TOO_LARGE,
			);
			return;
		}

		$this->conversionService->markProcessing($conversion);

		try {
			// fopen() statt getContent(): der Inhalt geht als Stream an Guzzle,
			// nicht als PHP-String (siehe SidecarClient::submitConversion()).
			$stream = $node->fopen('rb');
			if ($stream === false) {
				throw new SidecarException('Partitur konnte nicht zum Lesen geoeffnet werden.');
			}
			$jobId = $this->sidecarClient->submitConversion($stream, $node->getName());
		} catch (\Throwable $e) {
			$this->logger->error('ScoreView: Einreichen beim Sidecar fehlgeschlagen für fileId={fileId}: {message}', [
				'fileId' => $fileId,
				'message' => $e->getMessage(),
				'exception' => $e,
			]);
			$this->conversionService->markError($conversion, $e->getMessage(), $e instanceof SidecarException ? $e->getErrorCode() : ScoreConversion::ERROR_UNKNOWN);
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
