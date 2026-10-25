<?php

declare(strict_types=1);

namespace OCA\ScoreView\BackgroundJob;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Db\ScoreVariant;
use OCA\ScoreView\Service\ConversionBackend;
use OCA\ScoreView\Service\ConversionService;
use OCA\ScoreView\Service\ConverterException;
use OCA\ScoreView\Service\LocalConverter;
use OCA\ScoreView\Service\SidecarBusyException;
use OCA\ScoreView\Service\SidecarClient;
use OCA\ScoreView\Service\SidecarException;
use OCA\ScoreView\Service\VariantService;
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
	public const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

	/**
	 * Wie oft eine Partitur beim ausgelasteten Sidecar (volle Warteschlange,
	 * Service\SidecarBusyException) erneut eingereicht wird, bevor sie mit
	 * ERROR_SIDECAR_BUSY endet. Bei den 30 s, die der Sidecar nennt, sind das
	 * mindestens zehn Minuten, mit dem Cron-Takt der Instanz eher mehr - genug,
	 * dass ein Stapel-Upload abgearbeitet ist; und eine Grenze, damit ein
	 * dauerhaft ueberlasteter Sidecar nicht endlos Jobs nachzieht.
	 */
	public const MAX_BUSY_RETRIES = 20;

	/**
	 * Grenzen fuer die Wartezeit bis zum Neuversuch. Unten, damit ein
	 * `Retry-After: 0` keine Schleife im Cron-Takt ergibt; oben weit unter
	 * ConversionService::STALE_AFTER_SECONDS, damit eine Warterunde nie fuer
	 * einen toten Lauf gehalten wird.
	 */
	private const MIN_BUSY_DELAY_SECONDS = 15;
	private const MAX_BUSY_DELAY_SECONDS = 300;

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
		private VariantService $variantService,
	) {
		parent::__construct($time);
	}

	/**
	 * A display variant (docs/architecture.md E19), engraved now, inside the
	 * request that asked for it - Controller\VariantController calls this
	 * on a row it has claimed. Here, and only here, as for the base: which
	 * path converts is decided in this class (E3).
	 *
	 * Synchronous on purpose. The base conversion waits for the next cron
	 * run, which is minutes with system cron and longer with AJAX cron; for
	 * a switch to "my part only" that is too long, and a run takes 3-4 s with
	 * a hard time limit. Both paths engrave with the engine - locally in a
	 * child process, on the sidecar in one call to it. A sidecar that
	 * converts with MuseScore itself engraves none - stock MuseScore lacks
	 * what a variant needs (ConversionBackend::supportsVariants()) - so the
	 * row ends with a code that says so.
	 *
	 * The outcome is written to the row; nothing is thrown.
	 */
	public function convertVariant(Node $node, ScoreVariant $variant): void {
		if (!$this->backend->supportsVariants()) {
			$this->variantService->markError($variant, 'The configured conversion path engraves no display variants.', ScoreVariant::ERROR_UNSUPPORTED);
			return;
		}
		$maxBytes = $this->appConfig->getValueInt(Application::APP_ID, 'max_score_bytes', self::DEFAULT_MAX_BYTES);
		if ($maxBytes > 0 && $node->getSize() > $maxBytes) {
			$this->variantService->markError($variant, sprintf('File is %d bytes, larger than the limit of %d bytes.', $node->getSize(), $maxBytes), ScoreConversion::ERROR_TOO_LARGE);
			return;
		}

		if (!$this->backend->isLocal()) {
			$this->convertVariantInSidecar($node, $variant);
			return;
		}

		$scorePath = null;
		$baseDir = null;
		try {
			$scorePath = $this->copyToTempFile($node);
			$baseDir = $this->tempManager->getTemporaryFolder('scoreview-base');
			if ($baseDir === false) {
				throw new \RuntimeException('No temporary directory available for the base artifacts.');
			}
			// The converter checks the variant against the base's timing and
			// measures. IAppData need not be a local directory (object
			// storage), so they go to a temporary one first.
			foreach (['timing' => 'timing.json', 'measures' => 'measures.json'] as $name => $file) {
				file_put_contents($baseDir . '/' . $file, $this->conversionService->readArtifact($variant->getFileId(), $variant->getEtag(), $name));
			}
			$artifacts = $this->localConverter->convertVariant($scorePath, $variant->getVariant(), $baseDir);
			$this->variantService->markReady(
				$variant,
				$artifacts['pages'],
				$artifacts['timing'],
				$artifacts['measures'],
				$artifacts['meta'],
				$this->localConverter->engineVersion(),
			);
		} catch (\Throwable $e) {
			$this->logger->error('ScoreView: variant {variant} failed for fileId={fileId}: {message}', [
				'variant' => $variant->getVariant(),
				'fileId' => $variant->getFileId(),
				'message' => $e->getMessage(),
				'exception' => $e,
			]);
			$this->variantService->markError($variant, $e->getMessage(), $e instanceof ConverterException ? $e->getErrorCode() : ScoreConversion::ERROR_UNKNOWN);
		} finally {
			if ($scorePath !== null) {
				@unlink($scorePath);
			}
			if (is_string($baseDir)) {
				@unlink($baseDir . '/timing.json');
				@unlink($baseDir . '/measures.json');
				@rmdir($baseDir);
			}
		}
	}

	/**
	 * The sidecar half of convertVariant(): the score goes as a stream, the
	 * base's timing and measures as strings - no temporary files here, the
	 * sidecar has its own working directory.
	 */
	private function convertVariantInSidecar(Node $node, ScoreVariant $variant): void {
		try {
			$timing = $this->conversionService->readArtifact($variant->getFileId(), $variant->getEtag(), 'timing');
			$measures = $this->conversionService->readArtifact($variant->getFileId(), $variant->getEtag(), 'measures');
			$stream = $node->fopen('rb');
			if ($stream === false) {
				throw new SidecarException('Score could not be opened for reading.');
			}
			try {
				$artifacts = $this->sidecarClient->convertVariant($stream, $node->getName(), $variant->getVariant(), $timing, $measures);
			} finally {
				if (is_resource($stream)) {
					fclose($stream);
				}
			}
			$this->variantService->markReady(
				$variant,
				$artifacts['pages'],
				$artifacts['timing'],
				$artifacts['measures'],
				$artifacts['meta'],
				$artifacts['engine'],
			);
		} catch (\Throwable $e) {
			$this->logger->error('ScoreView: variant {variant} failed in the sidecar for fileId={fileId}: {message}', [
				'variant' => $variant->getVariant(),
				'fileId' => $variant->getFileId(),
				'message' => $e->getMessage(),
				'exception' => $e,
			]);
			$this->variantService->markError($variant, $e->getMessage(), $e instanceof ConverterException ? $e->getErrorCode() : ScoreConversion::ERROR_UNKNOWN);
		}
	}

	/**
	 * `busyRetry` steht nur im Argument eines Neuversuchs nach ausgelastetem
	 * Sidecar (retryWhenBusy()).
	 *
	 * @param array{userId: string, fileId: int, busyRetry?: int} $argument
	 */
	protected function run($argument): void {
		$userId = $argument['userId'];
		$fileId = (int)$argument['fileId'];
		$busyRetry = (int)($argument['busyRetry'] ?? 0);

		$node = $this->resolveNode($userId, $fileId);
		if ($node === null) {
			$this->logger->warning('ScoreView: file fileId={fileId} for userId={userId} not found, job skipped.', [
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
			// Der eigene Neuversuch findet den Datensatz absichtlich auf
			// `pending` vor (markWaiting() unten) - der Guard gilt fuer ihn nur
			// umgekehrt: Steht der Datensatz NICHT mehr auf pending, hat ihn
			// inzwischen jemand anders uebernommen (Neu konvertieren, ein neuer
			// Upload, der Statusendpunkt nach stale), und dieser Versuch ist
			// hinfaellig.
			if ($busyRetry > 0) {
				if ($conversion->getStatus() !== ScoreConversion::STATUS_PENDING) {
					return;
				}
			} elseif ($alreadyInProgress || $alreadyReadyAndCurrent) {
				// Bereits angestoßen oder fertig (z.B. NodeCreatedEvent UND
				// NodeWrittenEvent für denselben Upload, oder Status-Endpunkt hat
				// zwischenzeitlich schon selbst nachgelegt) - nicht doppelt tun.
				return;
			}
		}
		if ($conversion === null) {
			if ($busyRetry > 0) {
				// Der Datensatz ist weg (Neu konvertieren, neue Fassung der
				// Datei mit anderem etag) - wer ihn verworfen hat, hat auch
				// einen eigenen Job eingereiht.
				return;
			}
			$conversion = $this->conversionService->createPending($fileId, $etag);
		}

		$maxBytes = $this->appConfig->getValueInt(Application::APP_ID, 'max_score_bytes', self::DEFAULT_MAX_BYTES);
		if ($maxBytes > 0 && $node->getSize() > $maxBytes) {
			$this->conversionService->markError(
				$conversion,
				sprintf('File is %d bytes, larger than the limit of %d bytes.', $node->getSize(), $maxBytes),
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
				throw new SidecarException('Score could not be opened for reading.');
			}
			$jobId = $this->sidecarClient->submitConversion($stream, $node->getName(), $this->backend->sidecarRenderer());
		} catch (SidecarBusyException $e) {
			$this->retryWhenBusy($conversion, $userId, $fileId, $busyRetry, $e);
			return;
		} catch (\Throwable $e) {
			$this->logger->error('ScoreView: submitting to the sidecar failed for fileId={fileId}: {message}', [
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
	 * Der Sidecar ist erreichbar, aber ausgelastet: Die Konvertierung bleibt
	 * offen und wird spaeter erneut eingereicht, statt als Fehler zu enden.
	 *
	 * Bewusst KEIN markError(): Jeder Fehlercode geht beim naechsten
	 * Statusabruf durch ClientFallback::noteConversionError(), und ein
	 * Infrastrukturcode schaltete fuer alle auf den Browser um - fuer einen
	 * Dienst, der nur gerade viel zu tun hat. So erfaehrt der Rueckfall
	 * davon gar nichts; der Viewer sieht `pending` und wartet.
	 *
	 * Der Datensatz geht zurueck auf `pending` (markWaiting setzt dabei
	 * updated_at neu): Jede Warterunde ist ein Lebenszeichen, isStale()
	 * greift erst, wenn die Kette abreisst. Erst nach MAX_BUSY_RETRIES endet
	 * es mit einem eigenen, ehrlichen Code, der weder die Partitur noch die
	 * Instanz beschuldigt.
	 */
	private function retryWhenBusy(ScoreConversion $conversion, string $userId, int $fileId, int $busyRetry, SidecarBusyException $e): void {
		if ($busyRetry >= self::MAX_BUSY_RETRIES) {
			$this->logger->warning('ScoreView: sidecar still busy after {retries} retries, giving up on fileId={fileId}.', [
				'retries' => $busyRetry,
				'fileId' => $fileId,
			]);
			$this->conversionService->markError($conversion, $e->getMessage(), ScoreConversion::ERROR_SIDECAR_BUSY);
			return;
		}
		$delay = max(self::MIN_BUSY_DELAY_SECONDS, min(self::MAX_BUSY_DELAY_SECONDS, $e->getRetryAfterSeconds()));
		$this->conversionService->markWaiting($conversion);
		$this->jobList->scheduleAfter(self::class, $this->time->getTime() + $delay, [
			'userId' => $userId,
			'fileId' => $fileId,
			'busyRetry' => $busyRetry + 1,
		]);
		$this->logger->info('ScoreView: sidecar busy, retrying fileId={fileId} in {delay} s (attempt {retry}).', [
			'fileId' => $fileId,
			'delay' => $delay,
			'retry' => $busyRetry + 1,
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
			$this->logger->error('ScoreView: local conversion failed for fileId={fileId}: {message}', [
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
			throw new \RuntimeException('No temporary file name available for the score.');
		}
		$source = $node->fopen('rb');
		if ($source === false) {
			throw new \RuntimeException('Score could not be opened for reading.');
		}
		$sink = fopen($target, 'wb');
		if ($sink === false) {
			fclose($source);
			throw new \RuntimeException('Temporary file could not be written.');
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
