#!/usr/bin/env node
/**
 * Konvertiert eine .mscz in genau die Artefakte, die
 * Service\ConversionService cached: page-1.svg … page-N.svg, score.mid,
 * timing.json, measures.json, meta.json.
 *
 * Das ist der zweite Konvertierungsweg neben dem Sidecar (E3): dieselben
 * Artefakte, dieselbe HTTP-API der App darueber, nur ohne Container -
 * MuseScore 4.7.5 als WebAssembly, ausgefuehrt von der Node-Laufzeit des
 * Servers. Aufgerufen wird das hier ausschliesslich von
 * Service\LocalConverter.
 *
 * Aufruf:
 *   node convert.mjs [--fonts <verzeichnis>] <eingabe.mscz> <ausgabeverzeichnis>
 *   node convert.mjs [--fonts <verzeichnis>] --variant <key> --base <dir> <eingabe.mscz> <ausgabeverzeichnis>
 *   node convert.mjs [--fonts <verzeichnis>] --selftest
 *
 * With --variant it writes a display variant (docs/architecture.md E19)
 * instead: pages, timing.json, measures.json and a variant meta.json - no
 * MIDI, a variant plays the base's. --base is the base conversion's cache
 * directory, read only, to check the variant against it.
 *
 * Ergebnis geht als eine Zeile JSON nach stdout, Fehler als Klartext nach
 * stderr mit Exitcode != 0. Kein Lograuschen auf stdout: Engine- und
 * Emscripten-Meldungen landen dort (M3 beim Sidecar, hier dasselbe Bild),
 * sie werden deshalb unten stillgelegt, bevor das Modul geladen wird.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { cpus } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { checkLyrics, checkMeters, checkPromises, checkScoreFacts, checkVariant, toPositions, toVariantMeta } from './lib/artifacts.mjs'
import { engineViewOptions, parseVariantKey } from './lib/variantKey.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * Ein `navigator` fuer Node 18/20, wo es global noch keines gibt (ab 21
 * bringt Node eines mit). Die Engine liest es nicht, aber so findet der
 * Emscripten-Glue unter jeder unterstuetzten Node-Version dieselbe Umgebung
 * vor. Kostet nichts und laesst ein vorhandenes `navigator` unangetastet -
 * steht deshalb vor dem Engine-Import.
 */
if (globalThis.navigator?.languages === undefined) {
	Object.defineProperty(globalThis, 'navigator', {
		value: {
			hardwareConcurrency: cpus().length,
			language: 'en-US',
			languages: ['en-US'],
			platform: `${process.platform} ${process.arch}`,
			userAgent: `Node.js/${process.versions.node}`,
		},
		writable: true,
		configurable: true,
	})
}

// Engine-Logs (kors-Logger, per Voreinstellung still) und Emscripten-Meldungen
// gehen ueber stdout. Solche Zeilen wuerden das JSON-Ergebnis unbrauchbar
// machen, deshalb wandern sie nach stderr - dort sind sie fuer die
// Fehlersuche noch da (LocalConverter legt stderr ins Nextcloud-Log, wenn
// die Konvertierung scheitert).
const stdoutWrite = process.stdout.write.bind(process.stdout)
process.stdout.write = (chunk, ...rest) => process.stderr.write(chunk, ...rest)

// Die Qt-freie scoreview-engine. Benutzt wird davon genau diese Oberflaeche:
// load (mit Zusatzfonts), npages, saveSvg, saveMidi, savePositions, metadata -
// and for a variant setExcerptId, generateExcerpts, applyView, viewMapping.
const { default: Engine } = await import('scoreview-engine')

/** Dateiendungen, die MuseScores Fontengine liest. */
const FONT_ENDUNGEN = /\.(woff2?|otf|ttf|ttc)$/i

