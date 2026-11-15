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
		// A share token wins over a session (DirectAccessMiddleware): the
		// file comes from the share, already checked against it, and only
		// that one - a visitor has no tree to look anything else up in.
		$grant = $this->directAccess->shareGrant();
		if ($grant !== null) {
			try {
				return $grant->node !== null && $grant->node->getId() === $fileId ? $grant->node : null;
			} catch (\Throwable) {
				return null;
			}
		}

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

	/**
	 * The logged-in user - null for a share visitor, who has no account.
	 * Everything that is stored per user keys on this, so a visitor never
	 * writes into the owner's notes or preferences.
	 */
	public function currentUserId(): ?string {
		return $this->userSession->getUser()?->getUID();
	}

	/**
	 * Whom a queued conversion is accounted to: on a share link the share
	 * owner, in whose tree ConvertScoreJob finds the file again - also for
	 * a logged-in member on someone else's link, since resolveOwnNode()
	 * gave her the owner's file. Otherwise the logged-in user. An
	 * attribution, not a login: nothing is set in the session.
	 */
	public function attributionUserId(): ?string {
		return $this->directAccess->shareGrant()?->ownerUid ?? $this->currentUserId();
	}
}
