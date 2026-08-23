<?php

declare(strict_types=1);

namespace OCA\ScoreView\BackgroundJob;

use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Service\ConversionService;
use OCA\ScoreView\Service\SidecarClient;
use OCA\ScoreView\Service\SidecarException;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\IJobList;
use OCP\BackgroundJob\QueuedJob;
use Psr\Log\LoggerInterface;

/**
 * Pollt GENAU EINMAL den Sidecar-Job-Status und reiht sich bei Bedarf selbst
 * per IJobList::scheduleAfter() neu ein, statt (wie vorher in
 * ConvertScoreJob::pollUntilDone, Phase 3/6) innerhalb eines einzigen
 * Laufs bis zu 300s mit sleep() zu blockieren - das blockierte die gesamte
 * Job-Queue der Instanz (siehe PLAN.md Phase 7). ConvertScoreJob reicht den
 * Sidecar-Job ein und legt diesen Job mit Deadline an; alles Weitere
 * passiert hier, ein Zyklus pro Aufruf.
 */
class PollConversionJob extends QueuedJob {
	private const POLL_INTERVAL_SECONDS = 3;

	public function __construct(
		ITimeFactory $time,
		private ConversionService $conversionService,
		private SidecarClient $sidecarClient,
		private IJobList $jobList,
		private LoggerInterface $logger,
	) {
		parent::__construct($time);
	}

	/**
	 * @param array{fileId: int, etag: string, jobId: string, deadline: int} $argument
	 */
	protected function run($argument): void {
		$fileId = (int)$argument['fileId'];
		$etag = (string)$argument['etag'];
		$jobId = (string)$argument['jobId'];
		$deadline = (int)$argument['deadline'];

		$conversion = $this->conversionService->find($fileId, $etag);
		if ($conversion === null) {
			// Datei wurde in der Zwischenzeit erneut geschrieben (neuer
			// etag) oder der Datensatz existiert aus anderem Grund nicht
			// mehr - nichts mehr zu tun, dieser Poll-Strang ist obsolet.
			return;
		}

		try {
			$result = $this->sidecarClient->pollStatus($jobId);
		} catch (\Throwable $e) {
			$this->logger->error('ScoreView: Sidecar-Statusabfrage fehlgeschlagen für fileId={fileId}: {message}', [
				'fileId' => $fileId,
				'message' => $e->getMessage(),
				'exception' => $e,
			]);
			$this->conversionService->markError($conversion, $e->getMessage(), $e instanceof SidecarException ? $e->getErrorCode() : ScoreConversion::ERROR_UNKNOWN);
			return;
		}

		if ($result['status'] === 'ready') {
			$this->fetchAndStore($conversion, $result);
			return;
		}
		if ($result['status'] === 'error') {
			$message = (string)($result['error'] ?? 'Unbekannter Sidecar-Fehler');
			// Einzige textbasierte Codeerkennung hier (statt eines eigenen
			// Sidecar-Fehlerformats): sidecar/server.py wirft fuer eine
			// Partitur ohne Seiten exakt diese RuntimeException-Message (siehe
			// dort) - alles andere aus mscore4portable/der Konvertierung selbst
			// landet unter conversion_failed.
			$errorCode = str_contains($message, 'returned no SVG pages')
				? ScoreConversion::ERROR_NO_PAGES
				: ScoreConversion::ERROR_CONVERSION_FAILED;
			$this->conversionService->markError($conversion, $message, $errorCode);
			return;
		}

		// Noch pending/processing.
		if ($this->time->getTime() >= $deadline) {
			$this->conversionService->markError($conversion, 'Sidecar-Timeout: Konvertierung nicht rechtzeitig abgeschlossen.', ScoreConversion::ERROR_TIMEOUT);
			return;
		}
		$this->jobList->scheduleAfter(self::class, $this->time->getTime() + self::POLL_INTERVAL_SECONDS, $argument);
	}

	/**
	 * @param array{files: array{pages: string[], midi: string, timingJson: string, measuresJson: string, metaJson: string}} $result
	 */
	private function fetchAndStore(ScoreConversion $conversion, array $result): void {
		try {
			$files = $result['files'];
			$pageSvgs = array_map(fn (string $url) => $this->sidecarClient->fetchFile($url), $files['pages']);
			$midi = $this->sidecarClient->fetchFile($files['midi']);
			$timingJson = $this->sidecarClient->fetchFile($files['timingJson']);
			$measuresJson = $this->sidecarClient->fetchFile($files['measuresJson']);
			$metaJson = $this->sidecarClient->fetchFile($files['metaJson']);
			$this->conversionService->markReady($conversion, $pageSvgs, $midi, $timingJson, $measuresJson, $metaJson);
		} catch (\Throwable $e) {
			$this->logger->error('ScoreView: Konvertierung fehlgeschlagen für fileId={fileId}: {message}', [
				'fileId' => $conversion->getFileId(),
				'message' => $e->getMessage(),
				'exception' => $e,
			]);
			$this->conversionService->markError($conversion, $e->getMessage(), $e instanceof SidecarException ? $e->getErrorCode() : ScoreConversion::ERROR_UNKNOWN);
		}
	}
}
