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
 * M10 for a set of pages: every segment id the SVG carries has an element in
 * timing.json, and noteheads sit on their segment. Shared by checkPromises
 * (the base conversion) and checkVariant (a display variant).
 *
 * @param {object} timing timing.json in cache form
 * @param {string[]} svgs the pages
 * @return {{problems: string[], markedSegments: number, maxNoteOffset: number}}
 */
export function checkSegmentIds(timing, svgs = []) {
	const problems = []
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
			problems.push('the SVG carries no segment IDs - the sounding notehead cannot be located (M10 violated)')
		}
		if (unbekannt > 0) {
			problems.push(`${unbekannt} segment IDs in the SVG have no element in spos (M10 violated)`)
		}
		if (verrutscht > 0) {
			problems.push(`${verrutscht} noteheads are not at their segment position - notation and timeline are numbered differently (M10 violated)`)
		}
	}

	return { problems, markedSegments: gezeichnet.size, maxNoteOffset: Math.round(maxAbstand * 100) / 100 }
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
		problems.push('no SVG page returned')
	}
	if (!midi || midi.length === 0) {
		problems.push('no MIDI returned')
	}
	if (!meta || Object.keys(meta).length === 0) {
		problems.push('no metadata returned')
	}

	const events = timing?.events ?? []
	const elements = Object.keys(timing?.elements ?? {})
	if (events.length === 0) {
		problems.push('spos contains no events')
	}
	if (elements.length === 0) {
		problems.push('spos contains no element coordinates')
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
		problems.push('no elid occurs more than once - repeats are no longer unrolled (M7 violated)')
	}

	const times = events.map((e) => e.timeMs)
	if (times.some((t, i) => i > 0 && t < times[i - 1])) {
		problems.push('event times are not monotonically increasing')
	}

	const m10 = checkSegmentIds(timing, svgs)
	problems.push(...m10.problems)

	return {
		problems,
		details: {
			pages,
			events: events.length,
			elements: elements.length,
			repeatedElids: repeated,
			markedSegments: m10.markedSegments,
			maxNoteOffset: m10.maxNoteOffset,
		},
	}
}

/**
 * Die Partiturfakten aus der Engine (Tonarten mit Dur/Moll, Studierbuchstaben),
 * gegen die mitgelieferte `keys-marks-test.mscz` geprueft: c-Moll ab Takt 1,
 * D-Dur ab Takt 4, Buchstaben A/B/C in den Takten 1/3/4.
 *
 * Eigene Pruefung statt eines Teils von checkPromises: Die Felder gibt es nur
 * auf diesem Weg (der Sidecar laeuft auf Stock-MuseScore und kennt sie nicht),
 * und sie haengen an einer zweiten Partitur. Faellt eines weg, arbeitet der
 * Viewer still mit dem MIDI-Rueckfall weiter - Buchstaben ja, Moll nein, der
 * Anfangston im Grundtonmodus waere dann die Dur-Tonika. Das soll ein
 * Engine-Wechsel nicht unbemerkt anrichten koennen.
 *
 * `meta` ist dabei unveraendert das, was die Engine liefert: convert.mjs und
 * der Browser-Rueckfall schreiben `score.metadata()` ganz nach meta.json, es
 * gibt also keine Umformung, die die Felder verlieren koennte - nur die
 * Engine selbst.
 *
 * @param {object} meta meta.json der Testpartitur
 * @return {{problems: string[], details: object}}
 */
export function checkScoreFacts(meta) {
	const problems = []
	const keySigs = Array.isArray(meta?.keySigs) ? meta.keySigs : null
	const marks = Array.isArray(meta?.rehearsalMarks) ? meta.rehearsalMarks : null

	if (keySigs === null) {
		problems.push('meta.json has no keySigs - the starting note lacks major/minor')
	} else {
		const erste = keySigs.find((k) => k.measure === 1)
		if (erste?.concertKey !== -3 || erste?.mode !== 'minor') {
			problems.push(`Key in measure 1 is not C minor: ${JSON.stringify(erste ?? null)}`)
		}
		const wechsel = keySigs.find((k) => k.measure === 4)
		if (wechsel?.concertKey !== 2 || wechsel?.mode !== 'major') {
			problems.push(`Key change in measure 4 is not D major: ${JSON.stringify(wechsel ?? null)}`)
		}
	}

	if (marks === null) {
		problems.push('meta.json has no rehearsalMarks - rehearsal marks now come from the MIDI only')
	} else {
		const gefunden = marks.map((m) => `${m.text}@${m.measure}`).join(',')
		if (gefunden !== 'A@1,B@3,C@4') {
			problems.push(`Rehearsal marks are not A/B/C in measures 1/3/4: ${gefunden}`)
		}
	}

	const facts = measureFactsProblems(meta)
	problems.push(...facts.problems)

	return {
		problems,
		details: {
			keySigs: keySigs?.length ?? 0,
			rehearsalMarks: marks?.length ?? 0,
			measureFacts: facts.count,
		},
	}
}

