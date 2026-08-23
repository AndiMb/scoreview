// Reine, player-freie Mixer-Logik (Phase 9, erweitert Phase 17) - testbar
// ohne echten AudioContext/Synth. lib/player.js bleibt dadurch ein dünner
// spessasynth_lib-Wrapper ohne eigene Mute/Solo-Semantik.

/**
 * @typedef {{instrumentId:string,name:string,partId:string,type:string}} Track
 * @typedef {{id:string,name:string,instrumentId:string,program:number}} Part
 * @typedef {{channel:number,instrumentId:string,name:string,partId:string,program:number}} MixerChannel
 * @typedef {{key:string,name:string,partId:string,program:number,channels:number[]}} MixerGroup
 */

/**
 * Ordnet metadata.tracks[]/parts[] (aus meta.json, siehe PLAN.md M6/M8)
 * MIDI-Kanälen zu, EIN Eintrag pro tatsächlich klingender Spur.
 *
 * Zwei an echtem Material (nicht nur `wwimf`) gefundene Korrekturen
 * gegenüber der ursprünglichen Phase-9-Annahme "Kanal i = tracks[i]":
 *
 * 1. **Die Metronomspur trägt in der exportierten MIDI keine einzige Note**
 *    (gemessen an `wwimf` UND `duckwerk`: `metadata.tracks` führt sie, die
 *    MIDI-Datei hat für sie weder Track noch Kanal). Ein Mixerregler dafür
 *    wäre ein Blindregler. Sie wird hier deshalb bewusst ausgeschlossen -
 *    das eigenständige Metronom/Einzähler (Phase 17) erzeugt seinen Klick
 *    clientseitig aus measures.json, nicht über diesen Kanal.
 * 2. **"MIDI-Kanal = Track-Index" stimmt NICHT allgemein.** An `duckwerk`
 *    gemessen (5 Instrumentalspuren Sopran/Alt/Tenor/Bariton/Bass in
 *    Dokumentreihenfolge): die tatsächlich im MIDI verwendeten Kanäle sind
 *    0/2/3/1/6, nicht 0/1/2/3/4 - MuseScores Kanalvergabe folgt nicht der
 *    Track-Reihenfolge. Bei `wwimf` traf die alte Annahme nur zufällig zu
 *    (Kanäle 0-3 in Dokumentreihenfolge), das hatte den Fehler in Phase 9
 *    verdeckt. Deshalb bevorzugt diese Funktion `trackChannels` - die
 *    echten, aus dem geladenen MIDI selbst gelesenen Kanäle je Spur (siehe
 *    `player.js::getTrackChannels()`), in derselben Dokumentreihenfolge wie
 *    die (nicht-Metronom-)Einträge hier. Ohne `trackChannels` (z.B. bevor
 *    der Player bereit ist) bleibt der Index als Näherung übrig.
 *
 * `tracks` kann leer sein, obwohl `parts` gefüllt ist (M8, `repeat-test.mscz`)
 * - dann direkt auf `parts` zurückfallen, sonst gäbe es überhaupt keine
 * Lautstärkeregelung ("Lautstärke darf nie vollständig fehlen").
 *
 * @param {Track[]} tracks
 * @param {Part[]} [parts] metadata.parts - liefert den echten Stimmennamen
 *   (tracks[].name ist bei MuseScore 4 nur die Klangbibliothek, "MS Basic")
 * @param {number[][]} [trackChannels] echte MIDI-Kanäle je Spur, in
 *   Dokumentreihenfolge der NICHT-Metronom-Spuren (siehe oben)
 * @returns {MixerChannel[]}
 */
export function resolveMixerChannels(tracks, parts, trackChannels) {
	const partsById = new Map((parts ?? []).map((part) => [String(part.id), part]))

	const entries = (tracks && tracks.length > 0)
		? tracks
			.filter((track) => track.instrumentId !== 'metronome')
			.map((track) => {
				const part = partsById.get(String(track.partId))
				return {
					instrumentId: track.instrumentId,
					name: part?.name || track.instrumentId || track.name || '',
					partId: track.partId ?? null,
					program: part?.program ?? 0,
				}
			})
		: (parts ?? []).map((part) => ({
			instrumentId: part.instrumentId,
			name: part.name || part.instrumentId || '',
			partId: part.id ?? null,
			program: part.program ?? 0,
		}))

	// Nur anwenden, wenn die Länge zur Anzahl der Einträge passt - bei einer
	// Abweichung (z.B. eine Partitur, deren MIDI-Export doch eine Metronomspur
	// enthält) wäre eine positionale Zuordnung falsch UND stumm falsch; lieber
	// sichtbar auf den Index zurückfallen, als eine Stimme fälschlich auf den
	// Kanal einer anderen zu legen.
	const realChannelsUsable = Array.isArray(trackChannels) && trackChannels.length === entries.length

	return entries.map((entry, index) => {
		const real = realChannelsUsable ? trackChannels[index] : null
		const channel = (real && real.length > 0) ? real[0] : index
		return { channel, ...entry }
	})
}

/**
 * Fasst Mixerkanäle mit derselben `partId` zu einer Bedienzeile zusammen
 * (Phase 17: "mehrere Tracks eines Parts lassen sich damit zu einem Regler
 * zusammenfassen", z.B. bei Divisi). Kanäle ohne `partId` (sollte nach dem
 * Metronom-Ausschluss in `resolveMixerChannels` nicht mehr vorkommen, bleibt
 * hier trotzdem als Fallback erhalten) bekommen je eine eigene Gruppe.
 * Reihenfolge = erstes Auftreten, wie in `channels`.
 *
 * @param {MixerChannel[]} channels
 * @returns {MixerGroup[]}
 */
export function resolveMixerGroups(channels) {
	const groups = new Map()
	for (const ch of channels) {
		const key = ch.partId ?? `channel-${ch.channel}`
		if (!groups.has(key)) {
			groups.set(key, { key, name: ch.name, partId: ch.partId, program: ch.program, channels: [] })
		}
		groups.get(key).channels.push(ch.channel)
	}
	return [...groups.values()]
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

/**
 * "Meine Stimme"-Preset (Phase 17): hebt die Kanäle einer Gruppe an, dämpft
 * alle übrigen (statt sie wie Solo ganz zu verstummen) - der Probenfall ist
 * "ich will meine Stimme klar heraushören, die anderen aber noch mithören",
 * nicht "die anderen komplett ausblenden". Bewusst als eigener, von Mute/Solo
 * unabhängiger Eingriff auf `volume` selbst: er lässt sich mit beidem
 * kombinieren (eine gedämpfte Stimme bleibt zusätzlich mutebar) und braucht
 * keine dritte Zustandsdimension in `computeEffectiveVolumes`.
 *
 * @param {number[]} allChannels alle Kanalnummern (Dokumentreihenfolge oder
 *   beliebig, nur die Menge zählt)
 * @param {number[]} focusChannels Kanäle der ausgewählten Gruppe
 * @param {{loud?:number, quiet?:number}} [opts]
 * @returns {Map<number, number>} channel -> volume (0-127)
 */
export function computeVoiceFocusVolumes(allChannels, focusChannels, { loud = 127, quiet = 40 } = {}) {
	const focusSet = new Set(focusChannels)
	const result = new Map()
	for (const channel of allChannels) {
		result.set(channel, focusSet.has(channel) ? loud : quiet)
	}
	return result
}
