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
 * Welcher Schlag zu einer Wiedergabezeit gerade dran ist - Basis
 * für den laufenden Metronomklick. Rein, damit die eigentliche Terminierung
 * (AudioContext-Vorlauf, Erkennen von Sprüngen) in ScoreViewer.vue bleibt.
 *
 * Der Takt wird gleichmäßig in die geschätzte Schlagzahl geteilt, statt mit
 * fester Schlaglänge vom Taktanfang aus durchzuzählen: so fällt der letzte
 * Klick nie hinter das Taktende, und der nächste Taktanfang trägt garantiert
 * wieder den Akzent (siehe Kopfkommentar).
 *
 * @param {number} measureStartMs Beginn des Taktes (Zeitachse, nicht Echtzeit)
 * @param {number} measureEndMs Beginn des FOLGENDEN Taktes bzw. Stückende
 * @param {number} timeMs Wiedergabeposition innerhalb des Taktes
 * @param {number} quarterBpm metadata.tempo (M8), 0 erlaubt
 * @param {boolean} [everyBeat] false = nur der Taktanfang
 * @return {{index:number,timeMs:number}|null} null bei unbrauchbaren Zeiten
 */
export function resolveBeatInMeasure(measureStartMs, measureEndMs, timeMs, quarterBpm, everyBeat = true) {
	const durationMs = measureEndMs - measureStartMs
	if (!(durationMs > 0)) {
		return null
	}
	if (!everyBeat) {
		return { index: 0, timeMs: measureStartMs }
	}
	const beats = estimateBeatsInMeasure(durationMs, quarterBpm)
	const beatMs = durationMs / beats
	const raw = Math.floor((timeMs - measureStartMs) / beatMs)
	const index = Math.min(beats - 1, Math.max(0, raw))
	return { index, timeMs: measureStartMs + index * beatMs }
}