/**
 * The invariants of `measureFacts` and the `tick` of `noteSpellings`
 * (engine v4.7.5-engine.5), on any score: one entry per notated measure,
 * ticks contiguous (tick[i+1] === tick[i] + ticks[i]), every spelling's tick
 * inside its measure. The metronome and the beat numbers in the viewer
 * read exactly these relations; a list that is complete but has a gap
 * would put every later beat number in the wrong place.
 *
 * @param {object} meta
 * @return {{problems: string[], count: number}}
 */
function measureFactsProblems(meta) {
	const problems = []
	const facts = Array.isArray(meta?.measureFacts) ? meta.measureFacts : null
	if (facts === null) {
		problems.push('meta.json has no measureFacts - the metronome falls back to estimating the beats')
		return { problems, count: 0 }
	}
	if (facts.length !== meta.measures) {
		problems.push(`measureFacts has ${facts.length} entries for ${meta.measures} measures`)
	}
	for (let i = 0; i < facts.length; i++) {
		const f = facts[i]
		if (f.measure !== i + 1 || !(f.sigN > 0) || !(f.sigD > 0) || !(f.ticks > 0)) {
			problems.push(`measureFacts[${i}] is not a usable measure: ${JSON.stringify(f)}`)
			break
		}
		if (i > 0 && f.tick !== facts[i - 1].tick + facts[i - 1].ticks) {
			problems.push(`measureFacts: measure ${f.measure} starts at tick ${f.tick}, measure ${facts[i - 1].measure} ends at ${facts[i - 1].tick + facts[i - 1].ticks}`)
			break
		}
	}
	const spellings = Array.isArray(meta?.noteSpellings) ? meta.noteSpellings : []
	const outside = spellings.filter((s) => !Number.isInteger(s.tick)
		|| !facts.some((f) => s.tick >= f.tick && s.tick < f.tick + f.ticks)).length
	if (outside > 0) {
		problems.push(`${outside} noteSpellings entries carry no tick inside a measure`)
	}
	return { problems, count: facts.length }
}

/**
 * The time signatures the engine reports at timesig-test.mscz: a
 * one-quarter pickup written in 4/4, a full 4/4 measure, 3/4, 6/8. The
 * promise behind the beat numbers (B1) and the metronome's meter: the
 * nominal signature and the real length are both there and tell a pickup
 * from a full measure. A guess from the duration cannot, which is why the
 * field exists at all.
 *
 * @param {object} meta meta.json of timesig-test.mscz
 * @return {{problems: string[], details: object}}
 */
export function checkMeters(meta) {
	const problems = []
	const expected = [
		{ measure: 1, tick: 0, sigN: 4, sigD: 4, ticks: 480 },
		{ measure: 2, tick: 480, sigN: 4, sigD: 4, ticks: 1920 },
		{ measure: 3, tick: 2400, sigN: 3, sigD: 4, ticks: 1440 },
		{ measure: 4, tick: 3840, sigN: 6, sigD: 8, ticks: 1440 },
	]
	const facts = Array.isArray(meta?.measureFacts) ? meta.measureFacts : null
	if (facts === null) {
		problems.push('meta.json has no measureFacts - the time signature per measure is missing')
	} else {
		const got = facts.map((f) => `${f.measure}:${f.tick}:${f.sigN}/${f.sigD}:${f.ticks}`).join(' ')
		const want = expected.map((f) => `${f.measure}:${f.tick}:${f.sigN}/${f.sigD}:${f.ticks}`).join(' ')
		if (got !== want) {
			problems.push(`measureFacts of timesig-test are not pickup/4/4/3/4/6/8: ${got}`)
		}
	}
	const spellings = Array.isArray(meta?.noteSpellings) ? meta.noteSpellings : []
	const ticks = spellings.map((s) => s.tick)
	if (ticks.length !== 14 || ticks.some((t, i) => i > 0 && !(t > ticks[i - 1]))) {
		problems.push(`noteSpellings of timesig-test are not 14 chords with ascending ticks: ${ticks.join(',')}`)
	}
	return { problems, details: { measureFacts: facts?.length ?? 0, chords: spellings.length } }
}

