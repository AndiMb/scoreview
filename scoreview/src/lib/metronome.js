// Reine Zeitrechnung fürs Metronom/Einzähler. Bewusst getrennt
// von der eigentlichen Klickerzeugung (metronomeClick.js, braucht
// AudioContext, deshalb dort und ungetestet wie player.js/silentClock.js).
//
// Grundlage: `score.mid` enthält nachweislich KEINE Metronomnoten (gemessen
// an `wwimf` UND `duckwerk` - `metadata.tracks` führt zwar eine Metronomspur,
// aber weder MIDI-Track noch -Kanal existieren dafür in der exportierten
// Datei, siehe mixerLayout.js). Der Klick kommt deshalb ausschließlich aus
// `measures.json` (Taktzeiten liegen ohnehin vor).
//
// Ohne Taktart liesse sich vermuten, ein Klick pro Schlag sei nicht ableitbar
// - zu vorsichtig gedacht (Nutzer-Rückmeldung: "alle Schläge, nicht nur der
// erste"): dieselbe Schätzung, die der Einzähler benutzt (Taktdauer /
// Viertel-Schlaglänge, siehe estimateBeatsInMeasure), trägt den Takt genauso.
// Sie ist eine Schätzung und bleibt es - deshalb wird der Takt gleichmäßig
// geteilt statt mit fester Schlaglänge durchgezählt: die Klicks landen dann
// selbst dann sauber auf Taktanfang und -ende, wenn die Schätzung um einen
// Schlag danebenliegt (Auftakt, Tempowechsel).

/**
 * Schätzt die Schlagzahl eines Taktes aus seiner Dauer und der
 * Viertel-BPM (metadata.tempo, M8) - measures.json trägt keine eigene
 * Taktart, nur Zeiten. Für den Einzähler ("ein Einzähler vor dem
 * Loop-Start"): ohne diese Schätzung gäbe es keine Grundlage, wie viele
 * Klicks vor dem Start passen.
 *
 * @param {number} measureDurationMs
 * @param {number} quarterBpm metadata.tempo, kann 0 sein (M8: Partitur ohne
 *   Tempoangabe) - dann Standardannahme 4/4 ohne Tempobezug.
 * @return {number} mindestens 1
 */
export function estimateBeatsInMeasure(measureDurationMs, quarterBpm) {
	if (!quarterBpm || quarterBpm <= 0 || !measureDurationMs || measureDurationMs <= 0) {
		return 4
	}
	const beatMs = 60000 / quarterBpm
	return Math.max(1, Math.round(measureDurationMs / beatMs))
}

/**
 * Zeitpunkte (ms, relativ zum Einzähler-Start) für die Klicks eines
 * Einzählers - ein Klick pro geschätztem Schlag, gleichmäßig verteilt.
 *
 * @param {number} beatsInMeasure aus estimateBeatsInMeasure()
 * @param {number} beatIntervalMs Schlaglänge in ms (60000 / effektive BPM)
 * @return {number[]}
 */
export function computeCountInDelaysMs(beatsInMeasure, beatIntervalMs) {
	return Array.from({ length: Math.max(1, beatsInMeasure) }, (_, i) => i * beatIntervalMs)
}

/**
 * Lead before the first count-in click, in seconds. Room for the time between
 * planning and the first render quantum, so even the first click lands on the
 * grid instead of "as soon as possible".
 */
export const COUNT_IN_LEAD_S = 0.1

/**
 * Places a whole count-in on the AudioContext clock from one base: the clicks
 * and the moment playback starts, one beat after the last click.
 *
 * All clicks share the base on purpose. Planned one by one ("now" when each
 * beat is due), a context that has just woken from rest shifted only the
 * first click: on Android over Bluetooth the output stream needs a moment to
 * start after resume(), and the first click, due at once, sounded late while
 * the others kept the grid - heard as a short gap between one and two. From
 * one base a start-up delay moves every click alike.
 *
 * @param {number} nowSeconds AudioContext.currentTime at planning
 * @param {number[]} delaysMs from computeCountInDelaysMs()
 * @param {number} beatIntervalMs
 * @param {number} [leadSeconds]
 * @return {{ clickAt: number[], playAt: number }} context times in seconds
 */
export function planCountIn(nowSeconds, delaysMs, beatIntervalMs, leadSeconds = COUNT_IN_LEAD_S) {
	const base = nowSeconds + leadSeconds
	const clickAt = delaysMs.map((ms) => base + ms / 1000)
	return { clickAt, playAt: base + (delaysMs[delaysMs.length - 1] + beatIntervalMs) / 1000 }
}

