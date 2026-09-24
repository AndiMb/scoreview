import { generateFilePath } from '@nextcloud/router'

// Woher webpack nachgeladene Teile holt. Die Vorgabe aus
// @nextcloud/webpack-vue-config ist fest `/apps/scoreview/js/` - liegt die App
// wie ueblich unter `custom_apps/`, liefe jedes Nachladen ins 404. Bisher gab
// es nichts nachzuladen; Nextclouds Dateiauswahl (@nextcloud/dialogs, fuer den
// Setlisten-Editor) laedt sich aber selbst in Teilen nach. Der richtige Pfad
// kommt deshalb zur Laufzeit von Nextcloud selbst.
//
// Als eigenes Modul, das jeder Einstieg importiert. Wo in der Importliste,
// ist gleich: Nachgeladen wird erst auf eine Handlung hin (die Dateiauswahl
// oeffnen), lange nachdem alle Importe ausgewertet sind.
// eslint-disable-next-line no-undef
__webpack_public_path__ = generateFilePath('scoreview', '', 'js/')