/**
 * Liedtext und Schreibweisen der Engine (E12/E15) an lyrics-test.mscz: zwei
 * Notenzeilen (Sopran, Bass), Takt 1-2 dreimal wiederholt mit drei
 * Strophen, Schluss „A-men". Die Liedtext-Ansicht und die Tonnamen hängen
 * daran, dass diese Listen auf genau die Kennungen von Timing und SVG
 * zeigen - sonst leuchtet die falsche Silbe, und der Name steht am falschen
 * Notenkopf.
 *
 * @param {{meta: object, timing: object, svgs: string[]}} converted
 * @return {{problems: string[], details: object}}
 */
export function checkLyrics({ meta, timing, svgs }) {
	const problems = []
	const silben = Array.isArray(meta?.lyricSyllables) ? meta.lyricSyllables : null
	const spellings = Array.isArray(meta?.noteSpellings) ? meta.noteSpellings : null
	const elemente = new Set(Object.keys(timing?.elements ?? {}).map(Number))

	if (silben === null) {
		problems.push('meta.json has no lyricSyllables - the lyrics view is missing')
	} else {
		if (silben.length !== 56) {
			problems.push(`expected 56 syllables, found ${silben.length}`)
		}
		const strophen = [...new Set(silben.map((s) => s.verse))].sort().join(',')
		if (strophen !== '0,1,2') {
			problems.push(`Verses are not 0,1,2: ${strophen}`)
		}
		const erste = silben.filter((s) => s.staff === 0 && s.verse === 0).slice(0, 4).map((s) => `${s.text}/${s.syllabic}`).join(' ')
		if (erste !== 'Hal/begin le/middle lu/middle ja/end') {
			problems.push(`Soprano, verse 1 does not start with Hal-le-lu-ja: ${erste}`)
		}
		const fremd = silben.filter((s) => !elemente.has(s.elid)).length
		if (fremd > 0) {
			problems.push(`${fremd} syllables point to an elid that timing.json does not know`)
		}
	}

	if (spellings === null) {
		problems.push('meta.json has no noteSpellings - note names and "tap a note" are missing')
	} else {
		// Notenkoepfe je (elid, Zeile, Stimme) im SVG gegen die Liste
		const imSvg = new Map()
		for (const svg of svgs ?? []) {
			for (const m of svg.matchAll(/class="Note seg-(\d+) st-(\d+) vc-(\d+)"/g)) {
				const key = `${m[1]}:${m[2]}:${m[3]}`
				imSvg.set(key, (imSvg.get(key) ?? 0) + 1)
			}
		}
		const inListe = new Map(spellings.map((s) => [`${s.elid}:${s.staff}:${s.voice}`, s.notes.length]))
		const abweichend = [...new Set([...imSvg.keys(), ...inListe.keys()])].filter((k) => imSvg.get(k) !== inListe.get(k))
		if (abweichend.length > 0) {
			problems.push(`Noteheads differ from the SVG at ${abweichend.slice(0, 5).join(', ')}`)
		}
	}

	return {
		problems,
		details: { lyricSyllables: silben?.length ?? 0, noteSpellings: spellings?.length ?? 0 },
	}
}

/**
 * Staff indices an SVG page draws (`st-N`, M10).
 *
 * @param {string} svgText
 * @return {Set<number>}
 */
export function svgStaves(svgText) {
	const staves = new Set()
	if (typeof svgText !== 'string') {
		return staves
	}
	for (const match of svgText.matchAll(/class="[^"]*\bst-(\d+)\b[^"]*"/g)) {
		staves.add(Number(match[1]))
	}
	return staves
}

/**
 * meta.json of a display variant (E19): what the picture needs, nothing the
 * base conversion already says. Every field that carries an elid or a staff
 * index is the variant's own - it describes the variant's pages; tempo,
 * parts, time signatures and rehearsal marks stay with the base, which no
 * variant changes. `keySigs` is the variant's (the notation's keys, for the
 * self-test); the viewer keeps the base's, which it transposes itself.
 * `parts` names the parts the variant draws, in staff order, so the viewer
 * can find a part's staff in the picture.
 *
 * @param {object} viewMeta the engine's metadata() of the view
 * @param {{baseElid: Record<string, number>, staffMap: number[]}} mapping viewMapping()
 * @param {string} key the canonical variant key
 * @return {object}
 */
