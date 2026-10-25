// Der Ablauf einer Konvertierung im Browser - ohne DOM, ohne Netz, ohne
// Engine. Alles Unreine wird hereingereicht (`fetchSource`, `loadEngine`),
// damit genau die Dinge prüfbar bleiben, die hier schiefgehen können:
// Reihenfolge der Engine-Aufrufe, Größenschranke, Zeitgrenzen und die
// Übersetzung eines Fehlschlags in einen Code.
//
// **Warum die Reihenfolge zählt.** Sie ist dieselbe wie in
// `converter/convert.mjs::convert()`, und die Umformung macht mit
// `toPositions()` sogar dasselbe Modul. Nur so sind die Artefakte aus dem
// Browser dieselben wie die vom Server - gemessen: timing/measures/meta Byte
// für Byte identisch.

import { checkVariant, toPositions, toVariantMeta } from '../../converter/lib/artifacts.mjs'
import { engineViewOptions, parseVariantKey } from '../../converter/lib/variantKey.mjs'

/** Partitur größer als das, was einem Gerät im Browser zuzumuten ist. */
export const CLIENT_TOO_LARGE = 'client_too_large'
/** Engine nicht ladbar oder nicht lauffähig (CSP, alter Browser, Abbruch). */
export const CLIENT_ENGINE_UNAVAILABLE = 'client_engine_unavailable'
/** Die Engine lief, kam aber mit dieser Partitur nicht zurecht. */
export const CONVERSION_FAILED = 'conversion_failed'

/**
 * Zeitgrenze für den Import des Engine-Glues.
 *
 * Klein, weil hier nur rund 48 KB übertragen werden (gemessen). Was länger
 * dauert, ist kein langsames Netz, sondern ein Fehler.
 */
export const ENGINE_IMPORT_TIMEOUT_MS = 30000

/**
 * Zeitgrenze für den Start der Engine samt Satz der Partitur.
 *
 * Hier fällt fast alles an: Der Worker lädt beim Instanziieren rund 7,3 MB
 * (Wasm plus Ressourcenpaket, gemessen über die Leitung), startet Wasm und
 * setzt die Partitur.
 *
 * **Diese Grenze ist kein Schutz vor langsamen Geräten, sondern vor
 * Schweigen**: Ein von der CSP blockierter `new Worker(blob:…)` wirft nicht
 * (gemessen 2026-09-03), es kommt allein eine `securitypolicyviolation` - und
 * der Aufruf wartet für immer auf die Antwort des nie gestarteten Workers.
 *
 * Deshalb großzügig statt scharf: Das Zielszenario ist der Probenraum mit
 * schlechtem WLAN (`docs/limits.md`), und dort sind 7,3 MB in einer Minute
 * nicht sicher. Ein Fehlalarm nähme der Nutzerin die Partitur ganz; die
 * verspätete Meldung im Schweigefall kostet sie nur Wartezeit - und sie
 * bekommt sie überhaupt erst durch diese Grenze.
 */
export const ENGINE_START_TIMEOUT_MS = 180000

/**
 * Zeitgrenze für die eigentliche Konvertierung. Großzügig gegenüber dem
 * Gemessenen (0,4-1,0 s auf dem Rechner, mehr auf einem Tablet) - sie soll
 * einen hängenden Lauf einfangen, nicht ein langsames Gerät bestrafen. Dieselbe
 * Haltung wie bei Service\LocalConverter.
 */
export const CONVERT_TIMEOUT_MS = 120000

export class ClientConversionError extends Error {
	/**
	 * @param {string} code einer der Codes oben - wird im Viewer übersetzt (E4)
	 * @param {string} message technisches Detail, unübersetzt
	 */
	constructor(code, message) {
		super(message)
		this.name = 'ClientConversionError'
		this.code = code
	}
}

/**
 * @param {Promise} promise
 * @param {number} ms
 * @param {string} code
 * @param {string} text
 * @return {Promise}
 */
async function withDeadline(promise, ms, code, text) {
	let timer = null
	try {
		return await Promise.race([
			promise,
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new ClientConversionError(code, text)), ms)
			}),
		])
	} finally {
		clearTimeout(timer)
	}
}

/**
 * Ein bereits codierter Fehler bleibt, wie er ist; alles andere bekommt den
 * angegebenen Code. Sonst verlöre eine Zeitüberschreitung ihren Code, nur weil
 * sie durch einen catch-Block läuft.
 *
 * @param {unknown} fehler
 * @param {string} code
 * @return {ClientConversionError}
 */
