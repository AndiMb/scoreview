<?php

declare(strict_types=1);

namespace OCA\ScoreView\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\BackgroundJob\ConvertScoreJob;
use OCA\ScoreView\Db\ScoreConversion;
use OCA\ScoreView\Service\ConversionService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\DataDisplayResponse;
use OCP\AppFramework\Http\JSONResponse;
use OCP\BackgroundJob\IJobList;
use OCP\Files\IRootFolder;
use OCP\Files\Node;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUserSession;

/**
 * Nie eine rohe fileId ungeprueft vertrauen: jede Anfrage loest die Datei
 * ueber den Dateibaum des eingeloggten Nutzers auf (resolveOwnNode), nicht
 * per direktem DB-Lookup - Nextclouds Node-API liefert nur, worauf der
 * Nutzer tatsaechlich Zugriff hat.
 */
class ConversionController extends Controller {
	public function __construct(
		IRequest $request,
		private IRootFolder $rootFolder,
		private IUserSession $userSession,
		private ConversionService $conversionService,
		private IJobList $jobList,
		private IURLGenerator $urlGenerator,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function status(int $fileId): JSONResponse {
		$node = $this->resolveOwnNode($fileId);
		if ($node === null) {
			return new JSONResponse(['status' => 'error', 'error' => 'Datei nicht gefunden oder kein Zugriff.'], Http::STATUS_NOT_FOUND);
		}

		$etag = $node->getEtag();
		$conversion = $this->conversionService->find($fileId, $etag);
		if ($conversion === null) {
			// Lazy-Trigger: Datei existierte schon vor App-Aktivierung, oder
			// der Event-Listener ist aus irgendeinem Grund nicht gelaufen.
			// Bewusst KEIN eigenes createPending() hier: ConvertScoreJob::run()
			// legt die Zeile selbst an. Würde der Controller sie vorab anlegen,
			// fände der Job beim Start bereits eine (von ihm selbst noch gar
			// nicht bearbeitete) "pending"-Zeile vor und würde die Konvertierung
			// wegen seiner eigenen Idempotenz-Prüfung (status !== error =>
			// überspringen) fälschlich als "läuft schon" überspringen - die
			// Konvertierung würde für immer auf "pending" hängen bleiben.
			$this->jobList->add(ConvertScoreJob::class, [
				'userId' => $this->userSession->getUser()?->getUID(),
				'fileId' => $fileId,
			]);
			return new JSONResponse(['status' => ScoreConversion::STATUS_PENDING]);
		}

		$body = ['status' => $conversion->getStatus()];
		if ($conversion->getStatus() === ScoreConversion::STATUS_ERROR) {
			$body['error'] = $conversion->getErrorMessage();
		} elseif ($conversion->getStatus() === ScoreConversion::STATUS_READY) {
			$body['files'] = [
				'musicxml' => $this->urlGenerator->linkToRoute(Application::APP_ID . '.conversion.musicxml', ['fileId' => $fileId]),
				'audio' => $this->urlGenerator->linkToRoute(Application::APP_ID . '.conversion.audio', ['fileId' => $fileId]),
				'timingJson' => $this->urlGenerator->linkToRoute(Application::APP_ID . '.conversion.timing', ['fileId' => $fileId]),
			];
		}
		return new JSONResponse($body);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function musicxml(int $fileId): Http\Response {
		return $this->serveCachedFile($fileId, 'musicxml', 'application/vnd.recordare.musicxml+xml');
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function audio(int $fileId): Http\Response {
		return $this->serveCachedFile($fileId, 'audio', 'audio/mpeg');
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function timing(int $fileId): Http\Response {
		return $this->serveCachedFile($fileId, 'timing', 'application/json');
	}

	private function serveCachedFile(int $fileId, string $kind, string $mimeType): Http\Response {
		$node = $this->resolveOwnNode($fileId);
		if ($node === null) {
			return new JSONResponse(['error' => 'Datei nicht gefunden oder kein Zugriff.'], Http::STATUS_NOT_FOUND);
		}

		$etag = $node->getEtag();
		$conversion = $this->conversionService->find($fileId, $etag);
		if ($conversion === null || $conversion->getStatus() !== ScoreConversion::STATUS_READY) {
			return new JSONResponse(['error' => 'Konvertierung noch nicht fertig.'], Http::STATUS_NOT_FOUND);
		}

		$content = match ($kind) {
			'musicxml' => $this->conversionService->getMusicXml($fileId, $etag),
			'audio' => $this->conversionService->getAudio($fileId, $etag),
			'timing' => $this->conversionService->getTimingJson($fileId, $etag),
		};
		return new DataDisplayResponse($content, Http::STATUS_OK, ['Content-Type' => $mimeType]);
	}

	private function resolveOwnNode(int $fileId): ?Node {
		$user = $this->userSession->getUser();
		if ($user === null) {
			return null;
		}
		try {
			$userFolder = $this->rootFolder->getUserFolder($user->getUID());
			$nodes = $userFolder->getById($fileId);
		} catch (\Throwable) {
			return null;
		}
		return $nodes[0] ?? null;
	}
}
