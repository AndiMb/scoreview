<?php

declare(strict_types=1);

/**
 * Minimalstub für `OC\Hooks\Emitter`.
 *
 * Warum das nötig ist: `OCP\Files\IRootFolder` erweitert diese Schnittstelle,
 * sie liegt aber in Nextclouds **privatem** Namensraum (`lib/private/`) und
 * ist deshalb nicht Teil des `nextcloud/ocp`-Pakets. Ohne sie lässt sich
 * `IRootFolder` gar nicht mocken - PHP kann die Vererbungskette nicht
 * auflösen -, und damit wären `CleanupOrphansJob` und alles andere, was am
 * Dateibaum hängt, nicht unit-testbar.
 *
 * Wortgleich zur echten Fassung aus `lib/private/Hooks/Emitter.php` der
 * Testinstanz übernommen, damit ein späterer Signaturwechsel nicht
 * stillschweigend auseinanderläuft. Wird ausschließlich in Tests geladen
 * (`autoload-dev.files` in composer.json) - im ausgelieferten Paket kommt
 * die echte Klasse vom Server.
 */

namespace OC\Hooks;

if (!interface_exists(Emitter::class, false)) {
	interface Emitter {
		/**
		 * @param string $scope
		 * @param string $method
		 * @return void
		 */
		public function listen($scope, $method, callable $callback);

		/**
		 * @param string $scope optional
		 * @param string $method optional
		 * @return void
		 */
		public function removeListener($scope = null, $method = null, ?callable $callback = null);
	}
}