/**
 * Zusatzfonts fuer chinesische, japanische und koreanische Liedtexte. Ohne sie
 * setzt MuseScore solche Texte als Ersatzkaestchen - alles andere bleibt
 * unberuehrt.
 *
 * Zwei Quellen, in dieser Reihenfolge:
 *
 * 1. **Ein Verzeichnis ausserhalb der App**, uebergeben per `--fonts` (die
 *    Einstellung `cjk_font_dir`, siehe Service\LocalConverter). Das ist der
 *    vorgesehene Weg - und zwar nicht aus Geschmack: Das ausgelieferte
 *    App-Verzeichnis ist SIGNIERT. Wer dort Dateien hineinlegt, holt sich in
 *    Nextclouds Integritaetspruefung eine dauerhafte Warnung.
 * 2. Das Paket `@librescore/fonts`, falls jemand es danebengelegt hat. Im
 *    Auslieferungspaket ist es NICHT enthalten: Es wiegt 4,2 MB, und der App
 *    Store nimmt Archive nur bis 30 MiB an, von denen das Paket schon rund
 *    21 MB belegt.
 *
 * @param {?string} fontVerzeichnis
 * @return {Promise<Uint8Array[]>}
 */
async function loadFonts(fontVerzeichnis) {
	if (fontVerzeichnis) {
		try {
			return readdirSync(fontVerzeichnis)
				.filter((name) => FONT_ENDUNGEN.test(name))
				.sort()
				.map((name) => readFileSync(join(fontVerzeichnis, name)))
		} catch (error) {
			// Ein ausdruecklich eingetragenes Verzeichnis, das nicht lesbar
			// ist, ist ein Konfigurationsfehler und kein Grund, still ohne
			// Fonts weiterzumachen.
			throw new Error(`Font directory ${fontVerzeichnis} not readable: ${error.message}`, { cause: error })
		}
	}
	try {
		// Synchronous on purpose, like every file access in this module.
		// Once the engine runs, an asynchronous one stalls: measured under
		// Node 20 in the test container, an `await import()` or
		// `fs.promises.readFile` after Engine.ready took 18-24 s instead of
		// milliseconds (a larger UV_THREADPOOL_SIZE did not help), and the
		// conversion with it.
		const fonts = createRequire(import.meta.url)('@librescore/fonts')
		return [readFileSync(fonts.CN), readFileSync(fonts.KR)]
	} catch (error) {
		// Nicht installiert ist der Normalfall und bleibt still. Alles andere
		// - eine kaputte Datei, ein Rechteproblem - waere sonst unsichtbar:
		// Die Konvertierung gelingt ja, nur die Liedtexte sind Kaestchen.
		if (error?.code !== 'MODULE_NOT_FOUND') {
			process.stderr.write(`Additional fonts could not be loaded: ${error?.message ?? error}\n`)
		}
		return []
	}
}

/**
 * Welches MuseScore hier steckt.
 *
 * Zur Laufzeit ist das nicht vollstaendig zu erfahren: `Engine.version()`
 * liefert die MSCZ-DATEIFORMATversion (470), und das package.json des
 * Engine-Pakets nennt nur den MuseScore-Kern (4.7.5), nicht den Build der
 * Engine - zwei Builds desselben Kerns tragen dieselbe Nummer. Die
 * vollstaendige Angabe ist deshalb der Release-Tag, auf den die Abhaengigkeit
 * hier zeigt - eine Stelle, dieselbe, die auch bestimmt, was installiert wird.
 */
async function museScoreVersion() {
	const own = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'))
	const tag = /\/download\/v?([^/]+)\//.exec(own.dependencies?.['scoreview-engine'] ?? '')?.[1]
	const formatVersion = await Engine.version()
	// Ohne fuehrendes "MuseScore": die Oberflaeche setzt es davor
	// (siehe AdminSettings.vue), sonst stuende dort beides.
	return `${tag ?? 'unknown'} (scoreview-engine, file format ${formatVersion})`
}

/**
 * @param {string} msczPath
 * @param {?string} fontVerzeichnis
 * @return {Promise<{pages: string[], midi: Uint8Array, timing: object, measures: object, meta: object}>}
 */
