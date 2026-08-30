import { describe, expect, it } from 'vitest'
import {
	DEFAULT_HIGHLIGHT_COLOR,
	HIGHLIGHT_MODE_BAR,
	HIGHLIGHT_MODE_NOTES,
	HIGHLIGHT_PRESETS,
	highlightCssVars,
	normalizeHighlightColor,
	normalizeHighlightMode,
} from './highlightStyle.js'

describe('normalizeHighlightColor', () => {
	it('nimmt eine Vollform und schreibt sie klein', () => {
		expect(normalizeHighlightColor('#AB12EF')).toBe('#ab12ef')
	})

	it('schreibt die Kurzform aus', () => {
		expect(normalizeHighlightColor('#abc')).toBe('#aabbcc')
	})

	it('faellt auf die Vorgabe zurueck, was auch immer sonst kommt', () => {
		// Der Wert landet unveraendert in einem style-Attribut - alles, was
		// keine Farbe ist, darf dort gar nicht erst ankommen.
		for (const unsinn of ['red', '#12345', '#fff;background:url(x)', '', null, undefined, 42]) {
			expect(normalizeHighlightColor(unsinn)).toBe(DEFAULT_HIGHLIGHT_COLOR)
		}
	})

	it('laesst jede Vorgabefarbe unveraendert', () => {
		for (const preset of HIGHLIGHT_PRESETS) {
			expect(normalizeHighlightColor(preset.color)).toBe(preset.color)
		}
	})
})

describe('normalizeHighlightMode', () => {
	it('kennt nur die beiden Modi', () => {
		expect(normalizeHighlightMode('bar')).toBe(HIGHLIGHT_MODE_BAR)
		expect(normalizeHighlightMode('notes')).toBe(HIGHLIGHT_MODE_NOTES)
		expect(normalizeHighlightMode('irgendwas')).toBe(HIGHLIGHT_MODE_NOTES)
		expect(normalizeHighlightMode(undefined)).toBe(HIGHLIGHT_MODE_NOTES)
	})
})

describe('highlightCssVars', () => {
	it('macht aus einer Wahl die volle Farbe und die durchscheinende Bandfarbe', () => {
		expect(highlightCssVars('#d32f2f')).toEqual({
			'--scoreview-highlight': '#d32f2f',
			'--scoreview-highlight-band': 'rgba(211, 47, 47, 0.32)',
		})
	})

	it('normalisiert auch hier, statt Unsinn durchzureichen', () => {
		expect(highlightCssVars('javascript:alert(1)')['--scoreview-highlight']).toBe(DEFAULT_HIGHLIGHT_COLOR)
	})
})
