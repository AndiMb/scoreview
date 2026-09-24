import { describe, expect, it } from 'vitest'
import { HIGHLIGHT_PRESETS } from './highlightStyle.js'
import {
	contrastRatio,
	ensureContrast,
	isDarkBackground,
	normalizeNoteTheme,
	noteThemeCssVars,
	parseCssColor,
	resolveNoteTheme,
} from './noteTheme.js'

describe('noteTheme.isDarkBackground', () => {
	it('erkennt die Hintergruende der Nextcloud-Themes', () => {
		expect(isDarkBackground('#ffffff')).toBe(false)
		expect(isDarkBackground('#171717')).toBe(true)
		// Kontrastreiches dunkles Theme
		expect(isDarkBackground('#000000')).toBe(true)
		expect(isDarkBackground('#fff')).toBe(false)
	})

	it('liest rgb() in beiden Schreibweisen und mit Alpha', () => {
		expect(isDarkBackground('rgb(23, 23, 23)')).toBe(true)
		expect(isDarkBackground('rgba(250, 250, 250, 0.9)')).toBe(false)
		expect(isDarkBackground('rgb(30 30 30 / 80%)')).toBe(true)
		expect(isDarkBackground('#171717ff')).toBe(true)
	})

	it('haelt Unlesbares fuer hell - wie ohne Dunkelmodus', () => {
		expect(isDarkBackground('')).toBe(false)
		expect(isDarkBackground('var(--x)')).toBe(false)
		expect(isDarkBackground(undefined)).toBe(false)
	})

	it('entscheidet ein mittleres Grau nach dem Kontrast, nicht nach der Haelfte', () => {
		// #777 hat mit Weiss 4,5:1, mit Schwarz 4,7:1 - schwarze Schrift liest
		// sich besser, der Grund gilt also als hell.
		expect(isDarkBackground('#777777')).toBe(false)
		expect(isDarkBackground('#666666')).toBe(true)
	})
})

describe('noteTheme.resolveNoteTheme', () => {
	it('folgt im Automatikmodus dem Theme', () => {
		expect(resolveNoteTheme('auto', true)).toBe('dark')
		expect(resolveNoteTheme('auto', false)).toBe('light')
	})

	it('uebersteuert das Theme mit einer festen Wahl', () => {
		expect(resolveNoteTheme('light', true)).toBe('light')
		expect(resolveNoteTheme('dark', false)).toBe('dark')
	})

	it('nimmt Unbekanntes als automatisch', () => {
		expect(normalizeNoteTheme('sepia')).toBe('auto')
		expect(resolveNoteTheme('sepia', true)).toBe('dark')
	})
})

