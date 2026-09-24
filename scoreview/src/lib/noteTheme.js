// Dunkelmodus der Noten: helle Schrift auf dunklem Grund, wenn das
// Nextcloud-Theme dunkel ist - oder wenn die Nutzerin es so einstellt.
//
// Erkannt wird am GRUND selbst (`--color-main-background`), nicht am Namen
// des Themes (`data-themes`): Eigene und kontrastreiche Themes haben Namen,
// die hier niemand kennt, ihre Hintergrundfarbe aber ist eindeutig.
//
// Umgefaerbt wird nur ueber CSS in ScorePage.vue - das SVG selbst bleibt
// unangetastet, und eingebettete Bilder (`<image>`) werden nicht erfasst:
// Ein pauschales `filter: invert()` machte aus einem Foto ein Negativ.
// Hier stehen nur die Werte.

export const NOTE_THEME_AUTO = 'auto'
export const NOTE_THEME_LIGHT = 'light'
export const NOTE_THEME_DARK = 'dark'
export const NOTE_THEMES = Object.freeze([NOTE_THEME_AUTO, NOTE_THEME_LIGHT, NOTE_THEME_DARK])

/**
 * Die Farben je Modus. Kein reines Schwarz/Weiss im Dunkeln: Weiss auf
 * Schwarz blendet auf einem Tablet in einem dunklen Saal, ein gedaempftes
 * Paar liest sich ruhiger. Der Streifen „Meine Stimme" wird im Dunkeln etwas
 * kraeftiger, sonst verschwaende er im Grund.
 *
 * Die Loop-Flaggen haben eigene Farben statt `--color-success`/`--color-error`:
 * Gemessen liefert Nextcloud dort je nach Theme eine Flaechenfarbe (hell:
 * rgb(216, 243, 218), dunkel: rgb(17, 50, 26)) - auf weissem Papier bzw.
 * dunklem Grund ist die Flagge dann kaum zu sehen.
 *
 * Aus demselben Grund hat der Punkt einer eigenen Notiz eine eigene Farbe:
 * `--color-warning` ist seit Nextcloud 34 ebenfalls eine Flaechenfarbe
 * (gemessen: hell #FFEEC5, dunkel #3D3010) - der Punkt kam damit auf 1,15:1
 * bzw. 1,32:1 zum Papier und war praktisch unsichtbar. Die Werte sind
 * Nextclouds `--color-element-warning`, hier aber an den Notenmodus gebunden
 * statt an das Theme, damit „helle Noten auf Dunkel" unter hellem Theme
 * nicht wieder ins Leere laeuft.
 *
 * Dasselbe gilt fuer die Punkte geteilter Notizen und der Stimmnotizen der
 * Leitung: Mit `--color-primary-element` und `--color-warning-text` folgten
 * sie dem Theme, nicht dem Papier - gemessen kam der Stimmnotizpunkt bei
 * hellen Noten unter dunklem Theme (#FFEEC5 auf Weiss) auf 1,15:1. Die Werte
 * sind Nextclouds Voreinstellungen fuer diese Rollen (Primaerfarbe, Warntext),
 * so sprechen Notenbild und Liste bei Standard-Theme dieselbe Farbe.
 */
const PALETTE = {
	[NOTE_THEME_LIGHT]: {
		page: '#ffffff',
		ink: '#000000',
		mystaff: 'rgba(255, 193, 7, 0.18)',
		mystaffEdge: 'rgba(255, 152, 0, 0.75)',
		loopStart: '#2e7d32',
		loopEnd: '#c62828',
		// Stempel (B3): ein Blaustift - vom Druck und von der roten
		// Hervorhebung unterscheidbar.
		stamp: '#1565c0',
		marker: '#bf7900',
		markerShared: '#00679e',
		markerParts: '#664700',
	},
	[NOTE_THEME_DARK]: {
		page: '#1c1c1c',
		ink: '#e6e6e6',
		mystaff: 'rgba(255, 193, 7, 0.2)',
		mystaffEdge: 'rgba(255, 193, 7, 0.85)',
		loopStart: '#66bb6a',
		loopEnd: '#ef5350',
		stamp: '#64b5f6',
		marker: '#ffcc00',
		markerShared: '#0091f2',
		markerParts: '#ffeec5',
	},
}

/**
 * Mindestkontrast der Hervorhebungsfarbe gegen den Grund - WCAG 1.4.11
 * verlangt 3:1 fuer grafische Elemente. Ein Violett, das auf weissem Papier
 * kraeftig wirkt, verschwindet sonst auf dunklem Grund.
 */
const MIN_HIGHLIGHT_CONTRAST = 3

/**
 * @param {string|undefined|null} value
 * @return {string} einer der NOTE_THEMES, sonst `auto`
 */
export function normalizeNoteTheme(value) {
	const wert = String(value ?? '').trim()
	return NOTE_THEMES.includes(wert) ? wert : NOTE_THEME_AUTO
}

/**
 * Eine CSS-Farbe in RGB (0..255). Kennt die Formen, die ein Theme in
 * `--color-main-background` schreibt: `#rgb`, `#rrggbb` (auch mit Alpha) und
 * `rgb()`/`rgba()` in Komma- und Leerzeichenschreibweise.
 *
 * @param {string} cssColor
 * @return {?{r:number, g:number, b:number}}
 */