function alsClientFehler(fehler, code) {
	if (fehler instanceof ClientConversionError) {
		return fehler
	}
	return new ClientConversionError(code, fehler?.message ?? String(fehler))
}

/**
 * Konvertiert eine Partitur im Browser und liefert die Artefakte in
 * Cache-Form - dieselbe Form, die der Server ablegen würde.
 *
 * @param {object} deps
 * @param {() => Promise<Uint8Array>} deps.fetchSource holt die .mscz
 * @param {() => Promise<object>} deps.loadEngine liefert die Engine (Default-Export)
 * @param {number} [deps.maxBytes] 0 = keine Schranke
 * @param {(fortschritt: object) => void} [deps.onProgress]
 * @param {{import?: number, start?: number, convert?: number}} [deps.timeouts] nur für Tests
 * @return {Promise<{pages: string[], midi: Uint8Array, timing: object, measures: object, meta: object}>}
 */
export async function convertInBrowser({ fetchSource, loadEngine, maxBytes = 0, onProgress = () => {}, timeouts = {} }) {
	const grenze = {
		import: ENGINE_IMPORT_TIMEOUT_MS,
		start: ENGINE_START_TIMEOUT_MS,
		convert: CONVERT_TIMEOUT_MS,
		...timeouts,
	}

	onProgress({ phase: 'source' })
	const bytes = await fetchSource()

	// **Vor** dem Laden der Engine: Sonst lädt ein Tablet 14 MB, um danach
	// aufzugeben. Die Schranke kommt vom Server (`maxBytes` in der
	// client-Antwort), damit ein Betreiber sie kennt und ändern kann.
	if (maxBytes > 0 && bytes.byteLength > maxBytes) {
		throw new ClientConversionError(
			CLIENT_TOO_LARGE,
			`Score is ${bytes.byteLength} bytes, the limit is ${maxBytes}.`,
		)
	}

	return mitEngine({ bytes, loadEngine, grenze, onProgress }, (score) => erzeugeArtefakte(score, onProgress))
}

/**
 * A display variant in the browser (docs/architecture.md E19) - the same
 * engine calls as `convertVariant()` in converter/convert.mjs, and the same
 * check against the base afterwards: a variant that breaks an invariant is
 * refused here as it is on the server, rather than shown with the cursor and
 * the notes in the wrong place.
 *
 * One load per variant, as there: applyView() edits the loaded score.
 *
 * @param {object} deps as convertInBrowser, plus
 * @param deps.fetchSource
 * @param deps.loadEngine
 * @param {string} deps.key canonical variant key
 * @param {{timing: object, measures: object}} deps.base the base conversion's artifacts
 * @param deps.maxBytes
 * @param deps.onProgress
 * @param deps.timeouts
 * @return {Promise<{pages: string[], timing: object, measures: object, meta: object}>}
 */
export async function convertVariantInBrowser({ fetchSource, loadEngine, key, base, maxBytes = 0, onProgress = () => {}, timeouts = {} }) {
	const variant = parseVariantKey(key)
	if (!variant) {
		throw new ClientConversionError(CONVERSION_FAILED, `Not a variant key: ${key}`)
	}
	const grenze = {
		import: ENGINE_IMPORT_TIMEOUT_MS,
		start: ENGINE_START_TIMEOUT_MS,
		convert: CONVERT_TIMEOUT_MS,
		...timeouts,
	}
	onProgress({ phase: 'source' })
	const bytes = await fetchSource()
	if (maxBytes > 0 && bytes.byteLength > maxBytes) {
		throw new ClientConversionError(CLIENT_TOO_LARGE, `Score is ${bytes.byteLength} bytes, the limit is ${maxBytes}.`)
	}
	const artefakte = await mitEngine({ bytes, loadEngine, grenze, onProgress }, (score) => erzeugeVariante(score, variant, key, onProgress))
	const { problems } = checkVariant(base, { ...artefakte, svgs: artefakte.pages })
	if (problems.length > 0) {
		throw new ClientConversionError(CONVERSION_FAILED, `Variant ${key} fails its invariants: ${problems.join('; ')}`)
	}
	return artefakte
}

/**
 * Engine laden, Partitur setzen, `produce` laufen lassen, Engine abbauen -
 * der gemeinsame Rahmen beider Konvertierungen im Browser.
 *
 * @param {object} lauf
 * @param {Uint8Array} lauf.bytes
 * @param {() => Promise<object>} lauf.loadEngine
 * @param {{import: number, start: number, convert: number}} lauf.grenze
 * @param {(fortschritt: object) => void} lauf.onProgress
 * @param {(score: object) => Promise<object>} produce
 * @return {Promise<object>}
 */
