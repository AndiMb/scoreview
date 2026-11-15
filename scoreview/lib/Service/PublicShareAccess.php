<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCP\Constants;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\Files\Node;
use OCP\Files\NotFoundException;
use OCP\ISession;
use OCP\Share\Exceptions\ShareNotFound;
use OCP\Share\IManager;
use OCP\Share\IShare;

/**
 * Resolves a public share token to a score inside that share - the one place
 * that decides whether a visitor without an account may read a file.
 *
 * Deliberately no checks of its own where Nextcloud already has them: the
 * share manager rejects expired shares, shares of disabled owners and
 * owners no longer allowed to create links (all as ShareNotFound), and the
 * password is never checked here - only whether Nextcloud's own link page
 * has unlocked it in this session. A second password check would be a
 * second place to get it wrong, and would bypass Nextcloud's brute-force
 * protection on the password form.
 */
class PublicShareAccess {
	/** NC >= 33: JSON object token => password hash, one entry per unlocked link. */
	private const SESSION_FRONTEND = 'public_link_authenticated_frontend';
	/** NC 31/32: the one most recently unlocked link. */
	private const SESSION_LEGACY_TOKEN = 'public_link_authenticated_token';
	private const SESSION_LEGACY_HASH = 'public_link_authenticated_password_hash';

	public function __construct(
		private FeatureConfig $features,
		private IManager $shareManager,
		private ISession $session,
	) {
	}

	/**
	 * @throws PublicShareException
	 */
	public function grant(string $token, ?int $fileId): PublicShareGrant {
		if (!$this->features->publicShareEnabled()) {
			throw new PublicShareException(PublicShareException::PUBLIC_DISABLED);
		}
		try {
			$share = $this->shareManager->getShareByToken($token);
		} catch (ShareNotFound) {
			throw new PublicShareException(PublicShareException::SHARE_INVALID);
		}
		// getShareByToken also finds federated, circle and room shares by
		// token; only the two kinds a stranger opens via /s/... count here.
		$type = $share->getShareType();
		if ($type !== IShare::TYPE_LINK && $type !== IShare::TYPE_EMAIL) {
			throw new PublicShareException(PublicShareException::SHARE_INVALID);
		}
		if (($share->getPermissions() & Constants::PERMISSION_READ) === 0) {
			throw new PublicShareException(PublicShareException::SHARE_NO_READ);
		}
		if (!$this->unlocked($token, $share->getPassword())) {
			throw new PublicShareException(PublicShareException::SHARE_AUTH);
		}

		return new PublicShareGrant(
			$share->getShareOwner(),
			$fileId === null ? null : $this->fileInShare($share, $fileId),
			$share->getHideDownload(),
			hash('sha256', $token),
		);
	}

	/**
	 * The session stores the password HASH at the moment of unlocking, so a
	 * changed password locks every earlier session out without us noticing
	 * the change - the same rule PublicShareController applies.
	 */
	private function unlocked(string $token, ?string $passwordHash): bool {
		if ($passwordHash === null || $passwordHash === '') {
			return true;
		}

		$frontend = $this->session->get(self::SESSION_FRONTEND);
		if (is_string($frontend)) {
			$allowed = json_decode($frontend, true);
			if (is_array($allowed) && is_string($allowed[$token] ?? null)
				&& hash_equals($passwordHash, $allowed[$token])) {
				return true;
			}
		}

		$legacyToken = $this->session->get(self::SESSION_LEGACY_TOKEN);
		$legacyHash = $this->session->get(self::SESSION_LEGACY_HASH);
		return is_string($legacyToken) && is_string($legacyHash)
			&& hash_equals($token, $legacyToken)
			&& hash_equals($passwordHash, $legacyHash);
	}

	/**
	 * Only through the share's own node, and checked again afterwards:
	 * Folder::getFirstNodeById first consults a per-user path-by-id cache and
	 * accepts a cached path on a bare string prefix (NC 34, Root::
	 * getFirstNodeByIdInPath), so a share of /anna/files/Chor could return
	 * /anna/files/Chor-privat/x.mscz to a logged-in visitor. getRelativePath
	 * respects the "/" boundary and returns null for anything outside.
	 */
	private function fileInShare(IShare $share, int $fileId): Node {
		try {
			$root = $share->getNode();
		} catch (NotFoundException) {
			// The shared file was deleted while the link still exists.
			throw new PublicShareException(PublicShareException::NOT_FOUND);
		}
		if ($root instanceof File) {
			if ($root->getId() !== $fileId) {
				throw new PublicShareException(PublicShareException::NOT_FOUND);
			}
			return $root;
		}
		if (!$root instanceof Folder) {
			throw new PublicShareException(PublicShareException::NOT_FOUND);
		}
		$node = $root->getFirstNodeById($fileId);
		if (!$node instanceof File || $root->getRelativePath($node->getPath()) === null) {
			throw new PublicShareException(PublicShareException::NOT_FOUND);
		}
		return $node;
	}
}