async function convert(msczPath, fontVerzeichnis) {
	await Engine.ready
	const score = await Engine.load('mscz', readFileSync(msczPath), await loadFonts(fontVerzeichnis))

	const pageCount = await score.npages()
	if (pageCount < 1) {
		throw new Error('The engine returned no SVG page.')
	}

	const pages = []
	for (let i = 0; i < pageCount; i++) {
		// Ohne den Parameter fuer den Hintergrund - die Engine malt trotzdem
		// einen deckend weissen Pfad ueber die volle viewBox, wie MuseScore
		// im Sidecar (M9), nur ohne class-Attribut. Das ist nicht schaedlich,
		// aber auch nicht wegzuschalten: Der Cursor liegt HINTER dem SVG, und
		// der Viewer nimmt deshalb beide Schreibweisen dieses einen Pfades auf
		// fill:none zurueck (ScorePage.vue). Wird der Pfad hier je entbehrlich,
		// gilt weiterhin: das Papierweiss kommt aus dem CSS der Seite.
		pages.push(await score.saveSvg(i))
	}

	const result = {
		pages,
		midi: await score.saveMidi(),
		timing: toPositions(JSON.parse(await score.savePositions(true))),
		measures: toPositions(JSON.parse(await score.savePositions(false))),
		meta: await score.metadata(),
	}

	// Kein score.destroy(): dieser Prozess konvertiert genau eine Partitur (der
	// Selbsttest zwei winzige) und endet danach, der Prozessabbau gibt die Wasm-Instanz samt Heap frei. Wer
	// hier je mehrere Partituren nacheinander laedt, braucht den Aufruf - mit
	// ihm bleibt der Speicher flach (gemessen: fuenf Durchlaeufe, rund 105 MB
	// unveraendert), ohne ihn waechst er je Partitur.
	return result
}

/**
 * One display variant of a score (E19). The same engine as convert(), one
 * load per variant: applyView() edits the loaded score and nothing takes the
 * edit back, so a second variant needs a fresh load - which is what this
 * process gets anyway.
 *
 * @param {string} msczPath
 * @param {string} key canonical variant key (lib/variantKey.mjs)
 * @param {?string} fontVerzeichnis
 * @return {Promise<{pages: string[], timing: object, measures: object, meta: object}>}
 */
async function convertVariant(msczPath, key, fontVerzeichnis) {
	const variant = parseVariantKey(key)
	if (!variant) {
		throw new Error(`Not a variant key: ${key}`)
	}
	await Engine.ready
	const score = await Engine.load('mscz', readFileSync(msczPath), await loadFonts(fontVerzeichnis))

	if (variant.source.kind === 'ex') {
		const stored = (await score.metadata()).excerpts ?? []
		if (variant.source.index >= stored.length) {
			throw new Error(`The score has no stored part ${variant.source.index} (it has ${stored.length}).`)
		}
		await score.setExcerptId(variant.source.index)
	} else if (variant.source.kind === 'part') {
		const [id] = await score.generateExcerpts([variant.source.partId])
		await score.setExcerptId(id)
	}
	await score.applyView(engineViewOptions(variant))

	const pageCount = await score.npages()
	if (pageCount < 1) {
		throw new Error('The engine returned no SVG page.')
	}
	const pages = []
	for (let i = 0; i < pageCount; i++) {
		pages.push(await score.saveSvg(i))
	}
	return {
		pages,
		timing: toPositions(JSON.parse(await score.savePositions(true))),
		// Measures numbered as the full score numbers them (I2): a part's
		// multimeasure rest stands for every measure it covers.
		measures: toPositions(JSON.parse(await score.savePositions(false, true))),
		meta: toVariantMeta(await score.metadata(), await score.viewMapping(), key),
	}
}

/**
 * @param {string} baseDir cache directory of the base conversion
 * @return {{timing: object, measures: object}}
 */
function readBase(baseDir) {
	return {
		timing: JSON.parse(readFileSync(join(baseDir, 'timing.json'), 'utf8')),
		measures: JSON.parse(readFileSync(join(baseDir, 'measures.json'), 'utf8')),
	}
}

function writeArtifacts(outDir, { pages, midi, timing, measures, meta }) {
	mkdirSync(outDir, { recursive: true })
	pages.forEach((svg, i) => writeFileSync(join(outDir, `page-${i + 1}.svg`), svg))
	if (midi) {
		writeFileSync(join(outDir, 'score.mid'), midi)
	}
	writeFileSync(join(outDir, 'timing.json'), JSON.stringify(timing))
	writeFileSync(join(outDir, 'measures.json'), JSON.stringify(measures))
	writeFileSync(join(outDir, 'meta.json'), JSON.stringify(meta))
}

