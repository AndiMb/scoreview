<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Controller;

use OCA\ScoreView\AppInfo\Application;
use OCA\ScoreView\Service\UserFileResolver;
use OCP\Files\File;
use PHPUnit\Framework\MockObject\MockObject;

/**
 * The controllers ask UserFileResolver for a score (resolveScore,
 * resolveUserScore). Doubling those as well would let a test hand a folder
 * to a controller as if it were a score - the very thing they guard
 * against. So only the tree lookup and the session are doubled, and the
 * rule of what a score is runs for real.
 */
trait ScoreDoubles {
	/** @return UserFileResolver&MockObject */
	private function resolverDouble(): UserFileResolver {
		return $this->getMockBuilder(UserFileResolver::class)
			->disableOriginalConstructor()
			->onlyMethods(['resolveOwnNode', 'currentUserId', 'attributionUserId'])
			->getMock();
	}

	/** @return File&MockObject a file that is a score by name and mimetype */
	private function scoreDouble(): File {
		$file = $this->createMock(File::class);
		$file->method('getName')->willReturn('Probe.mscz');
		$file->method('getMimetype')->willReturn(Application::MSCZ_MIMETYPE);
		return $file;
	}
}
