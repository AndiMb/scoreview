<?php

declare(strict_types=1);

namespace OCA\ScoreView\Service;

use OCA\ScoreView\AppInfo\Application;
use OCP\Files\File;
use OCP\Files\Node;

/**
 * What counts as a score - one rule for the listeners, the setlists, the
 * controllers and the share path.
 *
 * The name decides, the mimetype only adds to it: the mimetype is
 * registered by the app itself (MimetypeRegistration) and is wrong on a
 * file uploaded before that ran, or on an instance where no cron has run
 * since (docs/troubleshooting.md). A score must not stop being a score for
 * that. Lower-cased with mb_strtolower, as Files compares names - a name
 * with an umlaut before the dot is still the same name.
 */
final class ScoreFiles {
	public const EXTENSION = '.' . MimetypeRegistration::EXTENSION;

	public static function hasScoreName(string $name): bool {
		return str_ends_with(mb_strtolower($name, 'UTF-8'), self::EXTENSION);
	}

	/**
	 * A score file - no folder, and no other file that happens to be readable.
	 *
	 * @psalm-assert-if-true File $node
	 */
	public static function isScore(?Node $node): bool {
		if (!$node instanceof File) {
			return false;
		}
		try {
			return self::hasScoreName((string)$node->getName()) || $node->getMimetype() === Application::MSCZ_MIMETYPE;
		} catch (\Throwable) {
			// A node that cannot name itself any more (deleted meanwhile, a
			// storage gone away) is nothing to show.
			return false;
		}
	}
}