describe('noteTheme.noteThemeCssVars', () => {
	it('setzt Grund und Schrift je Modus', () => {
		const hell = noteThemeCssVars('light', '#d32f2f')
		const dunkel = noteThemeCssVars('dark', '#d32f2f')
		expect(hell['--scoreview-page']).toBe('#ffffff')
		expect(hell['--scoreview-ink']).toBe('#000000')
		expect(isDarkBackground(dunkel['--scoreview-page'])).toBe(true)
		expect(isDarkBackground(dunkel['--scoreview-ink'])).toBe(false)
	})

	it('haelt die Stempelfarbe in beiden Modi lesbar (B3)', () => {
		for (const theme of ['light', 'dark']) {
			const vars = noteThemeCssVars(theme, '#d32f2f')
			expect(contrastRatio(parseCssColor(vars['--scoreview-stamp']), parseCssColor(vars['--scoreview-page']))).toBeGreaterThanOrEqual(4.5)
		}
	})

	it('laesst die Hervorhebung im hellen Modus unangetastet', () => {
		expect(noteThemeCssVars('light', '#7b1fa2')['--scoreview-highlight']).toBeUndefined()
	})

	it('haelt jede vorgeschlagene Hervorhebung im Dunkeln bei mindestens 3:1', () => {
		const dunkel = noteThemeCssVars('dark', '#000000')
		const grund = parseCssColor(dunkel['--scoreview-page'])
		for (const { color } of HIGHLIGHT_PRESETS) {
			const farbe = noteThemeCssVars('dark', color)['--scoreview-highlight']
			expect(contrastRatio(parseCssColor(farbe), grund)).toBeGreaterThanOrEqual(3)
		}
	})

	it('haelt die Loop-Flaggen in beiden Modi bei mindestens 3:1 zum Papier', () => {
		for (const theme of ['light', 'dark']) {
			const vars = noteThemeCssVars(theme, '#d32f2f')
			const papier = parseCssColor(vars['--scoreview-page'])
			expect(contrastRatio(parseCssColor(vars['--scoreview-loop-start']), papier)).toBeGreaterThanOrEqual(3)
			expect(contrastRatio(parseCssColor(vars['--scoreview-loop-end']), papier)).toBeGreaterThanOrEqual(3)
		}
	})

	it('haelt den Punkt einer eigenen Notiz in beiden Modi bei mindestens 3:1 zum Papier (A4-F3)', () => {
		for (const theme of ['light', 'dark']) {
			const vars = noteThemeCssVars(theme, '#d32f2f')
			expect(contrastRatio(parseCssColor(vars['--scoreview-marker']), parseCssColor(vars['--scoreview-page']))).toBeGreaterThanOrEqual(3)
		}
	})

	it('haelt jede Markerfarbe auf dem Papier in beiden Modi bei mindestens 3:1', () => {
		const marker = ['--scoreview-marker', '--scoreview-marker-shared', '--scoreview-marker-parts', '--scoreview-loop-start', '--scoreview-loop-end', '--scoreview-stamp']
		for (const theme of ['light', 'dark']) {
			// Das Theme darf daran nichts aendern - gekreuzt wie gleichsinnig.
			for (const uiDark of [false, true]) {
				const vars = noteThemeCssVars(theme, '#d32f2f', uiDark)
				const papier = parseCssColor(vars['--scoreview-page'])
				for (const name of marker) {
					expect({ theme, uiDark, name, ratio: contrastRatio(parseCssColor(vars[name]), papier) >= 3 })
						.toEqual({ theme, uiDark, name, ratio: true })
				}
			}
		}
	})

	it('haelt die drei Notizpunkte auseinander', () => {
		for (const theme of ['light', 'dark']) {
			const vars = noteThemeCssVars(theme, '#d32f2f')
			const farben = new Set([vars['--scoreview-marker'], vars['--scoreview-marker-shared'], vars['--scoreview-marker-parts']])
			expect(farben.size).toBe(3)
		}
	})

	it('richtet die Stempel der Leiste nach dem Theme, nicht nach den Noten', () => {
		// Grund der Leiste: --color-main-background der Nextcloud-Themes.
		const leiste = { false: parseCssColor('#ffffff'), true: parseCssColor('#171717') }
		for (const theme of ['light', 'dark']) {
			for (const uiDark of [false, true]) {
				const farbe = noteThemeCssVars(theme, '#d32f2f', uiDark)['--scoreview-ui-stamp']
				expect(contrastRatio(parseCssColor(farbe), leiste[uiDark])).toBeGreaterThanOrEqual(4.5)
			}
		}
	})

	it('nimmt ohne Angabe zum Theme dasselbe wie fuer die Noten an', () => {
		expect(noteThemeCssVars('dark', '#d32f2f')['--scoreview-ui-stamp']).toBe(noteThemeCssVars('dark', '#d32f2f')['--scoreview-stamp'])
		expect(noteThemeCssVars('light', '#d32f2f')['--scoreview-ui-stamp']).toBe(noteThemeCssVars('light', '#d32f2f')['--scoreview-stamp'])
	})

	it('unterscheidet die Hervorhebung weiter von der Notenschrift', () => {
		const vars = noteThemeCssVars('dark', '#d32f2f')
		expect(vars['--scoreview-highlight']).not.toBe(vars['--scoreview-ink'])
	})
})

describe('noteTheme.ensureContrast', () => {
	it('laesst eine Farbe mit genug Kontrast unveraendert', () => {
		expect(ensureContrast('#ffcc00', '#1c1c1c')).toBe('#ffcc00')
	})

	it('hellt eine zu dunkle Farbe nur so weit wie noetig auf', () => {
		const ergebnis = ensureContrast('#7b1fa2', '#1c1c1c')
		expect(ergebnis).not.toBe('#7b1fa2')
		expect(ergebnis).not.toBe('#ffffff')
		expect(contrastRatio(parseCssColor(ergebnis), parseCssColor('#1c1c1c'))).toBeGreaterThanOrEqual(3)
	})
})
