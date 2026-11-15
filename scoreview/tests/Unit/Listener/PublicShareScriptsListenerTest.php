<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Listener;

require_once __DIR__ . '/../../stubs/FilesSharingEvent.php';

use OCA\Files_Sharing\Event\BeforeTemplateRenderedEvent;
use OCA\ScoreView\Listener\PublicShareScriptsListener;
use OCA\ScoreView\Service\FeatureConfig;
use OCP\Constants;
use OCP\EventDispatcher\Event;
use OCP\Share\IShare;
use OCP\Util;
use PHPUnit\Framework\TestCase;

/**
 * The public link page gets the framing handler only for a readable share and
 * only with the admin switch on - everything else must leave the page alone.
 */
class PublicShareScriptsListenerTest extends TestCase {
	private const SCRIPT = 'scoreview/js/scoreview-public';

	protected function setUp(): void {
		// Util keeps the page's script list in static state.
		foreach (['scripts', 'scriptDeps'] as $name) {
			$property = new \ReflectionProperty(Util::class, $name);
			$property->setValue(null, []);
		}
	}

	private function lauf(bool $switchOn, int $permissions, ?string $scope = null, ?Event $event = null): bool {
		$features = $this->createMock(FeatureConfig::class);
		$features->method('publicShareEnabled')->willReturn($switchOn);
		$share = $this->createMock(IShare::class);
		$share->method('getPermissions')->willReturn($permissions);

		(new PublicShareScriptsListener($features))->handle($event ?? new BeforeTemplateRenderedEvent($share, $scope));
		return in_array(self::SCRIPT, Util::getScripts(), true);
	}

	public function testNoScriptWhenSwitchOff(): void {
		$this->assertFalse($this->lauf(false, Constants::PERMISSION_READ));
	}

	public function testNoScriptForFileDrop(): void {
		// Create without read: files_sharing renders its upload-only view.
		$this->assertFalse($this->lauf(true, Constants::PERMISSION_CREATE));
	}

	public function testScriptForReadableLinkShare(): void {
		$this->assertTrue($this->lauf(true, Constants::PERMISSION_READ));
		$this->assertSame(1, count(array_keys(Util::getScripts(), self::SCRIPT, true)));
	}

	public function testNoScriptOnThePasswordPage(): void {
		// The same event fires for the authentication page; no score is
		// reachable there yet.
		$this->assertFalse($this->lauf(true, Constants::PERMISSION_READ, BeforeTemplateRenderedEvent::SCOPE_PUBLIC_SHARE_AUTH));
	}

	public function testIgnoresOtherEvents(): void {
		$this->assertFalse($this->lauf(true, Constants::PERMISSION_READ, null, new Event()));
	}
}