export function parseCssColor(cssColor) {
	const wert = String(cssColor ?? '').trim().toLowerCase()
	let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])([0-9a-f])?$/.exec(wert)
	if (m) {
		return { r: parseInt(m[1] + m[1], 16), g: parseInt(m[2] + m[2], 16), b: parseInt(m[3] + m[3], 16) }
	}
	m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/.exec(wert)
	if (m) {
		return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
	}
	m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(wert)
	if (m) {
		const kanal = (v) => Math.min(255, Math.max(0, Math.round(Number(v))))
		return { r: kanal(m[1]), g: kanal(m[2]), b: kanal(m[3]) }
	}
	return null
}

/**
 * Relative Leuchtdichte nach WCAG 2.
 *
 * @param {{r:number, g:number, b:number}} rgb
 * @return {number} 0 (schwarz) bis 1 (weiss)
 */
export function relativeLuminance({ r, g, b }) {
	const lin = (c) => {
		const s = c / 255
		return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
	}
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/**
 * @param {{r:number, g:number, b:number}} a
 * @param {{r:number, g:number, b:number}} b
 * @return {number} Kontrastverhaeltnis 1..21
 */
export function contrastRatio(a, b) {
	const la = relativeLuminance(a)
	const lb = relativeLuminance(b)
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * Ob ein Grund dunkel ist: Schwarze Schrift haette darauf weniger Kontrast
 * als weisse. Unlesbares gilt als hell - so sieht der Viewer ohne Dunkelmodus aus, und
 * ein falsch dunkles Notenbild waere der schlimmere Fehler.
 *
 * @param {string} cssColor
 * @return {boolean}
 */
export function isDarkBackground(cssColor) {
	const rgb = parseCssColor(cssColor)
	if (!rgb) {
		return false
	}
	const schwarz = { r: 0, g: 0, b: 0 }
	const weiss = { r: 255, g: 255, b: 255 }
	return contrastRatio(rgb, weiss) > contrastRatio(rgb, schwarz)
}

/**
 * @param {string} preference `auto` | `light` | `dark`
 * @param {boolean} themeIsDark
 * @return {string} `light` oder `dark`
 */
export function resolveNoteTheme(preference, themeIsDark) {
	const wahl = normalizeNoteTheme(preference)
	if (wahl === NOTE_THEME_AUTO) {
		return themeIsDark ? NOTE_THEME_DARK : NOTE_THEME_LIGHT
	}
	return wahl
}

/**
 * Hebt eine Farbe so weit in Richtung Weiss an, bis sie gegen den Grund
 * `minRatio` erreicht. Nur aufhellen, nie abdunkeln: gebraucht wird das nur
 * auf dunklem Grund, und die gewaehlte Farbe soll erkennbar dieselbe bleiben.
 *
 * @param {string} color `#rrggbb`
 * @param {string} background `#rrggbb`
 * @param {number} minRatio
 * @return {string} `#rrggbb`
 */
export function ensureContrast(color, background, minRatio = MIN_HIGHLIGHT_CONTRAST) {
	const fg = parseCssColor(color)
	const bg = parseCssColor(background)
	if (!fg || !bg) {
		return color
	}
	const hex = ({ r, g, b }) => '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')
	for (let anteil = 0; anteil <= 1.0001; anteil += 0.05) {
		const gemischt = {
			r: Math.round(fg.r + (255 - fg.r) * anteil),
			g: Math.round(fg.g + (255 - fg.g) * anteil),
			b: Math.round(fg.b + (255 - fg.b) * anteil),
		}
		if (contrastRatio(gemischt, bg) >= minRatio) {
			return hex(gemischt)
		}
	}
	return '#ffffff'
}

/**
 * Die CSS-Variablen des Notenbilds fuer einen Modus.
 *
 * Was AUF dem Papier liegt, folgt dem Notenmodus; was in den Leisten von
 * Nextcloud steht, dem Theme - auch wenn es dieselbe Bedeutung traegt. Die
 * Stempel sind beides: im Notenbild `--scoreview-stamp`, in Palette und Liste
 * der Notizen `--scoreview-ui-stamp`. Mit nur einer Farbe stand bei dunklen
 * Noten unter hellem Theme ein hellblauer Stempel auf weisser Leiste (2,2:1).
 *
 * @param {string} theme `light` oder `dark` (aus resolveNoteTheme)
 * @param {string} highlightColor `#rrggbb` der Nutzerin
 * @param {boolean} [uiDark] ob das Nextcloud-Theme dunkel ist - ohne Angabe wie die Noten
 * @return {object} Variablen fuer ein `style`-Attribut
 */
export function noteThemeCssVars(theme, highlightColor, uiDark = theme === NOTE_THEME_DARK) {
	const palette = PALETTE[theme] ?? PALETTE[NOTE_THEME_LIGHT]
	const uiPalette = PALETTE[uiDark ? NOTE_THEME_DARK : NOTE_THEME_LIGHT]
	const vars = {
		'--scoreview-page': palette.page,
		'--scoreview-ink': palette.ink,
		'--scoreview-mystaff': palette.mystaff,
		'--scoreview-mystaff-edge': palette.mystaffEdge,
		'--scoreview-loop-start': palette.loopStart,
		'--scoreview-loop-end': palette.loopEnd,
		'--scoreview-stamp': palette.stamp,
		'--scoreview-marker': palette.marker,
		'--scoreview-marker-shared': palette.markerShared,
		'--scoreview-marker-parts': palette.markerParts,
		'--scoreview-ui-stamp': uiPalette.stamp,
	}
	if (theme === NOTE_THEME_DARK) {
		// Nur die Notenkoepfe: Das Band liegt HINTER den Noten und darf
		// ohnehin durchscheinen, die Nutzerfarbe bleibt dort unveraendert.
		vars['--scoreview-highlight'] = ensureContrast(highlightColor, palette.page)
	}
	return vars
}
