// Reine Zeitrechnung fürs Metronom/Einzähler (Phase 17). Bewusst getrennt
// von der eigentlichen Klickerzeugung (metronomeClick.js, braucht
// AudioContext, deshalb dort und ungetestet wie player.js/silentClock.js).
//
// Grundlage: `score.mid` enthält nachweislich KEINE Metronomnoten (gemessen
// an `wwimf` UND `duckwerk` - `metadata.tracks` führt zwar eine Metronomspur,
// aber weder MIDI-Track noch -Kanal existieren dafür in der exportierten
// Datei, siehe mixerLayout.js). Der Klick kommt deshalb ausschließlich aus
// `measures.json` (Taktzeiten liegen ohnehin vor) - und bleibt damit auf
// Taktebene: ohne Taktart-Information ist ein Klick pro Schlag nicht aus den
// Sidecar-Daten ableitbar, nur ein Klick pro Takt (Downbeat).

/**
 * Schätzt die Schlagzahl eines Taktes aus seiner Dauer und der
 * Viertel-BPM (metadata.tempo, M8) - measures.json trägt keine eigene
 * Taktart, nur Zeiten. Für den Einzähler (Phase 17, "ein Einzähler vor dem
 * Loop-Start"): ohne diese Schätzung gäbe es keine Grundlage, wie viele
 * Klicks vor dem Start passen.
 *
 * @param {number} measureDurationMs
 * @param {number} quarterBpm metadata.tempo, kann 0 sein (M8: Partitur ohne
 *   Tempoangabe) - dann Standardannahme 4/4 ohne Tempobezug.
 * @returns {number} mindestens 1
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
 * @returns {number[]}
 */
export function computeCountInDelaysMs(beatsInMeasure, beatIntervalMs) {
	return Array.from({ length: Math.max(1, beatsInMeasure) }, (_, i) => i * beatIntervalMs)
}
