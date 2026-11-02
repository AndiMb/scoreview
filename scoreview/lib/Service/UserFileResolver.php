<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\Middleware\DirectAccessContext;
use OCP\Files\IRootFolder;
use OCP\Files\Node;
use OCP\IUserSession;

/**
 * Löst eine fileId ausschließlich über den Dateibaum der eingeloggten
 * Nutzerin auf - nie ungeprüft vertrauen, Nextclouds Node-API liefert nur,
 * worauf die Nutzerin tatsächlich Zugriff hat. Gemeinsam genutzt von
 * ConversionController und AnnotationController statt dort zweimal
 * dieselbe Logik zu pflegen.
 */
class UserFileResolver {
	public function __construct(
		private IRootFolder $rootFolder,
		private IUserSession $userSession,
		private DirectAccessContext $directAccess,
	) {
	}

	public function resolveOwnNode(int $fileId): ?Node {
		$user = $this->userSession->getUser();
		if ($user === null) {
			return null;
		}
		$known = $this->directAccess->knownNode($user->getUID(), $fileId);
		if ($known !== null) {
			return $known;
		}
		try {
			return $this->rootFolder->getUserFolder($user->getUID())->getFirstNodeById($fileId);
		} catch (\Throwable) {
			return null;
		}
	}

	public function currentUserId(): ?string {
		return $this->userSession->getUser()?->getUID();
	}
}
