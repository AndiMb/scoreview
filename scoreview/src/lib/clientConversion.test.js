import { describe, expect, it, vi } from 'vitest'
import {
	CLIENT_ENGINE_UNAVAILABLE,
	CLIENT_TOO_LARGE,
	CONVERSION_FAILED,
	convertInBrowser,
	convertVariantInBrowser,
} from './clientConversion.js'

/**
 * Zwei Zusicherungen tragen diesen Weg, und beide sind hier prüfbar, ohne dass
 * eine Engine läuft:
 *
 * 1. **Die Reihenfolge der Engine-Aufrufe** ist dieselbe wie in
 *    `converter/convert.mjs`. Nur deshalb sind die Artefakte aus dem Browser
 *    dieselben wie die vom Server - eine Umstellung hier fiele sonst erst auf,
 *    wenn ein Cursor an der falschen Stelle steht.
 * 2. **Ein Hänger wird zum Fehler.** Ein von der CSP blockierter Worker wirft
 *    nicht, er schweigt (gemessen 2026-09-03). Ohne Zeitgrenze bliebe der
 *    Viewer für immer auf „wird konvertiert" stehen.
 */

/** Eine Engine, die mitschreibt, was in welcher Reihenfolge gerufen wurde. */
function engineAttrappe({ pages = 2, positions = null } = {}) {
	const rufe = []
	const rohePositionen = positions ?? {
		elements: [{ id: 7, page: 0, x: 10.005, y: 20, sx: 3, sy: 4 }],
		events: [{ elid: 7, position: 1500 }],
	}
	const merke = (was, ergebnis) => {
		rufe.push(was)
		return Promise.resolve(ergebnis)
	}
	const score = {
		npages: () => merke('npages', pages),
		saveSvg: (i) => merke(`saveSvg(${i})`, `<svg>${i}</svg>`),
		saveMidi: () => merke('saveMidi', new Uint8Array([1, 2])),
		savePositions: (ofSegments) => merke(`savePositions(${ofSegments})`, JSON.stringify(rohePositionen)),
		metadata: () => merke('metadata', { pages, measures: 4 }),
		destroy: (soft) => merke(`destroy(${soft})`, undefined),
	}
	return {
		rufe,
		engine: { load: (format) => merke(`load(${format})`, score) },
		score,
	}
}

const quelle = (bytes = 100) => () => Promise.resolve(new Uint8Array(bytes))

describe('convertInBrowser', () => {
	it('ruft die Engine in derselben Reihenfolge wie convert.mjs', async () => {
		const { rufe, engine } = engineAttrappe({ pages: 2 })
		await convertInBrowser({ fetchSource: quelle(), loadEngine: () => Promise.resolve(engine) })
		expect(rufe).toEqual([
			'load(mscz)',
			'npages',
			'saveSvg(0)',
			'saveSvg(1)',
			'saveMidi',
			// true = Segmente (timing), false = Takte (measures) - in dieser
			// Reihenfolge, wie in convert.mjs.
			'savePositions(true)',
			'savePositions(false)',
			'metadata',
			// false = den ganzen Worker abbauen. In convert.mjs unnötig, weil
			// dort der Prozess endet; hier lebt die Seite weiter.
			'destroy(false)',
		])
	})

	it('liefert die Positionen in Cache-Form, nicht roh', async () => {
		const { engine } = engineAttrappe()
		const artefakte = await convertInBrowser({ fetchSource: quelle(), loadEngine: () => Promise.resolve(engine) })
		// toPositions() aus converter/lib/artifacts.mjs - dasselbe Modul, das
		// der Node-Weg benutzt. Rohform hätte `position`/`id`, Cache-Form hat
		// `timeMs` und ein Objekt je Element.
		expect(artefakte.timing.events).toEqual([{ elid: 7, timeMs: 1500 }])
		expect(artefakte.timing.elements['7']).toEqual({ page: 0, x: 10.01, y: 20, w: 3, h: 4 })
	})

	it('bricht bei einer zu grossen Partitur ab, BEVOR es die Engine laedt', async () => {
		const loadEngine = vi.fn()
		await expect(convertInBrowser({
			fetchSource: quelle(2000),
			loadEngine,
			maxBytes: 1000,
		})).rejects.toMatchObject({ code: CLIENT_TOO_LARGE })
		// Der Sinn der Schranke: Sonst laedt ein Tablet 14 MB, um dann
		// aufzugeben.
		expect(loadEngine).not.toHaveBeenCalled()
	})

	it('laesst eine Partitur unterhalb der Schranke durch', async () => {
		const { engine } = engineAttrappe()
		const artefakte = await convertInBrowser({
			fetchSource: quelle(1000),
			loadEngine: () => Promise.resolve(engine),
			maxBytes: 1000,
		})
		expect(artefakte.pages).toHaveLength(2)
	})

	it('macht aus einer schweigenden Engine einen Fehler mit Code', async () => {
		await expect(convertInBrowser({
			fetchSource: quelle(),
			// So sieht ein von der CSP blockierter Worker aus: kein Fehler,
			// nur Stille.
			loadEngine: () => new Promise(() => {}),
			timeouts: { import: 5 },
		})).rejects.toMatchObject({ code: CLIENT_ENGINE_UNAVAILABLE })
	})

	it('macht aus einem schweigenden Satzlauf einen Fehler mit Code', async () => {
		const engine = { load: () => new Promise(() => {}) }
		await expect(convertInBrowser({
			fetchSource: quelle(),
			loadEngine: () => Promise.resolve(engine),
			timeouts: { start: 5 },
		})).rejects.toMatchObject({ code: CLIENT_ENGINE_UNAVAILABLE })
	})

	it('meldet eine Partitur ohne Seiten als Konvertierungsfehler', async () => {
		const { engine } = engineAttrappe({ pages: 0 })
		await expect(convertInBrowser({
			fetchSource: quelle(),
			loadEngine: () => Promise.resolve(engine),
		})).rejects.toMatchObject({ code: CONVERSION_FAILED })
	})

	it('baut die Engine auch dann ab, wenn die Konvertierung scheitert', async () => {
		// Ohne das bliebe nach jedem Fehlschlag ein Worker samt Wasm-Heap
		// stehen - und ein zweiter Versuch der Nutzerin waere der zweite.
		const { rufe, engine, score } = engineAttrappe()
		score.saveMidi = () => Promise.reject(new Error('kaputt'))
		await expect(convertInBrowser({
			fetchSource: quelle(),
			loadEngine: () => Promise.resolve(engine),
		})).rejects.toMatchObject({ code: CONVERSION_FAILED })
		expect(rufe).toContain('destroy(false)')
	})

	it('meldet den Fortschritt seitenweise', async () => {
		const { engine } = engineAttrappe({ pages: 2 })
		const stand = []
		await convertInBrowser({
			fetchSource: quelle(),
			loadEngine: () => Promise.resolve(engine),
			onProgress: (s) => stand.push(s),
		})
		expect(stand).toEqual([
			{ phase: 'source' },
			{ phase: 'engine' },
			{ phase: 'layout' },
			{ phase: 'pages', page: 1, of: 2 },
			{ phase: 'pages', page: 2, of: 2 },
			{ phase: 'done' },
		])
	})
})

