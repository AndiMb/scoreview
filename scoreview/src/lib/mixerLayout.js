// Reine, player-freie Mixer-Logik - testbar
// ohne echten AudioContext/Synth. lib/player.js bleibt dadurch ein dünner
// spessasynth_lib-Wrapper ohne eigene Mute/Solo-Semantik.

/**
 * @typedef {{instrumentId:string,name:string,partId:string,type:string}} Track
 * @typedef {{id:string,name:string,instrumentId:string,program:number}} Part
 * @typedef {{channel:number,instrumentId:string,name:string,partId:?string,program:number,harmonyOf?:string,articulation?:boolean}} MixerChannel
 *   harmonyOf: the part whose chord symbols the channel plays; partId is then null.
 *   articulation: a further channel of the same instrument (pizzicato, ...)
 * @typedef {{key:string,name:string,partId:?string,program:number,channels:number[],voices:number,harmonyOf?:string}} MixerGroup
 *   voices: the channels that are no articulation - more than one is a divisi
 * @typedef {Array<number|{channel:number, program:?number}>} TrackChannels
 *   the channels of one MIDI track in the order of their first message
 *   (midiNotes.js readTrackLayout()); plain numbers are channels without a
 *   known program
 */

/**
 * Ordnet metadata.tracks[]/parts[] (aus meta.json, siehe docs/architecture.md M6/M8)
 * MIDI-Kanälen zu, ein Eintrag pro Kanal einer Stimme (alle Klänge, dazu
 * die Akkordsymbole - siehe unten).
 *
 * Zwei an echtem Material (nicht nur `wwimf`) gefundene Korrekturen
 * gegenüber der ursprünglichen Annahme "Kanal i = tracks[i]":
 *
 * 1. **Die Metronomspur trägt in der exportierten MIDI keine einzige Note**
 *    (gemessen an `wwimf` UND `duckwerk`: `metadata.tracks` führt sie, die
 *    MIDI-Datei hat für sie weder Track noch Kanal). Ein Mixerregler dafür
 *    wäre ein Blindregler. Sie wird hier deshalb bewusst ausgeschlossen -
 *    das eigenständige Metronom/Einzähler erzeugt seinen Klick
 *    clientseitig aus measures.json, nicht über diesen Kanal.
 * 2. **"MIDI-Kanal = Track-Index" stimmt NICHT allgemein.** An `duckwerk`
 *    gemessen (5 Instrumentalspuren Sopran/Alt/Tenor/Bariton/Bass in
 *    Dokumentreihenfolge): die tatsächlich im MIDI verwendeten Kanäle sind
 *    0/2/3/1/6, nicht 0/1/2/3/4 - MuseScores Kanalvergabe folgt nicht der
 *    Track-Reihenfolge. Bei `wwimf` traf die alte Annahme nur zufällig zu
 *    (Kanäle 0-3 in Dokumentreihenfolge), das hatte den Fehler verdeckt.
 *    Deshalb bevorzugt diese Funktion `trackChannels` - die
 *    echten, aus der MIDI-Datei selbst gelesenen Kanäle je Spur (siehe
 *    `midiNotes.js::readTrackLayout()`, ersatzweise
 *    `player.js::getTrackChannels()`), in derselben Dokumentreihenfolge wie
 *    die (nicht-Metronom-)Einträge hier. Ohne `trackChannels` (bevor das
 *    MIDI geladen ist) bleibt der Index als Näherung übrig.
 *
 * `tracks` kann leer sein, obwohl `parts` gefüllt ist (M8, `repeat-test.mscz`)
 * - dann direkt auf `parts` zurückfallen, sonst gäbe es überhaupt keine
 * Lautstärkeregelung ("Lautstärke darf nie vollständig fehlen"). Measured:
 * the scoreview-engine always leaves `tracks` empty, so this is the usual way.
 *
 * **A part plays on all channels of its track, not only the first.**
 * MuseScore gives an instrument one channel per sound (strings: arco,
 * pizzicato, tremolo), and chord symbols one more, "harmony", appended to the
 * end of the list. A part's row therefore carries all of them, and the
 * harmony channel - the last one its track sets up - becomes a row of its
 * own when the part has chord symbols (`harmonyCount`): chords that played
 * on regardless of the mixer were the complaint, and a singer wants them
 * apart from the melody. Not "my part" either: partId stays null, so the
 * focus, the coach and the start tone keep to the written notes.
 *
 * **A part can have more MIDI tracks than one** - one per staff, a piano has
 * two. A track that brings no channel of its own continues the part before
 * it: MuseScore sets up a part's channels in its first staff's track only.
 * Only if that yields exactly one group per entry is it used; otherwise the
 * index stays, as before.
 *
 * @param {Track[]} tracks
 * @param {Part[]} [parts] metadata.parts - liefert den echten Stimmennamen
 *   (tracks[].name ist bei MuseScore 4 nur die Klangbibliothek, "MS Basic")
 * @param {TrackChannels[]} [trackChannels] echte MIDI-Kanäle je Spur, in
 *   Dokumentreihenfolge der NICHT-Metronom-Spuren (siehe oben)
 * @return {MixerChannel[]}
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

	// Nur anwenden, wenn die Zuordnung zur Anzahl der Einträge passt - bei einer
	// Abweichung (z.B. eine Partitur, deren MIDI-Export doch eine Metronomspur
	// enthält) wäre eine positionale Zuordnung falsch UND stumm falsch; lieber
	// sichtbar auf den Index zurückfallen, als eine Stimme fälschlich auf den
	// Kanal einer anderen zu legen.
	const groups = Array.isArray(trackChannels) ? groupTracks(trackChannels.map(normalizeTrack), entries.length) : null

	const result = []
	const taken = new Set()
	const seenParts = new Set()
	entries.forEach((entry, index) => {
		const own = groups ? groups[index] : []
		if (own.length === 0) {
			result.push({ channel: index, ...entry })
			return
		}
		// A channel belongs to the first entry that plays it: a second track
		// of the same part (tracks per staff) adds no row of its own.
		const real = own.filter((info) => !taken.has(info.channel))
		if (real.length === 0) {
			return
		}
		const firstOfPart = !seenParts.has(String(entry.partId))
		seenParts.add(String(entry.partId))
		const part = partsById.get(String(entry.partId))
		const harmony = firstOfPart && (part?.harmonyCount ?? 0) > 0 && real.length > 1 ? real[real.length - 1] : null
		let first = true
		for (const info of real) {
			taken.add(info.channel)
			if (info === harmony) {
				result.push({ ...entry, channel: info.channel, partId: null, harmonyOf: String(entry.partId), program: info.program ?? 0 })
				continue
			}
			const channel = { channel: info.channel, ...entry, program: info.program ?? entry.program }
			if (!first) {
				// A further sound of the same instrument (pizzicato, mute):
				// follows the row, but is no voice of its own (ScoreMixer.vue
				// offers the instrument choice for one voice only).
				channel.articulation = true
			}
			first = false
			result.push(channel)
		}
	})
	return result
}

/**
 * @param {TrackChannels} track
 * @return {Array<{channel:number, program:?number}>}
 */