async function mitEngine({ bytes, loadEngine, grenze, onProgress }, produce) {
	onProgress({ phase: 'engine' })
	let Engine
	try {
		Engine = await withDeadline(loadEngine(), grenze.import, CLIENT_ENGINE_UNAVAILABLE, 'Engine could not be loaded.')
	} catch (fehler) {
		throw alsClientFehler(fehler, CLIENT_ENGINE_UNAVAILABLE)
	}

	onProgress({ phase: 'layout' })
	let score
	try {
		// Hier entsteht der Worker, hier laedt er Wasm und Ressourcenpaket, und
		// hier zeigt sich eine blockierende CSP (siehe
		// ENGINE_START_TIMEOUT_MS). Derselbe Code wie beim Import: Fuer die
		// Nutzerin ist beides "die Engine laeuft nicht", und beides ist an
		// derselben Stelle zu beheben.
		score = await withDeadline(
			Engine.load('mscz', bytes, []),
			grenze.start,
			CLIENT_ENGINE_UNAVAILABLE,
			'The engine did not accept the score.',
		)
	} catch (fehler) {
		throw alsClientFehler(fehler, CONVERSION_FAILED)
	}

	try {
		return await withDeadline(
			produce(score),
			grenze.convert,
			CONVERSION_FAILED,
			'The conversion did not finish in time.',
		)
	} catch (fehler) {
		throw alsClientFehler(fehler, CONVERSION_FAILED)
	} finally {
		// `false` = den ganzen Worker abbauen, nicht nur die Partitur.
		// Anders als in convert.mjs, wo der Prozess ohnehin endet: Hier lebt
		// die Seite weiter, und ohne den Abbau wächst der Speicher je
		// geöffneter Partitur.
		try {
			await score.destroy(false)
		} catch {
			// Ein gescheiterter Abbau darf eine gelungene Konvertierung nicht
			// zunichtemachen - die Wasm-Instanz ist dann ohnehin verloren.
		}
	}
}

/**
 * @param {object} score
 * @param {(fortschritt: object) => void} onProgress
 * @return {Promise<object>}
 */
async function erzeugeArtefakte(score, onProgress) {
	const pageCount = await score.npages()
	if (pageCount < 1) {
		throw new ClientConversionError(CONVERSION_FAILED, 'The engine returned no SVG page.')
	}

	const pages = []
	for (let i = 0; i < pageCount; i++) {
		onProgress({ phase: 'pages', page: i + 1, of: pageCount })
		pages.push(await score.saveSvg(i))
	}

	const artefakte = {
		pages,
		midi: await score.saveMidi(),
		timing: toPositions(JSON.parse(await score.savePositions(true))),
		measures: toPositions(JSON.parse(await score.savePositions(false))),
		meta: await score.metadata(),
	}
	onProgress({ phase: 'done' })
	return artefakte
}

/**
 * @param {object} score
 * @param {object} variant parsed key (converter/lib/variantKey.mjs)
 * @param {string} key
 * @param {(fortschritt: object) => void} onProgress
 * @return {Promise<object>}
 */
async function erzeugeVariante(score, variant, key, onProgress) {
	if (variant.source.kind === 'ex') {
		const stored = (await score.metadata()).excerpts ?? []
		if (variant.source.index >= stored.length) {
			throw new ClientConversionError(CONVERSION_FAILED, `The score has no stored part ${variant.source.index}.`)
		}
		await score.setExcerptId(variant.source.index)
	} else if (variant.source.kind === 'part') {
		const [id] = await score.generateExcerpts([variant.source.partId])
		await score.setExcerptId(id)
	}
	await score.applyView(engineViewOptions(variant))

	const pageCount = await score.npages()
	if (pageCount < 1) {
		throw new ClientConversionError(CONVERSION_FAILED, 'The engine returned no SVG page.')
	}
	const pages = []
	for (let i = 0; i < pageCount; i++) {
		onProgress({ phase: 'pages', page: i + 1, of: pageCount })
		pages.push(await score.saveSvg(i))
	}
	const artefakte = {
		pages,
		timing: toPositions(JSON.parse(await score.savePositions(true))),
		measures: toPositions(JSON.parse(await score.savePositions(false, true))),
		meta: toVariantMeta(await score.metadata(), await score.viewMapping(), key),
	}
	onProgress({ phase: 'done' })
	return artefakte
}