/**
 * The self-test's variant check (see --selftest). parts-test.mscz has the
 * stored parts "Sopran" and "Frauenstimmen" (Sopran + Alt), a clarinet in B
 * flat (part id 3) with an eight-measure rest, and starts in F major.
 *
 * @param {?string} fontVerzeichnis
 * @return {Promise<{problems: string[], details: object}>}
 */
async function checkViews(fontVerzeichnis) {
	const problems = []
	const details = {}
	const path = join(HERE, 'parts-test.mscz')
	const base = await convert(path, fontVerzeichnis)

	const stored = base.meta.excerpts ?? []
	if (stored.map((e) => e.name).join('|') !== 'Sopran|Frauenstimmen') {
		problems.push(`meta.json lists stored parts ${JSON.stringify(stored.map((e) => e.name))}, expected Sopran and Frauenstimmen`)
	}
	if (base.meta.hasTransposingParts !== true) {
		problems.push('meta.json does not see the transposing clarinet (hasTransposingParts)')
	}

	const expect = {
		'ex1~orig~w~0': { staffMap: [0, 1] },
		'part3~phone~w~-2': { staffMap: [2], concertKey: -3 },
		'full~orig~c~0': { staffMap: [0, 1, 2, 3, 4] },
	}
	for (const [key, want] of Object.entries(expect)) {
		const variant = await convertVariant(path, key, fontVerzeichnis)
		const result = checkVariant(base, { ...variant, svgs: variant.pages })
		problems.push(...result.problems.map((p) => `${key}: ${p}`))
		if (JSON.stringify(variant.meta.staffMap) !== JSON.stringify(want.staffMap)) {
			problems.push(`${key}: staffMap ${JSON.stringify(variant.meta.staffMap)}, expected ${JSON.stringify(want.staffMap)}`)
		}
		// F major (-1) a whole tone lower is E flat major (-3): the
		// transposition reached the notation, not just the sound.
		if (want.concertKey !== undefined && variant.meta.keySigs?.[0]?.concertKey !== want.concertKey) {
			problems.push(`${key}: key ${variant.meta.keySigs?.[0]?.concertKey}, expected ${want.concertKey}`)
		}
		details[key] = result.details
	}
	return { problems, details }
}

