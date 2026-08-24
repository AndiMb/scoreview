<?php
declare(strict_types=1);
/**
 * Nur noch der Mountpunkt.
 *
 * Bis hierher stand hier das vollstaendige Formular als handgeschriebenes
 * HTML mit `style="width: 320px"` an jedem Feld, bedient von 163 Zeilen
 * getElementById/fetch in src/settings.js. Beides ersetzt jetzt
 * src/components/AdminSettings.vue auf Basis von @nextcloud/vue - dieselbe
 * Entscheidung, die E5 fuer den Viewer schon getroffen hatte.
 *
 * Den Startzustand liefert IInitialState (siehe Settings\AdminSettings), er
 * wird von Nextcloud als <input type="hidden"> in die Seite gerendert und
 * von @nextcloud/initial-state gelesen - kein zusaetzlicher GET-Roundtrip
 * fuer vier Felder.
 */
?>
<div id="scoreview-admin-settings"></div>
