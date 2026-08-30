/**
 * Uebersetzt die Ausgabe der Engine in die Artefaktform, die
 * Service\ConversionService cached und der Viewer erwartet - dieselbe Form,
 * die der Sidecar aus `--score-media` erzeugt (sidecar/scoreview_sidecar/
 * musescore.py, parse_pos_xml). Beide Konvertierungswege muessen sie
 * treffen, sonst zerfaellt das Cache-Format in zwei Varianten.
 *
 * Bewusst ohne Engine-Import: reine Umformung, ohne Wasm testbar
 * (artifacts.test.mjs laeuft in `npm test` mit).
 */

/**
 * Der Sidecar rechnet spos/mpos-Koordinaten durch 12 (M4) und rundet auf
 * zwei Stellen. `savePositions` der Engine liefert sie bereits in
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
 * Was eine SVG-Seite ueber die gezeichneten Segmente verraet (M10).
 *
 * Regulaere Ausdruecke auf SVG sind sonst ein Fehlgriff (siehe
 * lib/svgSanitizer.js im Frontend, wo genau das schiefging) - hier aber keine
 * Sicherheitsgrenze, sondern das Nachlesen der Ausgabe unseres eigenen
 * Generators, in einer Node-Umgebung ohne DOM.
 *
 * @param {string} svgText eine Seite
 * @return {{ids: Set<number>, notes: Array<{id: number, x: number}>}}
 *   `ids` alle vorkommenden Segmentkennungen, `notes` die Notenkoepfe mit der
 *   x-Koordinate ihres ersten Pfadpunkts.
 */
export function svgSegments(svgText) {
	const ids = new Set()
	const notes = []
	if (typeof svgText !== 'string') {
		return { ids, notes }
	}

	for (const treffer of svgText.matchAll(/class="([^"]*)"/g)) {
		const kennung = /\bseg-(\d+)\b/.exec(treffer[1])
		if (kennung) {
			ids.add(Number(kennung[1]))
		}
	}

	// Nur Notenkoepfe fuer die Lageprobe: sie sitzen auf der Segmentposition.
	// Ein Vorzeichen steht links davon, ein Hals reicht darueber hinaus -
	// beides waeren Ausreisser ohne Aussage.
	//
	// Zwei Schreibweisen desselben Notenkopfs. Die Engine schreibt ihn als
	// Glyph-Referenz
	// <g class="Note ..."><g transform="matrix(1 0 0 1 x y)"><use .../></g></g>
	// - jede Glyphe steht einmal in <defs>, statt ihre Pfaddaten zu
	// wiederholen. Ein direkt gezeichneter <path class="Note ..." d="M x ...">
	// wird ebenso gelesen. Beide Muster nehmen die x-Position des ersten
	// gezeichneten Punkts bzw. des Glyph-Ursprungs.
	for (const treffer of svgText.matchAll(/<path class="Note\b[^"]*\bseg-(\d+)\b[^"]*"[^>]*?\sd="M\s*(-?[\d.]+)/g)) {
		notes.push({ id: Number(treffer[1]), x: Number(treffer[2]) })
	}
	for (const treffer of svgText.matchAll(/<g class="Note\b[^"]*\bseg-(\d+)\b[^"]*">\s*<g transform="matrix\((?:[-\d.]+ ){4}(-?[\d.]+) [-\d.]+\)">/g)) {
		notes.push({ id: Number(treffer[1]), x: Number(treffer[2]) })
	}

	return { ids, notes }
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
 * @param {string[]} [result.svgs] die erzeugten Seiten - nur damit ist M10
 *   pruefbar. Fehlen sie, entfaellt diese Zusage stillschweigend.
 * @return {{problems: string[], details: object}}
 */
export function checkPromises({ pages, timing, midi, meta, svgs = [] }) {
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

	// M10: Das SVG traegt die Segmentkennung, die spos vergibt - sonst kann
	// der Viewer den klingenden Notenkopf nicht faerben und faellt auf das
	// Band zurueck. Die Zusage gilt nur fuer diesen Weg: MuseScore selbst
	// schreibt diese Kennungen nicht, und der Selbsttest des Sidecars kennt
	// M10 deshalb nicht (siehe docs/architecture.md E3).
	let markiert = 0
	let unbekannt = 0
	let verrutscht = 0
	let maxAbstand = 0
	const bekannt = timing?.elements ?? {}
	const gezeichnet = new Set()

	for (const svg of svgs) {
		const { ids, notes } = svgSegments(svg)
		for (const id of ids) {
			markiert++
			if (bekannt[String(id)]) {
				gezeichnet.add(id)
			} else {
				unbekannt++
			}
		}
		for (const note of notes) {
			const rect = bekannt[String(note.id)]
			if (!rect) {
				continue
			}
			const abstand = note.x - rect.x
			maxAbstand = Math.max(maxAbstand, Math.abs(abstand))
			// Ein Notenkopf sitzt gemessen innerhalb einer Einheit auf der
			// Segmentposition, bei 107-162 Einheiten Segmentbreite. Waere die
			// Nummerierung um eins verschoben, laege er ein ganzes Segment
			// weiter - diese Schranke faengt das, ohne an Rundung zu haengen.
			if (abstand < -rect.w || abstand > 2 * rect.w) {
				verrutscht++
			}
		}
	}

	if (svgs.length > 0) {
		if (markiert === 0) {
			problems.push('das SVG traegt keine Segmentkennungen - der klingende Notenkopf ist nicht auffindbar (M10 verletzt)')
		}
		if (unbekannt > 0) {
			problems.push(`${unbekannt} Segmentkennungen im SVG haben kein Element in spos (M10 verletzt)`)
		}
		if (verrutscht > 0) {
			problems.push(`${verrutscht} Notenkoepfe liegen nicht auf ihrer Segmentposition - Notenbild und Zeitachse zaehlen auseinander (M10 verletzt)`)
		}
	}

	return {
		problems,
		details: {
			pages,
			events: events.length,
			elements: elements.length,
			repeatedElids: repeated,
			markedSegments: gezeichnet.size,
			maxNoteOffset: Math.round(maxAbstand * 100) / 100,
		},
	}
}
