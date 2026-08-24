/**
 * ESLint-Konfiguration.
 *
 * Bis hierher gab es keinen Linter - im Bestand standen aber bereits sechs
 * `// eslint-disable-next-line no-console`-Kommentare. Die Erwartung war also
 * da, nur nichts, was sie eingeloest haette: der Stil war ausschliesslich
 * durch Disziplin gehalten, und die Disable-Kommentare waren wirkungslos.
 *
 * `recommendedJavascript` statt `recommended`: die App ist Vue 3, aber die
 * `<script>`-Bloecke sind JavaScript, nicht TypeScript. `recommended` wuerde
 * sie als TS parsen (siehe @nextcloud/eslint-config README).
 */
import { recommendedJavascript } from '@nextcloud/eslint-config'

export default [
	{
		// Build-Artefakte (gitignored, siehe .gitignore) - darunter das
		// unveraendert kopierte, minifizierte spessasynth-Worklet, das wir nur
		// ausliefern und nicht pflegen (siehe webpack.config.js).
		ignores: ['js/**', 'node_modules/**'],
	},
	...recommendedJavascript,
	{
		languageOptions: {
			globals: {
				// Laufzeit-Global von Nextcloud, kein Import: der Viewer
				// registriert sich bei OCA.Viewer (src/viewer.js). Das
				// veraltete OC.* wird nirgends mehr benutzt - HTTP laeuft
				// ueber @nextcloud/axios, URLs ueber @nextcloud/router - und
				// steht deshalb bewusst nicht hier: eine Rueckkehr zu OC.*
				// soll der Linter melden, nicht stillschweigend durchlassen.
				OCA: 'readonly',
			},
		},
		rules: {
			// AUS, und zwar bewusst: `jsdoc/require-jsdoc` ist autofixbar und
			// setzt dabei leere `/** */`-Rumpfbloecke ueber jede Funktion
			// (ausprobiert: 35 Stueck allein in player.js/silentClock.js). Das
			// widerspricht der Konvention aus CLAUDE.md - "Kommentare erklaeren
			// das Warum, nicht das Was" - und verduennt genau die dichte,
			// handgeschriebene Kommentierung, die dieser Bestand als Staerke hat.
			// Die Module, deren Schnittstelle Dokumentation braucht
			// (scoreLayout.js, mixerLayout.js, scrollPlan.js, metronome.js),
			// tragen bereits vollstaendige JSDoc mit echtem Inhalt.
			'jsdoc/require-jsdoc': 'off',
			// Aus demselben Grund: erzwaengen Platzhaltertexte und `@param
			// {*}`-Typen dort, wo der Kopfkommentar die Bedeutung schon traegt.
			'jsdoc/require-param-description': 'off',
			'jsdoc/require-param-type': 'off',
			'jsdoc/require-returns-description': 'off',
		},
	},
	{
		// tools/l10n.mjs ist ein Node-CLI-Werkzeug (`npm run l10n:extract`), kein
		// Browsercode: `process` ist dort ein regulaeres Global, und die
		// Konsolenausgabe IST seine Schnittstelle - sie meldet fehlende und
		// verwaiste Uebersetzungen (siehe E4).
		files: ['tools/**/*.mjs', 'tools/**/*.js'],
		languageOptions: {
			globals: {
				console: 'readonly',
				process: 'readonly',
			},
		},
		rules: {
			'no-console': 'off',
		},
	},
]