/** The three click modes of the metronome (B2); a session choice, not a preference. */
export const METRONOME_MODES = Object.freeze(['downbeat', 'all', 'eighths'])

/**
 * Click modes as the viewer and the export name them; the booleans are the
 * pre-1.16 `everyBeat` form, kept so that an old caller means what it meant.
 *
 * @param {'downbeat'|'all'|'eighths'|boolean|null|undefined} mode
 * @return {'downbeat'|'all'|'eighths'}
 */
export function normalizeMetronomeMode(mode) {
	if (mode === true || mode === undefined || mode === null) {
		return 'all'
	}
	if (mode === false) {
		return 'downbeat'
	}
	return METRONOME_MODES.includes(mode) ? mode : 'all'
}

/**
 * Every click of one measure with its level: 0 = the downbeat, 1 = a beat,
 * 2 = a subdivision between beats. Shared by the live metronome
 * (resolveBeatInMeasure) and the practice track (exportPlan.js), so both
 * click the same grid.
 *
 * Without a meter the beat count is the estimate from the measure's length
 * (see the file comment), and a subdivision is always a halving - the
 * estimate cannot tell 6/8 from 3/4, so "eighths" in 6/8 clicks sixteenths;
 * a meter (1.17, engine `measureFacts`) brings its own beat count and
 * subdivision (2 or 3). The measure is divided evenly either way, so the
 * last click never falls past the bar line.
 *
 * @param {number} measureStartMs
 * @param {number} measureEndMs start of the NEXT measure, or the end of the piece
 * @param {number} quarterBpm metadata.tempo (M8), 0 allowed
 * @param {'downbeat'|'all'|'eighths'|boolean} [mode]
 * @param {?{beats: number, subdivisions?: number}} [meter] per-measure meter, null = estimate
 * @return {Array<{timeMs: number, level: 0|1|2}>} empty for a measure without duration
 */
export function measureClicks(measureStartMs, measureEndMs, quarterBpm, mode = 'all', meter = null) {
	const durationMs = measureEndMs - measureStartMs
	if (!(durationMs > 0)) {
		return []
	}
	const m = normalizeMetronomeMode(mode)
	if (m === 'downbeat') {
		return [{ timeMs: measureStartMs, level: 0 }]
	}
	const beats = meter && meter.beats > 0 ? Math.round(meter.beats) : estimateBeatsInMeasure(durationMs, quarterBpm)
	const sub = m === 'eighths' ? Math.max(2, Math.round(meter?.subdivisions ?? 2)) : 1
	const slots = beats * sub
	const slotMs = durationMs / slots
	const clicks = []
	for (let i = 0; i < slots; i++) {
		clicks.push({ timeMs: measureStartMs + i * slotMs, level: i === 0 ? 0 : (i % sub === 0 ? 1 : 2) })
	}
	return clicks
}

/**
 * Welcher Klick zu einer Wiedergabezeit gerade dran ist - Basis
 * für den laufenden Metronomklick. Rein, damit die eigentliche Terminierung
 * (AudioContext-Vorlauf, Erkennen von Sprüngen) im Composable bleibt.
 *
 * @param {number} measureStartMs Beginn des Taktes (Zeitachse, nicht Echtzeit)
 * @param {number} measureEndMs Beginn des FOLGENDEN Taktes bzw. Stückende
 * @param {number} timeMs Wiedergabeposition innerhalb des Taktes
 * @param {number} quarterBpm metadata.tempo (M8), 0 erlaubt
 * @param {'downbeat'|'all'|'eighths'|boolean} [mode] boolean wie vor 1.16 (everyBeat)
 * @param {?{beats: number, subdivisions?: number}} [meter] siehe measureClicks()
 * @return {{index:number,timeMs:number,level:0|1|2}|null} null bei unbrauchbaren Zeiten
 */
export function resolveBeatInMeasure(measureStartMs, measureEndMs, timeMs, quarterBpm, mode = 'all', meter = null) {
	const clicks = measureClicks(measureStartMs, measureEndMs, quarterBpm, mode, meter)
	if (clicks.length === 0) {
		return null
	}
	// Past the end (the lookahead asks slightly into the future): stay on the
	// last click, the next measure brings its own downbeat.
	let index = 0
	for (let i = 1; i < clicks.length && clicks[i].timeMs <= timeMs; i++) {
		index = i
	}
	return { index, timeMs: clicks[index].timeMs, level: clicks[index].level }
}
