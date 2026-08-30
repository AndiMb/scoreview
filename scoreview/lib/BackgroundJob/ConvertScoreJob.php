<?php

declare(strict_types=1);

namespace OCA\ScoreView\BackgroundJob;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Service\ConversionBackend;
use OCA\ScoreView\Service\ConversionService;
use OCA\ScoreView\Service\ConverterException;
use OCA\ScoreView\Service\LocalConverter;
use OCA\ScoreView\Service\SidecarClient;
use OCA\ScoreView\Service\SidecarException;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\IJobList;
use OCP\BackgroundJob\QueuedJob;
use OCP\Files\IRootFolder;
use OCP\Files\Node;
use OCP\IAppConfig;
use OCP\ITempManager;
use Psr\Log\LoggerInterface;

/**
 * Läuft NICHT über <background-jobs> in info.xml (das wäre für periodische
 * Jobs ohne eigenes Argument gedacht), sondern wird pro Datei gezielt über
 * IJobList::add() eingereiht - siehe Listener\ScoreFileListener und
 * Controller\ConversionController.
 *
 * Hier faellt die Entscheidung zwischen den beiden Konvertierungswegen
 * (Service\ConversionBackend, siehe docs/architecture.md E3) - und zwar nur
 * hier: alles danach ist wieder gemeinsam, weil beide Wege dieselben
 * Artefakte in denselben Cache legen.
 *
 * Auf dem Sidecar-Weg reicht dieser Job die Konvertierung nur ein und
 * übergibt das Pollen sofort an PollConversionJob (siehe dort) - er selbst
 * läuft in Millisekunden durch und blockiert die Job-Queue nicht (ein
 * blockierender sleep()-Poll-Loop hier wuerde bis zu 300s lang die gesamte
 * Job-Queue der Instanz belegen). Auf dem lokalen Weg gibt es nichts
 * einzureichen und nichts zu pollen; siehe convertLocally().
 */
class ConvertScoreJob extends QueuedJob {
	// Gesamt-Obergrenze für die Konvertierung inkl. aller Poll-Zyklen in
	// PollConversionJob, unabhängig vom Sidecar-eigenen Timeout - falls der
	// Sidecar selbst nicht erreichbar ist/hängt, soll die Konvertierung
	// trotzdem irgendwann in status=error münden statt endlos zu pollen.
	private const MAX_TOTAL_SECONDS = 300;

	/**
	 * Obergrenze fuer die Dateigroesse, ueberschreibbar ueber die
	 * App-Einstellung `max_score_bytes`.
	 *
	 * Ohne diese Grenze reicht die App jede Datei unveraendert weiter, egal
	 * wie gross. Der Stream-Upload (SidecarClient) macht das selbst kein
	 * Speicherproblem - aber eine absurd grosse Datei belegt weiterhin
	 * einen MuseScore-Prozess, bis der Timeout greift. 100 MB liegen
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
		private ConversionBackend $backend,
		private SidecarClient $sidecarClient,
		private LocalConverter $localConverter,
		private IJobList $jobList,
		private IAppConfig $appConfig,
		private ITempManager $tempManager,
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
			// "ready" allein reicht nicht aus: ein Datensatz kann
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

		if ($this->backend->isLocal()) {
			$this->convertLocally($conversion, $node);
			return;
		}

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
			$this->conversionService->markError($conversion, $e->getMessage(), $e instanceof ConverterException ? $e->getErrorCode() : ScoreConversion::ERROR_UNKNOWN);
			return;
		}

		$this->jobList->add(PollConversionJob::class, [
			'fileId' => $fileId,
			'etag' => $etag,
			'jobId' => $jobId,
			'deadline' => $this->time->getTime() + self::MAX_TOTAL_SECONDS,
		]);
	}

	/**
	 * Der lokale Weg laeuft vollstaendig in DIESEM Job - es gibt nichts zu
	 * pollen, also auch keinen PollConversionJob.
	 *
	 * Dass er dabei blockiert, ist vertretbar und anders als beim Sidecar:
	 * dort wartet die App auf einen fremden Dienst mit unbekannter
	 * Warteschlange (bis zu 300 s, siehe MAX_TOTAL_SECONDS), hier auf einen
	 * eigenen Kindprozess mit gemessenen 0,7-2,9 s und harter Zeitgrenze
	 * (Service\LocalConverter). Ein Poll-Umweg ueber die Job-Queue waere
	 * dafuer mehr Wartezeit als Arbeit.
	 */
	private function convertLocally(ScoreConversion $conversion, Node $node): void {
		$temporaryPath = null;
		try {
			$temporaryPath = $this->copyToTempFile($node);
			$artifacts = $this->localConverter->convert($temporaryPath);
			$this->conversionService->markReady(
				$conversion,
				$artifacts['pages'],
				$artifacts['midi'],
				$artifacts['timing'],
				$artifacts['measures'],
				$artifacts['meta'],
				ConversionBackend::LOCAL,
			);
		} catch (\Throwable $e) {
			$this->logger->error('ScoreView: lokale Konvertierung fehlgeschlagen für fileId={fileId}: {message}', [
				'fileId' => $conversion->getFileId(),
				'message' => $e->getMessage(),
				'exception' => $e,
			]);
			$this->conversionService->markError($conversion, $e->getMessage(), $e instanceof ConverterException ? $e->getErrorCode() : ScoreConversion::ERROR_UNKNOWN);
		} finally {
			if ($temporaryPath !== null) {
				@unlink($temporaryPath);
			}
		}
	}

	/**
	 * Der Konverter braucht einen echten Pfad im Dateisystem - die Partitur
	 * kann aber auf einem beliebigen Storage liegen (Objektspeicher, externer
	 * Mount), wo es keinen gibt. Kopiert wird als Stream, nicht ueber
	 * getContent(): der Inhalt soll nie als PHP-String im Speicher stehen.
	 *
	 * @throws \RuntimeException
	 */
	private function copyToTempFile(Node $node): string {
		$target = $this->tempManager->getTemporaryFile('.mscz');
		if ($target === false) {
			throw new \RuntimeException('Kein temporaerer Dateiname fuer die Partitur verfuegbar.');
		}
		$source = $node->fopen('rb');
		if ($source === false) {
			throw new \RuntimeException('Partitur konnte nicht zum Lesen geoeffnet werden.');
		}
		$sink = fopen($target, 'wb');
		if ($sink === false) {
			fclose($source);
			throw new \RuntimeException('Temporaere Datei konnte nicht geschrieben werden.');
		}
		try {
			stream_copy_to_stream($source, $sink);
		} finally {
			fclose($source);
			fclose($sink);
		}
		return $target;
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
