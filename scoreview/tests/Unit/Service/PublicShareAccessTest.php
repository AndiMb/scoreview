<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Service;

use OCA\ScoreView\Service\FeatureConfig;
use OCA\ScoreView\Service\PublicShareAccess;
use OCA\ScoreView\Service\PublicShareException;
use OCA\ScoreView\Service\PublicShareGrant;
use OCP\Constants;
use OCP\Files\File;
use OCP\Files\Folder;
use OCP\ISession;
use OCP\Share\Exceptions\ShareNotFound;
use OCP\Share\IManager;
use OCP\Share\IShare;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;

/**
 * The single gate between a share token and a score: every check that
 * decides whether a visitor without an account may read a file.
 */
class PublicShareAccessTest extends TestCase {
	private const TOKEN = 'AbCdEfGhIjKlMnO';
	private const HASH = '3|$argon2id$v=19$m=65536,t=4,p=1$c2FsdA$aGFzaA';

	private bool $enabled = true;
	/** @var array<string, mixed> */
	private array $session = [];
	private FeatureConfig&MockObject $features;
	private IManager&MockObject $shareManager;
	private ISession&MockObject $sessionMock;

	protected function setUp(): void {
		$this->features = $this->createMock(FeatureConfig::class);
		$this->features->method('publicShareEnabled')->willReturnCallback(fn () => $this->enabled);
		$this->shareManager = $this->createMock(IManager::class);
		$this->sessionMock = $this->createMock(ISession::class);
		$this->sessionMock->method('get')->willReturnCallback(fn (string $key) => $this->session[$key] ?? null);
	}

	private function access(): PublicShareAccess {
		return new PublicShareAccess($this->features, $this->shareManager, $this->sessionMock);
	}

	private function share(
		int $type = IShare::TYPE_LINK,
		int $permissions = Constants::PERMISSION_READ,
		?string $password = null,
		mixed $node = null,
		bool $hideDownload = false,
	): IShare&MockObject {
		$share = $this->createMock(IShare::class);
		$share->method('getShareType')->willReturn($type);
		$share->method('getPermissions')->willReturn($permissions);
		$share->method('getPassword')->willReturn($password);
		$share->method('getShareOwner')->willReturn('anna');
		$share->method('getHideDownload')->willReturn($hideDownload);
		if ($node !== null) {
			$share->method('getNode')->willReturn($node);
		}
		$this->shareManager->method('getShareByToken')->with(self::TOKEN)->willReturn($share);
		return $share;
	}

	private function file(int $id, string $path = '/anna/files/Chor/stueck.mscz'): File&MockObject {
		$file = $this->createMock(File::class);
		$file->method('getId')->willReturn($id);
		$file->method('getPath')->willReturn($path);
		return $file;
	}

	/** A shared folder whose getRelativePath behaves like Nextcloud's PathHelper. */
	private function sharedFolder(string $path = '/anna/files/Chor'): Folder&MockObject {
		$folder = $this->createMock(Folder::class);
		$folder->method('getPath')->willReturn($path);
		$folder->method('getRelativePath')->willReturnCallback(fn (string $p) => match (true) {
			$p === $path => '/',
			str_starts_with($p, $path . '/') => substr($p, strlen($path)),
			default => null,
		});
		return $folder;
	}

	private function rejection(?int $fileId = null): PublicShareException {
		try {
			$this->access()->grant(self::TOKEN, $fileId);
		} catch (PublicShareException $e) {
			return $e;
		}
		self::fail('grant() should have thrown');
	}

	public function testDisabledSwitchRejects(): void {
		$this->enabled = false;
		// The switch is checked before the share is even looked up.
		$this->shareManager->expects(self::never())->method('getShareByToken');
		$e = $this->rejection();
		self::assertSame('public_disabled', $e->getErrorCode());
		self::assertSame(401, $e->getStatus());
	}

	public function testUnknownTokenRejects(): void {
		$this->shareManager->method('getShareByToken')->willThrowException(new ShareNotFound());
		$e = $this->rejection();
		self::assertSame('share_invalid', $e->getErrorCode());
		self::assertSame(401, $e->getStatus());
	}

	public function testUserShareTypeRejects(): void {
		$this->share(type: IShare::TYPE_USER);
		$e = $this->rejection();
		self::assertSame('share_invalid', $e->getErrorCode());
	}

	public function testEmailShareIsAccepted(): void {
		$this->share(type: IShare::TYPE_EMAIL);
		$grant = $this->access()->grant(self::TOKEN, null);
		self::assertNull($grant->node);
	}

	public function testFileDropRejects(): void {
		$this->share(permissions: Constants::PERMISSION_CREATE);
		$e = $this->rejection();
		self::assertSame('share_no_read', $e->getErrorCode());
		self::assertSame(403, $e->getStatus());
	}

	public function testPasswordWithoutSessionRejects(): void {
		$this->share(password: self::HASH);
		$e = $this->rejection();
		self::assertSame('share_auth', $e->getErrorCode());
		self::assertSame(401, $e->getStatus());
	}

