<?php

declare(strict_types=1);

/**
 * Minimalstubs für das, was `OCP\Util::addScript()` aus Nextclouds **privatem**
 * Namensraum braucht - und was deshalb nicht Teil des `nextcloud/ocp`-Pakets
 * ist: die Klasse `OC` mit ihrem Service-Container und
 * `OC\AppScriptDependency`.
 *
 * Warum das nötig ist: `addScript()` ist der einzige Weg, ein Bundle an eine
 * Seite zu hängen. Ohne diese Stubs ist jede Klasse, die eine Seite
 * ausliefert, nicht unit-testbar ("Class \"OC\" not found") - betroffen ist
 * DirectEditing\ScoreDirectEditor, und ab S2 jede weitere.
 *
 * Bewusst so schmal wie möglich: Der Container beantwortet jede Anfrage mit
 * demselben Doppelgänger, der genau die Methoden kennt, die `Util`
 * tatsächlich aufruft. Er bildet Nextclouds Container NICHT nach - wer hier
 * mehr erwartet, testet die falsche Schicht.
 *
 * Wird ausschließlich in Tests geladen (`autoload-dev.files` in
 * composer.json) - im ausgelieferten Paket kommen die echten Klassen vom
 * Server.
 */

namespace {
	if (!class_exists('OC', false)) {
		class OC {
			/** @var object Nextclouds Container - hier ein Doppelgänger, siehe oben. */
			public static $server;
		}

		OC::$server = new class {
			public function get(string $klasse): object {
				return new class {
					/** Für Util::addTranslations() - welche Sprache, ist für einen Unit-Test gleichgültig. */
					public function findLanguage($app = null): string {
						return 'en';
					}

					/** Für Util::getScripts(), falls ein Test je die Skriptliste ausliest. */
					public function sort(array $scripts, array $deps): array {
						return $scripts;
					}
				};
			}
		};
	}
}

namespace OC {
	if (!class_exists(AppScriptDependency::class, false)) {
		/** Util::addScript() führt darin Buch, welche App nach welcher geladen wird. */
		class AppScriptDependency {
			public function __construct(
				private string $id,
				private array $deps = [],
				private bool $visited = false,
			) {
			}

			public function addDep(string $dep): void {
				if (!in_array($dep, $this->deps, true)) {
					$this->deps[] = $dep;
				}
			}
		}
	}
}
