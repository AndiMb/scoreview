<?php

declare(strict_types=1);

namespace OCA\ScoreView\BackgroundJob;

use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Service\ConversionBackend;
use OCA\ScoreView\Service\ConversionService;
use OCA\ScoreView\Service\ConverterException;
use OCA\ScoreView\Service\SidecarClient;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\BackgroundJob\IJobList;
use OCP\BackgroundJob\QueuedJob;
use Psr\Log\LoggerInterface;

/**
 * Pollt GENAU EINMAL den Sidecar-Job-Status und reiht sich bei Bedarf selbst
 * per IJobList::scheduleAfter() neu ein, statt innerhalb eines einzigen
 * Laufs bis zu 300s mit sleep() zu blockieren - das wuerde die gesamte
 * Job-Queue der Instanz blockieren. ConvertScoreJob reicht den Sidecar-Job
 * ein und legt diesen Job mit Deadline an; alles Weitere passiert hier, ein
 * Zyklus pro Aufruf.
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
			$this->fail($conversion, 'ScoreView: sidecar status request failed for fileId={fileId}: {message}', $e);
			return;
		}

		if ($result['status'] === 'ready') {
			$this->fetchAndStore($conversion, $result);
			return;
		}
		if ($result['status'] === 'error') {
			$this->conversionService->markError(
				$conversion,
				(string)($result['error'] ?? 'Unknown sidecar error'),
				SidecarClient::jobErrorCode($result['errorCode'] ?? null),
			);
			return;
		}

		// Noch pending/processing.
		if ($this->time->getTime() >= $deadline) {
			$this->conversionService->markError($conversion, 'Sidecar timeout: conversion did not finish in time.', ScoreConversion::ERROR_TIMEOUT);
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
			// Diesen Job gibt es nur auf dem Sidecar-Weg (siehe ConvertScoreJob),
			// die Herkunft steht hier also fest und wird nicht nachgeschlagen.
			$this->conversionService->markReady($conversion, $pageSvgs, $midi, $timingJson, $measuresJson, $metaJson, ConversionBackend::SIDECAR, null);
		} catch (\Throwable $e) {
			$this->fail($conversion, 'ScoreView: conversion failed for fileId={fileId}: {message}', $e);
		}
	}

	private function fail(ScoreConversion $conversion, string $logMessage, \Throwable $e): void {
		$this->logger->error($logMessage, [
			'fileId' => $conversion->getFileId(),
			'message' => $e->getMessage(),
			'exception' => $e,
		]);
		$this->conversionService->markError($conversion, $e->getMessage(), ConverterException::codeOf($e));
	}
}
