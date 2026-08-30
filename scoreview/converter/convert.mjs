#!/usr/bin/env node
/**
 * Konvertiert eine .mscz in genau die Artefakte, die
 * Service\ConversionService cached: page-1.svg … page-N.svg, score.mid,
 * timing.json, measures.json, meta.json.
 *
 * Das ist der zweite Konvertierungsweg neben dem Sidecar (E3): dieselben
 * Artefakte, dieselbe HTTP-API der App darueber, nur ohne Container -
 * MuseScore 4.7.4 als WebAssembly, ausgefuehrt von der Node-Laufzeit des
 * Servers. Aufgerufen wird das hier ausschliesslich von
 * Service\LocalConverter.
 *
 * Aufruf:
 *   node convert.mjs [--fonts <verzeichnis>] <eingabe.mscz> <ausgabeverzeichnis>
 *   node convert.mjs [--fonts <verzeichnis>] --selftest
 *
 * Ergebnis geht als eine Zeile JSON nach stdout, Fehler als Klartext nach
 * stderr mit Exitcode != 0. Kein Lograuschen auf stdout: Engine- und
 * Emscripten-Meldungen landen dort (M3 beim Sidecar, hier dasselbe Bild),
 * sie werden deshalb unten stillgelegt, bevor das Modul geladen wird.
 */

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { cpus } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'
import { checkPromises, toPositions } from './lib/artifacts.mjs'

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
// load (mit Zusatzfonts), npages, saveSvg, saveMidi, savePositions, metadata.
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
 *    Store nimmt Archive nur bis 20 MB an.
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
			throw new Error(`Font-Verzeichnis ${fontVerzeichnis} nicht lesbar: ${error.message}`, { cause: error })
		}
	}
	try {
		const fonts = await import('@librescore/fonts')
		return [readFileSync(fonts.CN), readFileSync(fonts.KR)]
	} catch (error) {
		// Nicht installiert ist der Normalfall und bleibt still. Alles andere
		// - eine kaputte Datei, ein Rechteproblem - waere sonst unsichtbar:
		// Die Konvertierung gelingt ja, nur die Liedtexte sind Kaestchen.
		if (error?.code !== 'ERR_MODULE_NOT_FOUND') {
			process.stderr.write(`Zusatzfonts nicht ladbar: ${error?.message ?? error}\n`)
		}
		return []
	}
}

/**
 * Welches MuseScore hier steckt.
 *
 * Zur Laufzeit ist das nicht vollstaendig zu erfahren: `Engine.version()`
 * liefert die MSCZ-DATEIFORMATversion (470), und das package.json des
 * Engine-Pakets nennt nur den MuseScore-Kern (4.7.4), nicht den Build der
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
	return `${tag ?? 'unbekannt'} (scoreview-engine, Dateiformat ${formatVersion})`
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
		throw new Error('Die Engine lieferte keine SVG-Seite.')
	}

	const pages = []
	for (let i = 0; i < pageCount; i++) {
		// Ohne Hintergrundpfad - die Engine malt grundsaetzlich keinen. Das
		// ist die richtige Form: Der Cursor liegt HINTER dem SVG, und das
		// Papierweiss kommt aus dem CSS der Seite (ScorePage.vue). Beim
		// Sidecar-Weg steht der weisse Pfad im SVG (M9); der Viewer schaltet
		// ihn per path[class=""] auf fill:none.
		pages.push(await score.saveSvg(i))
	}

	const result = {
		pages,
		midi: await score.saveMidi(),
		timing: toPositions(JSON.parse(await score.savePositions(true))),
		measures: toPositions(JSON.parse(await score.savePositions(false))),
		meta: await score.metadata(),
	}

	// Kein score.destroy(): dieser Prozess konvertiert genau eine Partitur und
	// endet danach, der Prozessabbau gibt die Wasm-Instanz samt Heap frei. Wer
	// hier je mehrere Partituren nacheinander laedt, braucht den Aufruf - mit
	// ihm bleibt der Speicher flach (gemessen: fuenf Durchlaeufe, rund 105 MB
	// unveraendert), ohne ihn waechst er je Partitur.
	return result
}

function writeArtifacts(outDir, { pages, midi, timing, measures, meta }) {
	mkdirSync(outDir, { recursive: true })
	pages.forEach((svg, i) => writeFileSync(join(outDir, `page-${i + 1}.svg`), svg))
	writeFileSync(join(outDir, 'score.mid'), midi)
	writeFileSync(join(outDir, 'timing.json'), JSON.stringify(timing))
	writeFileSync(join(outDir, 'measures.json'), JSON.stringify(measures))
	writeFileSync(join(outDir, 'meta.json'), JSON.stringify(meta))
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
			throw new Error('--fonts erwartet ein Verzeichnis.')
		}
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
		stdoutWrite(JSON.stringify({
			ok: problems.length === 0,
			error: problems.length > 0 ? problems.join('; ') : null,
			problems,
			details: { musescoreVersion: await museScoreVersion(), seconds, ...details },
		}) + '\n')
		return
	}

	if (args.length !== 2) {
		throw new Error('Aufruf: convert.mjs [--fonts <verzeichnis>] <eingabe.mscz> <ausgabeverzeichnis> | --selftest')
	}
	const [input, outDir] = args
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
