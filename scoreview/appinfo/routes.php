<?php

declare(strict_types=1);

return [
	'routes' => [
		// Hello-World-Verifikationsseite für Phase 2. Kein Navigations-Eintrag
		// (siehe info.xml) - geplant ist ausschließlich Viewer-Integration
		// (Phase 4), die Seite wird direkt per URL aufgerufen.
		['name' => 'page#index', 'url' => '/', 'verb' => 'GET'],
	],
];