	public function testPasswordViaFrontendKeyPasses(): void {
		$this->share(password: self::HASH);
		$this->session['public_link_authenticated_frontend'] = json_encode(['other' => 'x', self::TOKEN => self::HASH]);
		$grant = $this->access()->grant(self::TOKEN, null);
		self::assertSame('anna', $grant->ownerUid);
	}

	public function testPasswordViaFrontendKeyForOtherTokenRejects(): void {
		$this->share(password: self::HASH);
		$this->session['public_link_authenticated_frontend'] = json_encode(['other' => self::HASH]);
		self::assertSame('share_auth', $this->rejection()->getErrorCode());
	}

	public function testPasswordViaLegacyKeysPasses(): void {
		$this->share(password: self::HASH);
		$this->session['public_link_authenticated_token'] = self::TOKEN;
		$this->session['public_link_authenticated_password_hash'] = self::HASH;
		$grant = $this->access()->grant(self::TOKEN, null);
		self::assertSame('anna', $grant->ownerUid);
	}

	public function testPasswordViaLegacyKeysForOtherTokenRejects(): void {
		$this->share(password: self::HASH);
		$this->session['public_link_authenticated_token'] = 'someOtherToken';
		$this->session['public_link_authenticated_password_hash'] = self::HASH;
		self::assertSame('share_auth', $this->rejection()->getErrorCode());
	}

	public function testPasswordChangedRejects(): void {
		$this->share(password: self::HASH);
		$this->session['public_link_authenticated_frontend'] = json_encode([self::TOKEN => 'old-hash']);
		$this->session['public_link_authenticated_token'] = self::TOKEN;
		$this->session['public_link_authenticated_password_hash'] = 'old-hash';
		self::assertSame('share_auth', $this->rejection()->getErrorCode());
	}

	public function testBrokenFrontendSessionValueRejects(): void {
		$this->share(password: self::HASH);
		$this->session['public_link_authenticated_frontend'] = '{not json';
		self::assertSame('share_auth', $this->rejection()->getErrorCode());
	}

	public function testFileShareMatchingFileIdPasses(): void {
		$file = $this->file(42);
		$this->share(node: $file);
		$grant = $this->access()->grant(self::TOKEN, 42);
		self::assertSame($file, $grant->node);
	}

	public function testFileShareOtherFileIdRejects(): void {
		$this->share(node: $this->file(42));
		$e = $this->rejection(43);
		self::assertSame('not_found', $e->getErrorCode());
		self::assertSame(404, $e->getStatus());
	}

	public function testFolderShareFindsNestedFile(): void {
		$nested = $this->file(77, '/anna/files/Chor/Sopran/Advent/stueck.mscz');
		$folder = $this->sharedFolder();
		$folder->method('getId')->willReturn(10);
		// Two levels deep: Chor/Sopran/stueck.mscz - getFirstNodeById searches
		// the whole subtree, so depth must not matter.
		$folder->method('getFirstNodeById')->with(77)->willReturn($nested);
		$this->share(node: $folder);
		$grant = $this->access()->grant(self::TOKEN, 77);
		self::assertSame($nested, $grant->node);
		self::assertSame('anna', $grant->ownerUid);
	}

	public function testFolderShareSiblingWithSamePrefixRejects(): void {
		// What a stale path-by-id cache hit can return: a file in a sibling
		// folder whose name merely starts with the shared folder's name.
		$folder = $this->sharedFolder('/anna/files/Chor');
		$folder->method('getFirstNodeById')->with(78)
			->willReturn($this->file(78, '/anna/files/Chor-privat/x.mscz'));
		$this->share(node: $folder);
		self::assertSame('not_found', $this->rejection(78)->getErrorCode());
	}

	public function testFolderShareFolderIdRejects(): void {
		$sub = $this->createMock(Folder::class);
		$folder = $this->sharedFolder();
		$folder->method('getFirstNodeById')->with(11)->willReturn($sub);
		$this->share(node: $folder);
		self::assertSame('not_found', $this->rejection(11)->getErrorCode());
	}

	public function testFolderShareUnknownIdRejects(): void {
		$folder = $this->sharedFolder();
		$folder->method('getFirstNodeById')->willReturn(null);
		$this->share(node: $folder);
		self::assertSame('not_found', $this->rejection(99)->getErrorCode());
	}

	public function testHideDownloadIsCarried(): void {
		$this->share(hideDownload: true);
		$grant = $this->access()->grant(self::TOKEN, null);
		self::assertTrue($grant->hideDownload);
		self::assertSame(hash('sha256', self::TOKEN), $grant->tokenDigest);
		self::assertInstanceOf(PublicShareGrant::class, $grant);
	}

	public function testNoFileIdLeavesNodeEmpty(): void {
		$share = $this->share();
		$share->expects(self::never())->method('getNode');
		$grant = $this->access()->grant(self::TOKEN, null);
		self::assertNull($grant->node);
		self::assertFalse($grant->hideDownload);
	}
}
