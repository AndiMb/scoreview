<?php

declare(strict_types=1);

namespace OCA\ScoreView\Tests\Unit\Controller;

use PHPUnit\Framework\TestCase;
use ReflectionClass;

/**
 * Every attribute on a controller must name a class that exists.
 *
 * PHP does not resolve an attribute's class until someone asks for an
 * instance, and Nextcloud's middleware only asks by the class it knows. An
 * attribute under a wrong namespace is therefore simply invisible: the
 * method falls back to the strictest default (admin only) and nothing
 * complains. That is how `#[AuthorizedAdminSetting]` once pointed at
 * `OCP\Settings\Attribute\…` and delegated admins got 403 on every settings
 * endpoint. The unit tests call the methods directly and cannot see it.
 */
class AttributeClassesTest extends TestCase {
	public function testEveryControllerAttributeNamesAnExistingClass(): void {
		$unknown = [];
		$checked = 0;
		foreach (glob(__DIR__ . '/../../../lib/Controller/*.php') as $file) {
			$class = 'OCA\\ScoreView\\Controller\\' . basename($file, '.php');
			$reflection = new ReflectionClass($class);
			$targets = [$reflection, ...$reflection->getMethods()];
			foreach ($targets as $target) {
				foreach ($target->getAttributes() as $attribute) {
					$checked++;
					if (!class_exists($attribute->getName())) {
						$unknown[] = $class . '::' . $target->getName() . ' #[' . $attribute->getName() . ']';
					}
				}
			}
		}
		$this->assertGreaterThan(0, $checked, 'no attributes found - wrong path?');
		$this->assertSame([], $unknown);
	}
}
