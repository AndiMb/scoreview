<?php

declare(strict_types=1);

return [
	'routes' => [
		// Kein '/'-Einstieg und kein Navigations-Eintrag (siehe info.xml): die
		// App hat bewusst keine eigene Seite, sie klinkt sich ausschliesslich in
		// Files/Viewer ein (Listener\FilesLoadAdditionalScriptsListener).

		// Konvertierungs-Pipeline (siehe docs/architecture.md E1/E2)
		['name' => 'conversion#status', 'url' => '/api/scores/{fileId}/status', 'verb' => 'GET'],
		// EINE Auslieferungsroute statt fuenf fast identischer. Welche Namen
		// gueltig sind, steht als Allowlist in ConversionService::ARTIFACTS
		// bzw. getArtifact() - hier bewusst nur die Zeichenklasse, damit ein
		// unbekannter Name als 404 aus dem Controller kommt und nicht als
		// Routing-Fehler.
		// Verwirft die gespeicherte Konvertierung und laesst sie neu erzeugen
		// (Controller\ConversionController::reconvert). POST, weil es der
		// einzige schreibende Eingriff in den Konvertierungs-Cache ist, den
		// eine Nutzerin ausloesen kann.
		['name' => 'conversion#reconvert', 'url' => '/api/scores/{fileId}/reconvert', 'verb' => 'POST', 'requirements' => ['fileId' => '\d+']],
		['name' => 'conversion#artifact', 'url' => '/api/scores/{fileId}/artifact/{name}', 'verb' => 'GET', 'requirements' => ['fileId' => '\d+', 'name' => '[a-z0-9\-]+']],
		// Die Partitur selbst - nur fuer den Konvertierungsweg im Browser.
		// Dieselbe Rechtepruefung wie oben; der Viewer hat von Nextclouds
		// Viewer nur die fileId, keinen Pfad.
		['name' => 'conversion#source', 'url' => '/api/scores/{fileId}/source', 'verb' => 'GET', 'requirements' => ['fileId' => '\d+']],

		// SoundFont fuer die Browser-Wiedergabe (siehe docs/architecture.md
		// E1). Nicht an eine fileId gebunden - eine Datei fuer die gesamte
		// Instanz, siehe Service\SoundFontService.
		['name' => 'sound_font#get', 'url' => '/api/soundfont', 'verb' => 'GET'],

		// Die scoreview-engine fuer den Konvertierungsweg im Browser. Drei feste
		// Dateinamen als Allowlist im Controller - hier bewusst nur die
		// Zeichenklasse, damit ein unbekannter Name als 404 aus dem Controller
		// kommt und nicht als Routing-Fehler (wie bei conversion#artifact).
		// Der Zuschnitt "ein Verzeichnis, drei Geschwister" ist Bedingung: Der
		// Glue sucht seine .wasm/.data relativ zur eigenen Script-URL.
		['name' => 'engine#get', 'url' => '/api/engine/{name}', 'verb' => 'GET', 'requirements' => ['name' => '[a-zA-Z0-9._\-]+']],

		// Private Notizen
		['name' => 'annotation#index', 'url' => '/api/scores/{fileId}/annotations', 'verb' => 'GET'],
		['name' => 'annotation#create', 'url' => '/api/scores/{fileId}/annotations', 'verb' => 'POST'],
		['name' => 'annotation#update', 'url' => '/api/scores/{fileId}/annotations/{id}', 'verb' => 'PUT'],
		['name' => 'annotation#destroy', 'url' => '/api/scores/{fileId}/annotations/{id}', 'verb' => 'DELETE'],

		// „Meine Stimme" je Partitur - lesend und schreibend, weil der Wert je
		// Datei gilt und der Anfangszustand der Seite die Datei noch nicht
		// kennt (Controller\MyPartController).
		['name' => 'my_part#show', 'url' => '/api/scores/{fileId}/my-part', 'verb' => 'GET', 'requirements' => ['fileId' => '\d+']],
		['name' => 'my_part#update', 'url' => '/api/scores/{fileId}/my-part', 'verb' => 'PUT', 'requirements' => ['fileId' => '\d+']],

		// Leitungen einer Partitur (B1, Controller\LeaderController). Die
		// Kennung im DELETE darf alles enthalten, was Nextcloud in einer UID
		// zulaesst (auch Punkt, @ und Leerzeichen) - nur kein '/', das die
		// Route ohnehin trennt.
		['name' => 'leader#index', 'url' => '/api/scores/{fileId}/leaders', 'verb' => 'GET', 'requirements' => ['fileId' => '\d+']],
		['name' => 'leader#create', 'url' => '/api/scores/{fileId}/leaders', 'verb' => 'POST', 'requirements' => ['fileId' => '\d+']],
		['name' => 'leader#destroy', 'url' => '/api/scores/{fileId}/leaders/{uid}', 'verb' => 'DELETE', 'requirements' => ['fileId' => '\d+', 'uid' => '[^/]+']],
		// Vorschlaege zum Ernennen - eigene, token-faehige Suche statt der
		// OCS-Sharee-API, die eine Sitzung verlangt (Service\LeaderService::candidates).
		['name' => 'leader#candidates', 'url' => '/api/scores/{fileId}/leader-candidates', 'verb' => 'GET', 'requirements' => ['fileId' => '\d+']],

		// „Folgt mir" (C, Controller\FollowController): EIN Zustand je Datei,
		// gelesen per GET ?since=<version> (204, wenn sich nichts geaendert
		// hat), geschrieben nur von Leitungen. /join meldet ein Geraet fuer
		// Push an (notify_push, optional).
		['name' => 'follow#show', 'url' => '/api/scores/{fileId}/follow', 'verb' => 'GET', 'requirements' => ['fileId' => '\d+']],
		['name' => 'follow#create', 'url' => '/api/scores/{fileId}/follow', 'verb' => 'POST', 'requirements' => ['fileId' => '\d+']],
		['name' => 'follow#update', 'url' => '/api/scores/{fileId}/follow', 'verb' => 'PATCH', 'requirements' => ['fileId' => '\d+']],
		['name' => 'follow#destroy', 'url' => '/api/scores/{fileId}/follow', 'verb' => 'DELETE', 'requirements' => ['fileId' => '\d+']],
		['name' => 'follow#join', 'url' => '/api/scores/{fileId}/follow/join', 'verb' => 'POST', 'requirements' => ['fileId' => '\d+']],

		// Eigene Aufnahmen (D1, Controller\RecordingController): nur fuer die
		// Aufnehmende, fremd heisst 404 (V7). Der Upload kommt roh als
		// audio/wav, die Angaben zum Zeitabgleich in der Query.
		['name' => 'recording#index', 'url' => '/api/scores/{fileId}/recordings', 'verb' => 'GET', 'requirements' => ['fileId' => '\d+']],
		['name' => 'recording#create', 'url' => '/api/scores/{fileId}/recordings', 'verb' => 'POST', 'requirements' => ['fileId' => '\d+']],
		['name' => 'recording#show', 'url' => '/api/scores/{fileId}/recordings/{id}', 'verb' => 'GET', 'requirements' => ['fileId' => '\d+', 'id' => '\d+']],
		['name' => 'recording#destroy', 'url' => '/api/scores/{fileId}/recordings/{id}', 'verb' => 'DELETE', 'requirements' => ['fileId' => '\d+', 'id' => '\d+']],

		// Setlisten (E, Controller\SetlistController). Eine Setliste ist eine
		// eigene Datei `*.setlist.md` in Files (V3) - die Routen lesen und
		// schreiben sie, `/api/scores/{fileId}/…` fragen von der offenen
		// Partitur aus (Weg 2 und die Auswahl fuer den Editor).
		['name' => 'setlist#show', 'url' => '/api/setlists/{fileId}', 'verb' => 'GET', 'requirements' => ['fileId' => '\d+']],
		['name' => 'setlist#update', 'url' => '/api/setlists/{fileId}', 'verb' => 'PUT', 'requirements' => ['fileId' => '\d+']],
		['name' => 'setlist#create', 'url' => '/api/setlists', 'verb' => 'POST'],
		['name' => 'setlist#forScore', 'url' => '/api/scores/{fileId}/setlists', 'verb' => 'GET', 'requirements' => ['fileId' => '\d+']],
		['name' => 'setlist#candidates', 'url' => '/api/scores/{fileId}/score-candidates', 'verb' => 'GET', 'requirements' => ['fileId' => '\d+']],
		// Begleit-Token fuer die mobile Seite (Entwurf §15): nur mit dem
		// Direct-Editing-Token der Partitur, nur fuer eine Liste daneben, die
		// sie enthaelt. POST, weil jede Antwort neue Token erzeugt.
		['name' => 'setlist#tokens', 'url' => '/api/scores/{fileId}/setlists/{setlistId}/tokens', 'verb' => 'POST', 'requirements' => ['fileId' => '\d+', 'setlistId' => '\d+']],

		// Anzeigeeinstellungen der einzelnen Nutzerin (Hervorhebung im
		// Notenbild). Nur schreibend - gelesen werden sie aus dem
		// Anfangszustand der Files-Seite, siehe Controller\PreferenceController.
		['name' => 'preference#update', 'url' => '/api/preferences', 'verb' => 'POST'],

		// Admin-Einstellungen (Sidecar-URL/Secret, Eager-Konvertierung)
		['name' => 'settings#update', 'url' => '/api/settings', 'verb' => 'POST'],
		// Betriebsdiagnose + Sidecar-Selbsttest. health() ist lesend,
		// selfTest() startet eine echte Konvertierung - deshalb getrennt
		// und beide nur fuer Admins (AuthorizedAdminSetting).
		['name' => 'settings#health', 'url' => '/api/health', 'verb' => 'GET'],
		['name' => 'settings#selfTest', 'url' => '/api/selftest', 'verb' => 'POST'],
	],
];