/**
 * A display variant (E19): the engine calls of convertVariant() in
 * converter/convert.mjs, and the base check after them.
 */
describe('convertVariantInBrowser', () => {
	const base = {
		timing: { events: [{ elid: 7, timeMs: 1500 }], elements: {} },
		measures: { events: [{ elid: 7, timeMs: 1500 }], elements: { 7: { page: 0, x: 10.01, y: 20, w: 3, h: 4 } } },
	}

	function variantEngine({ mapping = { baseElid: { 7: 7 }, staffMap: [0] } } = {}) {
		const fake = engineAttrappe({ pages: 1 })
		const { score, rufe } = fake
		const merke = (was, ergebnis) => {
			rufe.push(was)
			return Promise.resolve(ergebnis)
		}
		score.savePositions = (ofSegments, ofMain = false) => merke(`savePositions(${ofSegments},${ofMain})`, JSON.stringify({
			elements: [{ id: 7, page: 0, x: 10.005, y: 20, sx: 3, sy: 4 }],
			events: [{ elid: 7, position: 1500 }],
		}))
		score.metadata = () => merke('metadata', { pages: 1, excerpts: [{ id: 0 }], parts: [{ id: '3', name: 'Kl' }], noteSpellings: [] })
		score.setExcerptId = (id) => merke(`setExcerptId(${id})`, undefined)
		score.generateExcerpts = (ids) => merke(`generateExcerpts(${ids.join(',')})`, [2])
		score.applyView = (o) => merke(`applyView(${o.format},${o.concertPitch},${o.transposeSemitones})`, 1)
		score.viewMapping = () => merke('viewMapping', mapping)
		// A page with one segment id on staff 0, so M10 and I4 have something to check.
		score.saveSvg = (i) => merke(`saveSvg(${i})`, '<svg><g class="Note seg-7 st-0 vc-0"></g></svg>')
		return fake
	}

	it('generates the part, applies the view, numbers measures as the base', async () => {
		const { rufe, engine } = variantEngine()
		const v = await convertVariantInBrowser({ fetchSource: quelle(), loadEngine: () => Promise.resolve(engine), key: 'part3~phone~w~-2', base })
		expect(rufe).toEqual([
			'load(mscz)',
			'generateExcerpts(3)',
			'setExcerptId(2)',
			'applyView(phone,null,-2)',
			'npages',
			'saveSvg(0)',
			'savePositions(true,false)',
			'savePositions(false,true)',
			'metadata',
			'viewMapping',
			'destroy(false)',
		])
		expect(v.meta.variant).toBe('part3~phone~w~-2')
		expect(v.meta.parts).toEqual([{ id: '3', name: 'Kl' }])
		expect(v.midi).toBeUndefined()
	})

	it('selects a stored part only if the score has it', async () => {
		const { engine } = variantEngine()
		await expect(convertVariantInBrowser({ fetchSource: quelle(), loadEngine: () => Promise.resolve(engine), key: 'ex1~orig~w~0', base }))
			.rejects.toMatchObject({ code: CONVERSION_FAILED })
	})

	it('refuses a variant that breaks an invariant', async () => {
		const { engine } = variantEngine({ mapping: { baseElid: {}, staffMap: [] } })
		await expect(convertVariantInBrowser({ fetchSource: quelle(), loadEngine: () => Promise.resolve(engine), key: 'full~phone~w~0', base }))
			.rejects.toThrow(/I3/)
	})

	it('refuses something that is no variant key', async () => {
		await expect(convertVariantInBrowser({ fetchSource: quelle(), loadEngine: () => Promise.reject(new Error('never')), key: 'full~orig~w~0', base }))
			.rejects.toMatchObject({ code: CONVERSION_FAILED })
	})
})