export function toVariantMeta(viewMeta, mapping, key) {
	// The engine reports the pitch a transposed view plays. The viewer plays
	// the base MIDI and transposes the sound itself (practice.transpose), by
	// the same amount the key's last field names - a tapped note would sound
	// transposed twice. So the pitch goes back to the base's; the spelling
	// (tpc) stays the transposed one, because that is what the page shows.
	const shift = Number(String(key).split('~')[3]) || 0
	const meta = {
		variant: key,
		pages: viewMeta?.pages ?? 0,
		pageFormat: viewMeta?.pageFormat ?? null,
		keySigs: viewMeta?.keySigs ?? [],
		noteSpellings: (viewMeta?.noteSpellings ?? []).map((entry) => (shift === 0
			? entry
			: { ...entry, notes: (entry.notes ?? []).map(([pitch, tpc]) => [pitch - shift, tpc]) })),
		parts: (viewMeta?.parts ?? []).map((part) => ({ id: part.id, name: part.name })),
		baseElid: mapping?.baseElid ?? {},
		staffMap: mapping?.staffMap ?? [],
	}
	// Absent means "too much text" (over 20 000 syllables), as in the base
	// meta.json - keep that distinction instead of writing an empty list.
	if (Array.isArray(viewMeta?.lyricSyllables)) {
		meta.lyricSyllables = viewMeta.lyricSyllables
	}
	return meta
}

/**
 * The four invariants of a display variant (docs/architecture.md E19),
 * checked after every variant conversion: a variant that fails them would
 * put the cursor, the measure field and the notes in the wrong place, so it
 * is better not cached at all.
 *
 *   I1 time axis: every event time of the variant is one of the base's;
 *   I2 measures: same measure numbering - identical measure events and the
 *      same measure elements;
 *   I3 every segment the variant plays has a base segment (baseElid);
 *   I4 every staff the variant draws maps to a base staff (staffMap);
 *   plus M10 on the variant's own pages.
 *
 * @param {object} base {timing, measures} of the base conversion, cache form
 * @param {object} variant {timing, measures, meta, svgs} of the variant
 * @return {{problems: string[], details: object}}
 */
export function checkVariant(base, variant) {
	const problems = []
	const baseTimes = new Set((base?.timing?.events ?? []).map((e) => e.timeMs))
	const near = (t) => baseTimes.has(t) || baseTimes.has(t - 1) || baseTimes.has(t + 1)
	const offAxis = (variant?.timing?.events ?? []).filter((e) => !near(e.timeMs)).length
	if (offAxis > 0) {
		problems.push(`I1: ${offAxis} event times of the variant are not on the base time axis`)
	}

	const sameEvents = JSON.stringify(variant?.measures?.events ?? []) === JSON.stringify(base?.measures?.events ?? [])
	const baseMeasureIds = Object.keys(base?.measures?.elements ?? {}).sort()
	const variantMeasureIds = Object.keys(variant?.measures?.elements ?? {}).sort()
	if (!sameEvents || JSON.stringify(baseMeasureIds) !== JSON.stringify(variantMeasureIds)) {
		problems.push(`I2: measure numbering differs from the base (${variantMeasureIds.length} vs ${baseMeasureIds.length} measures)`)
	}

	const baseElid = variant?.meta?.baseElid ?? {}
	const played = new Set((variant?.timing?.events ?? []).map((e) => e.elid))
	const unmapped = [...played].filter((elid) => baseElid[String(elid)] === undefined).length
	if (unmapped > 0) {
		problems.push(`I3: ${unmapped} segments of the variant have no base segment`)
	}

	const staffMap = variant?.meta?.staffMap ?? []
	const drawn = new Set()
	for (const svg of variant?.svgs ?? []) {
		for (const st of svgStaves(svg)) {
			drawn.add(st)
		}
	}
	const lost = [...drawn].filter((st) => !(staffMap[st] >= 0)).length
	if (lost > 0) {
		problems.push(`I4: ${lost} staves of the variant have no base staff`)
	}

	const m10 = checkSegmentIds(variant?.timing, variant?.svgs ?? [])
	problems.push(...m10.problems)

	return {
		problems,
		details: {
			pages: (variant?.svgs ?? []).length,
			events: (variant?.timing?.events ?? []).length,
			measures: variantMeasureIds.length,
			staves: drawn.size,
			markedSegments: m10.markedSegments,
		},
	}
}
