// Reine, player-freie Mixer-Logik (Phase 9) - testbar ohne echten
// AudioContext/Synth. lib/player.js bleibt dadurch ein dünner
// spessasynth_lib-Wrapper ohne eigene Mute/Solo-Semantik.

/**
 * @typedef {{instrumentId:string,name:string,partId:string,type:string}} Track
 * @typedef {{id:string,name:string,instrumentId:string,program:number}} Part
 * @typedef {{channel:number,instrumentId:string,name:string,partId:string,program:number}} MixerChannel
 */

/**
 * Ordnet metadata.tracks[] (aus meta.json, siehe PLAN.md M6) MIDI-Kanälen
 * zu. Index-basierte Annahme: MuseScores MIDI-Export vergibt Kanäle in
 * derselben Reihenfolge wie tracks[] (Kanal i = tracks[i]) - eine
 * instrumentId-basierte Zuordnung ist nicht möglich, weil die MIDI-Datei
 * selbst keine instrumentId trägt, nur Programmnummern (siehe PLAN.md
 * Risiko "MIDI-Kanalreihenfolge ≠ metadata.tracks"). Bewusst als eigene,
 * an einer Stelle austauschbare Funktion gehalten, falls sich diese Annahme
 * gegen reales Hörergebnis als falsch herausstellt.
 *
 * Der Anzeigename kommt aus `metadata.parts[].name` ("Soprano", "Alto", …),
 * verbunden über `parts[].id === tracks[].partId`. NICHT aus `tracks[].name`:
 * das ist bei MuseScore 4 der Name der Klangbibliothek und lautet für jede
 * Stimme gleich ("MS Basic") - der Mixer zeigte dadurch fünf identisch
 * beschriftete Regler und war für "meine Stimme lauter" unbrauchbar
 * (an echten meta.json-Daten gemessen).
 *
 * @param {Track[]} tracks
 * @param {Part[]} [parts] metadata.parts - ohne sie bleibt die instrumentId als Name
 * @returns {MixerChannel[]}
 */
export function resolveMixerChannels(tracks, parts) {
	const partsById = new Map((parts ?? []).map((part) => [String(part.id), part]))
	return (tracks ?? []).map((track, index) => {
		const part = partsById.get(String(track.partId))
		return {
			channel: index,
			instrumentId: track.instrumentId,
			// Reihenfolge bewusst so: Part-Name (echter Stimmenname) vor
			// instrumentId ("metronome" - die Metronomspur hat keinen Part).
			name: part?.name || track.instrumentId || track.name || '',
			partId: track.partId,
			// MuseScores eigene Programmwahl fuer diese Stimme (52 = Choir
			// Aahs bei SATB). Ohne sie startete das Instrument-Auswahlfeld im
			// Mixer immer auf Programm 0 und behauptete damit etwas anderes,
			// als tatsaechlich klang.
			program: part?.program ?? 0,
		}
	})
}

/**
 * @typedef {{channel:number,volume:number,muted:boolean,solo:boolean}} ChannelState
 */

/**
 * Reine Solo/Mute-Auflösung, unabhängig vom Synth: Sobald mindestens ein
 * Kanal solo geschaltet ist, sind nur noch nicht-gemutete Solo-Kanäle
 * hörbar; ohne Solo gilt nur die eigene Mute-Einstellung jedes Kanals.
 *
 * @param {ChannelState[]} channelStates
 * @returns {Map<number, number>} channel -> effektive MIDI-CC7-Lautstärke (0-127)
 */
export function computeEffectiveVolumes(channelStates) {
	const anySolo = channelStates.some((c) => c.solo)
	const result = new Map()
	for (const state of channelStates) {
		const audible = anySolo ? (state.solo && !state.muted) : !state.muted
		result.set(state.channel, audible ? state.volume : 0)
	}
	return result
}
