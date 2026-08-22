<?php

declare(strict_types=1);

return [
	'routes' => [
		// Hello-World-Verifikationsseite für Phase 2. Kein Navigations-Eintrag
		// (siehe info.xml) - geplant ist ausschließlich Viewer-Integration
		// (Phase 4), die Seite wird direkt per URL aufgerufen.
		['name' => 'page#index', 'url' => '/', 'verb' => 'GET'],

		// Konvertierungs-Pipeline (Phase 3)
		['name' => 'conversion#status', 'url' => '/api/scores/{fileId}/status', 'verb' => 'GET'],
		['name' => 'conversion#musicxml', 'url' => '/api/scores/{fileId}/musicxml', 'verb' => 'GET'],
		['name' => 'conversion#audio', 'url' => '/api/scores/{fileId}/audio', 'verb' => 'GET'],
		['name' => 'conversion#timing', 'url' => '/api/scores/{fileId}/timing', 'verb' => 'GET'],

		// Admin-Einstellungen (Sidecar-URL/Secret)
		['name' => 'settings#update', 'url' => '/api/settings', 'verb' => 'POST'],
	],
];
