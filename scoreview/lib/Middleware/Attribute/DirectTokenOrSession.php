<?php

declare(strict_types=1);

namespace OCA\ScoreView\Middleware\Attribute;

use Attribute;

/**
 * Markiert eine Route, die neben der angemeldeten Sitzung auch ein
 * Direct-Editing-Token als Ausweis annimmt - der Weg der mobilen Apps, die
 * Nextclouds Weboberflaeche nicht kennen (Middleware\DirectAccessMiddleware).
 *
 * Gemessen an Nextcloud 31 und 34: Die Seite eines Direct Editors kommt ohne
 * Sitzungscookie an; ihre Folgeanfragen beantwortet der Server mit 401. Der
 * Token ist dort der einzige Ausweis, den die Seite hat.
 *
 * **Wozu der Schalter.** Damit Nextclouds SecurityMiddleware die sitzungslose
 * Anfrage ueberhaupt bis hierher durchlaesst, brauchen alle betroffenen Routen
 * #[PublicPage] und #[NoCSRFRequired]. Damit faellt aber auch die
 * CSRF-Pruefung weg, die ein Teil von ihnen vorher hatte. Die Middleware holt
 * sie fuer den Sitzungsfall zurueck - und ausschliesslich dort, wo es sie
 * vorher gab: Die reinen Auslieferungsrouten (SoundFont, Artefakte, Engine)
 * trugen schon immer #[NoCSRFRequired], weil der Browser sie mit blossem
 * fetch() ohne Token laedt (siehe composables/usePlayback.js). Eine neue
 * Pruefung wuerde sie brechen. Ohne Header verhaelt sich so jede Route exakt
 * wie vorher.
 */
#[Attribute(Attribute::TARGET_METHOD)]
class DirectTokenOrSession {
	public function __construct(
		/** Ob im Sitzungsfall die CSRF-Pruefung nachzuholen ist - siehe oben. */
		public bool $csrfInSession = true,
	) {
	}
}
