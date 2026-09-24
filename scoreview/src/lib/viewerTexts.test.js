import { describe, expect, it } from 'vitest'
import { conversionProgressText, rendererText } from './viewerTexts.js'

// Gibt den Quellstring mit eingesetzten Variablen zurueck - so prueft der
// Test die Auswahl, nicht die Uebersetzung.
const t = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, key) => String(vars[key]))

describe('rendererText', () => {
	it('nennt jeden bekannten Weg', () => {
		expect(rendererText('local', t)).toBe('scoreview-engine on this server (MuseScore as WebAssembly)')
		expect(rendererText('sidecar', t)).toBe('Sidecar container (MuseScore 4)')
		expect(rendererText('client', t)).toBe('this browser (MuseScore as WebAssembly)')
	})

	it('sagt bei fehlender Aufzeichnung ehrlich "unbekannt"', () => {
		expect(rendererText(null, t)).toBe('Unknown – converted by an earlier version of the app.')
		expect(rendererText('something-new', t)).toBe('Unknown – converted by an earlier version of the app.')
	})

	it('faellt nicht auf Eigenschaften von Object.prototype herein', () => {
		expect(rendererText('toString', t)).toBe('Unknown – converted by an earlier version of the app.')
	})
})

describe('conversionProgressText', () => {
	it('bleibt serverseitig leer, bis die Frist verstrichen ist', () => {
		expect(conversionProgressText(null, false, t)).toBe('')
		expect(conversionProgressText(null, true, t)).toMatch(/^This is taking longer than usual\./)
	})

	it('nennt die Stufe der Konvertierung im Browser', () => {
		expect(conversionProgressText({ phase: 'source' }, false, t)).toBe('Loading score…')
		expect(conversionProgressText({ phase: 'engine' }, false, t)).toBe('Loading the conversion engine (about 14 MB, once per browser)…')
		expect(conversionProgressText({ phase: 'layout' }, false, t)).toBe('Laying out the score…')
		expect(conversionProgressText({ phase: 'pages', page: 2, of: 5 }, false, t)).toBe('Page 2 of 5')
	})

	it('zeigt im Browser den Hinweis auf Cron nie - dort gibt es keinen Hintergrundjob', () => {
		expect(conversionProgressText({ phase: 'layout' }, true, t)).toBe('Laying out the score…')
	})

	it('bleibt bei einer unbekannten Stufe leer', () => {
		expect(conversionProgressText({ phase: 'done' }, false, t)).toBe('')
		expect(conversionProgressText({ phase: 'constructor' }, false, t)).toBe('')
	})
})