function normalizeTrack(track) {
	return (track ?? []).map((info) => (typeof info === 'number' ? { channel: info, program: null } : info))
}

/**
 * The MIDI tracks per mixer entry, in order: one track each when the counts
 * match; otherwise a track whose channels all belong to the group before it
 * (a further staff) joins that group, and tracks without a channel drop out.
 *
 * @param {Array<Array<{channel:number, program:?number}>>} tracks
 * @param {number} count
 * @return {?Array<Array<{channel:number, program:?number}>>} the channels per
 *   entry in first-message order, null when no assignment fits
 */
function groupTracks(tracks, count) {
	if (tracks.length === count) {
		return tracks
	}
	const groups = []
	for (const track of tracks) {
		if (track.length === 0) {
			continue
		}
		const previous = groups[groups.length - 1]
		if (previous && track.every((info) => previous.some((own) => own.channel === info.channel))) {
			continue
		}
		groups.push([...track])
	}
	return groups.length === count ? groups : null
}

/**
 * Fasst Mixerkanäle mit derselben `partId` zu einer Bedienzeile zusammen
 * ("mehrere Tracks eines Parts lassen sich damit zu einem Regler
 * zusammenfassen", z.B. bei Divisi). Kanäle ohne `partId` (sollte nach dem
 * Metronom-Ausschluss in `resolveMixerChannels` nicht mehr vorkommen, bleibt
 * hier trotzdem als Fallback erhalten) bekommen je eine eigene Gruppe.
 * Reihenfolge = erstes Auftreten, wie in `channels`.
 *
 * @param {MixerChannel[]} channels
 * @return {MixerGroup[]}
 */
export function resolveMixerGroups(channels) {
	const groups = new Map()
	for (const ch of channels) {
		const key = ch.partId ?? (ch.harmonyOf !== undefined ? `harmony-${ch.harmonyOf}` : `channel-${ch.channel}`)
		if (!groups.has(key)) {
			const group = { key, name: ch.name, partId: ch.partId, program: ch.program, channels: [], voices: 0 }
			if (ch.harmonyOf !== undefined) {
				group.harmonyOf = ch.harmonyOf
			}
			groups.set(key, group)
		}
		groups.get(key).channels.push(ch.channel)
		if (!ch.articulation) {
			groups.get(key).voices++
		}
	}
	return [...groups.values()]
}

/**
 * The programs a row's instrument choice sets, one per channel. The whole row
 * changes, as its slider does - a contrabass turned cello should not keep
 * plucking as a contrabass. Choosing the row's own instrument again gives
 * every channel its own sound back (pizzicato, tremolo, ...), so the score's
 * sound stays reachable from the picker.
 *
 * @param {MixerGroup} group
 * @param {MixerChannel[]} channels from resolveMixerChannels()
 * @param {number} program the chosen one
 * @return {Array<{channel:number, program:number}>}
 */
export function groupPrograms(group, channels, program) {
	const own = new Map(channels.map((ch) => [ch.channel, ch.program]))
	return group.channels.map((channel) => ({
		channel,
		program: program === group.program ? (own.get(channel) ?? program) : program,
	}))
}
