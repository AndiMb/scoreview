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
		['name' => 'conversion#artifact', 'url' => '/api/scores/{fileId}/artifact/{name}', 'verb' => 'GET', 'requirements' => ['fileId' => '\d+', 'name' => '[a-z0-9\-]+']],

		// SoundFont fuer die Browser-Wiedergabe (siehe docs/architecture.md
		// E1). Nicht an eine fileId gebunden - eine Datei fuer die gesamte
		// Instanz, siehe Service\SoundFontService.
		['name' => 'sound_font#get', 'url' => '/api/soundfont', 'verb' => 'GET'],

		// Private Notizen
		['name' => 'annotation#index', 'url' => '/api/scores/{fileId}/annotations', 'verb' => 'GET'],
		['name' => 'annotation#create', 'url' => '/api/scores/{fileId}/annotations', 'verb' => 'POST'],
		['name' => 'annotation#update', 'url' => '/api/scores/{fileId}/annotations/{id}', 'verb' => 'PUT'],
		['name' => 'annotation#destroy', 'url' => '/api/scores/{fileId}/annotations/{id}', 'verb' => 'DELETE'],

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
