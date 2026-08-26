/**
 * Uebersetzt webmscores Ausgabe in die Artefaktform, die
 * Service\ConversionService cached und der Viewer erwartet - dieselbe Form,
 * die der Sidecar aus `--score-media` erzeugt (sidecar/scoreview_sidecar/
 * musescore.py, parse_pos_xml). Beide Konvertierungswege muessen sie
 * treffen, sonst zerfaellt das Cache-Format in zwei Varianten.
 *
 * Bewusst ohne webmscore-Import: reine Umformung, ohne Wasm testbar
 * (artifacts.test.mjs laeuft in `npm test` mit).
 */

/**
 * Der Sidecar rechnet spos/mpos-Koordinaten durch 12 (M4) und rundet auf
 * zwei Stellen. webmscores `savePositions` liefert sie bereits in
 * SVG-Einheiten - die Division entfaellt hier, die Rundung bleibt, damit
 * beide Wege gleich grosse Dateien mit gleich vielen Nachkommastellen
 * schreiben.
 *
 * @param {number} value
 * @return {number}
 */
const round2 = (value) => Math.round(value * 100) / 100

/**
 * @param {{elements?: Array<{id:number,page:number,x:number,y:number,sx:number,sy:number}>,
 *          events?: Array<{elid:number,position:number}>}} raw
 * @return {{events: Array<{elid:number,timeMs:number}>,
 *            elements: Record<string,{page:number,x:number,y:number,w:number,h:number}>}}
 */
export function toPositions(raw) {
	const elements = {}
	for (const el of raw?.elements ?? []) {
		elements[String(el.id)] = {
			page: el.page,
			x: round2(el.x),
			y: round2(el.y),
			// sx/sy heissen im Cache w/h - der Viewer liest ein Rechteck,
			// keine MuseScore-internen Feldnamen.
			w: round2(el.sx),
			h: round2(el.sy),
		}
	}

	// Nach Zeit sortiert wie beim Sidecar: timingSync.js sucht darin binaer
	// und setzt eine steigende Folge voraus. Wiederholungen sind bereits
	// ausgerollt (M7), dasselbe elid kommt also mehrfach vor - die Sortierung
	// muss stabil sein, damit die Reihenfolge gleicher Zeitpunkte erhalten
	// bleibt (in JS seit ES2019 zugesichert).
	const events = (raw?.events ?? [])
		.map((e) => ({ elid: e.elid, timeMs: e.position }))
		.sort((a, b) => a.timeMs - b.timeMs)

	// Schluesselreihenfolge wie im Sidecar (events vor elements), damit sich
	// die Ausgaben beider Wege direkt vergleichen lassen.
	return { events, elements }
}

/**
 * Die Zusagen aus docs/architecture.md, gegen ein Konvertierungsergebnis
 * geprueft - inhaltlich dieselbe Liste wie `check_promises` im Sidecar.
 * Dass es sie zweimal gibt, ist der Preis fuer zwei unabhaengige
 * Konvertierer: jeder muss fuer sich beantworten koennen, ob ein
 * MuseScore-Versionswechsel ihm den Boden weggezogen hat.
 *
 * @param {object} result Ergebnis einer Konvertierung
 * @param {number} result.pages Anzahl erzeugter SVG-Seiten
 * @param {object} result.timing timing.json in Cache-Form
 * @param {Uint8Array} result.midi
 * @param {object} result.meta meta.json in Cache-Form
 * @return {{problems: string[], details: object}}
 */
export function checkPromises({ pages, timing, midi, meta }) {
	const problems = []
	if (pages < 1) {
		problems.push('keine SVG-Seite geliefert')
	}
	if (!midi || midi.length === 0) {
		problems.push('kein MIDI geliefert')
	}
	if (!meta || Object.keys(meta).length === 0) {
		problems.push('keine Metadaten geliefert')
	}

	const events = timing?.events ?? []
	const elements = Object.keys(timing?.elements ?? {})
	if (events.length === 0) {
		problems.push('spos enthaelt keine Events')
	}
	if (elements.length === 0) {
		problems.push('spos enthaelt keine Elementkoordinaten')
	}

	// M7: Takt 1 der mitgelieferten Testpartitur wird wiederholt, sein elid
	// muss also MEHRFACH mit steigender Zeit vorkommen. Faellt das weg, ist
	// der Cursor bei Wiederholungen still falsch statt sichtbar kaputt.
	const counts = new Map()
	for (const e of events) {
		counts.set(e.elid, (counts.get(e.elid) ?? 0) + 1)
	}
	const repeated = [...counts.values()].filter((c) => c > 1).length
	if (repeated === 0) {
		problems.push('kein elid kommt mehrfach vor - Wiederholung wird nicht mehr ausgerollt (M7 verletzt)')
	}

	const times = events.map((e) => e.timeMs)
	if (times.some((t, i) => i > 0 && t < times[i - 1])) {
		problems.push('Event-Zeiten sind nicht monoton steigend')
	}

	return {
		problems,
		details: {
			pages,
			events: events.length,
			elements: elements.length,
			repeatedElids: repeated,
		},
	}
}
