<?php
declare(strict_types=1);
/**
 * Nur der Mountpunkt. Das Formular selbst ist eine Vue-Komponente auf
 * @nextcloud/vue (src/components/AdminSettings.vue) - dieselbe
 * Entscheidung wie fuer den Viewer, siehe E5 in docs/architecture.md.
 *
 * Den Startzustand liefert IInitialState (siehe Settings\AdminSettings), er
 * wird von Nextcloud als <input type="hidden"> in die Seite gerendert und
 * von @nextcloud/initial-state gelesen - kein zusaetzlicher GET-Roundtrip
 * fuer vier Felder.
 */
?>
<div id="scoreview-admin-settings"></div>