async function main() {
	const args = process.argv.slice(2)

	// `--fonts <verzeichnis>` steht vor den Stellungsargumenten und wird hier
	// herausgeschnitten, damit die Zaehlung darunter unberuehrt bleibt.
	let fontVerzeichnis = null
	const fontsAn = args.indexOf('--fonts')
	if (fontsAn !== -1) {
		fontVerzeichnis = args[fontsAn + 1] ?? null
		args.splice(fontsAn, fontVerzeichnis === null ? 1 : 2)
		if (!fontVerzeichnis) {
			throw new Error('--fonts expects a directory.')
		}
	}

	// `--variant <key> --base <dir>`, cut out like --fonts.
	let variantKey = null
	let baseDir = null
	for (const flag of ['--variant', '--base']) {
		const at = args.indexOf(flag)
		if (at === -1) {
			continue
		}
		const value = args[at + 1] ?? null
		args.splice(at, value === null ? 1 : 2)
		if (!value) {
			throw new Error(`${flag} expects a value.`)
		}
		if (flag === '--variant') {
			variantKey = value
		} else {
			baseDir = value
		}
	}
	if ((variantKey === null) !== (baseDir === null)) {
		throw new Error('--variant and --base go together.')
	}

	if (args[0] === '--selftest') {
		// Gegenstueck zu GET /selftest des Sidecars: eine echte Konvertierung
		// der mitgelieferten Minipartitur, geprueft auf dieselben Zusagen.
		// Antwortform absichtlich identisch, damit die Admin-Seite fuer beide
		// Wege dieselbe Anzeige benutzt.
		const started = performance.now()
		const converted = await convert(join(HERE, 'selftest-score.mscz'), fontVerzeichnis)
		const seconds = Math.round((performance.now() - started) / 100) / 10
		const { problems, details } = checkPromises({
			pages: converted.pages.length,
			timing: converted.timing,
			midi: converted.midi,
			meta: converted.meta,
			// Die Seiten selbst, nicht nur ihre Zahl: ohne sie ist M10 nicht
			// pruefbar (siehe checkPromises).
			svgs: converted.pages,
		})
		// Zweite, ebenso selbst erstellte Partitur fuer die Partiturfakten der
		// Engine (Tonarten mit Dur/Moll, Studierbuchstaben). Nur meta.json wird
		// gebraucht; die Engine ist schon geladen, der Lauf kostet deshalb
		// wenig. Eine eigene Datei statt einer erweiterten selftest-score.mscz:
		// Die ist zugleich die Partitur des Sidecar-Selbsttests, und der laeuft
		// auf Stock-MuseScore, das diese Felder nicht kennt.
		const fakten = checkScoreFacts((await convert(join(HERE, 'keys-marks-test.mscz'), fontVerzeichnis)).meta)
		problems.push(...fakten.problems)
		// Dritte: Liedtext und Schreibweisen (E15), mit Seiten und Timing,
		// denn geprueft wird, dass sie auf dieselben Kennungen zeigen.
		const mitText = await convert(join(HERE, 'lyrics-test.mscz'), fontVerzeichnis)
		const text = checkLyrics({ meta: mitText.meta, timing: mitText.timing, svgs: mitText.pages })
		problems.push(...text.problems)
		// Fourth: the time signature per measure (E12), on a score whose
		// measures a guess from the duration gets wrong - a pickup, 3/4, 6/8.
		const meters = checkMeters((await convert(join(HERE, 'timesig-test.mscz'), fontVerzeichnis)).meta)
		problems.push(...meters.problems)
		// Fifth: display variants (E19) on a score with stored parts, a
		// transposing instrument and a multimeasure rest - a stored part, a
		// generated one on a phone page a tone lower, the full score in
		// concert pitch. Each against the base, on the four invariants.
		const views = await checkViews(fontVerzeichnis)
		problems.push(...views.problems)
		stdoutWrite(JSON.stringify({
			ok: problems.length === 0,
			error: problems.length > 0 ? problems.join('; ') : null,
			problems,
			details: { musescoreVersion: await museScoreVersion(), seconds, ...details, scoreFacts: fakten.details, lyrics: text.details, meters: meters.details, views: views.details },
		}) + '\n')
		return
	}

	if (args.length !== 2) {
		throw new Error('Usage: convert.mjs [--fonts <directory>] [--variant <key> --base <directory>] <input.mscz> <output-directory> | --selftest')
	}
	const [input, outDir] = args

	if (variantKey !== null) {
		const variant = await convertVariant(resolve(input), variantKey, fontVerzeichnis)
		// A variant that breaks an invariant is not written: the server
		// would cache it, and every reader would get a cursor and notes in
		// the wrong place.
		const { problems } = checkVariant(readBase(resolve(baseDir)), { ...variant, svgs: variant.pages })
		if (problems.length > 0) {
			throw new Error(`Variant ${variantKey} fails its invariants: ${problems.join('; ')}`)
		}
		writeArtifacts(resolve(outDir), variant)
		stdoutWrite(JSON.stringify({ variant: variantKey, pages: variant.pages.length }) + '\n')
		return
	}
	const converted = await convert(resolve(input), fontVerzeichnis)
	writeArtifacts(resolve(outDir), converted)

	stdoutWrite(JSON.stringify({
		pages: converted.pages.length,
		measures: converted.meta?.measures ?? null,
		mscoreVersion: converted.meta?.mscoreVersion ?? null,
	}) + '\n')
}

try {
	await main()
	// Ohne das bleibt der Prozess haengen: die Wasm-Instanz haelt Timer und
	// den Audio-Thread der Engine offen, und ohne destroy() (siehe oben)
	// gibt sie die nie wieder her.
	process.exit(0)
} catch (error) {
	process.stderr.write(String(error?.stack ?? error) + '\n')
	process.exit(1)
}
