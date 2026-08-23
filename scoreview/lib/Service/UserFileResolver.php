<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCP\Files\IRootFolder;
use OCP\Files\Node;
use OCP\IUserSession;

/**
 * Löst eine fileId ausschließlich über den Dateibaum der eingeloggten
 * Nutzerin auf - nie ungeprüft vertrauen, Nextclouds Node-API liefert nur,
 * worauf die Nutzerin tatsächlich Zugriff hat. Gemeinsam genutzt von
 * ConversionController und AnnotationController (Phase 11) statt dort
 * zweimal dieselbe Logik zu pflegen.
 */
class UserFileResolver {
	public function __construct(
		private IRootFolder $rootFolder,
		private IUserSession $userSession,
	) {
	}

	public function resolveOwnNode(int $fileId): ?Node {
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

	public function currentUserId(): ?string {
		return $this->userSession->getUser()?->getUID();
	}
}
