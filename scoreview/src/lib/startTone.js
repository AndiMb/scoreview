// Anfangston: welcher Ton, und auf welchem Kanal. Rein - player.js
// spielt nur, was hier bestimmt wird, und useStartTone.js verdrahtet.

import { keyAt, pitchAt, tonicPitch } from './scoreFacts.js'

/** Kanal 9 ist nach General MIDI das Schlagzeug - dort klaenge kein Klavier. */
const DRUM_CHANNEL = 9
const MIDI_CHANNELS = 16

/** Der Ton meiner Stimme an der Cursorposition. */
export const MODE_VOICE = 'voice'
/** Der Grundton der dort gueltigen Tonart - der Stimmpfeifenersatz. */
export const MODE_TONIC = 'tonic'
export const START_TONE_MODES = Object.freeze([MODE_VOICE, MODE_TONIC])

/**
 * Steht der Cursor auf einem Einsatz, ist DIESE Note gemeint, nicht die davor
 * endende. Gemessen: Nach einem Taktsprung steht die Uhr des Sequencers auf
 * dem naechsten MIDI-Ereignis, als Gleitkommazahl knapp davor (52315,9 statt
 * 52316) - ohne Zugabe klang dann noch der letzte Ton des Vortakts.
 */
const ONSET_TOLERANCE_MS = 5

/**
 * Der erste Kanal, den das Stueck nicht benutzt - dort stoert der
 * Programmwechsel auf Klavier keine Stimme. MuseScore vergibt Kanaele nicht
 * lueckenlos (mixerLayout.js), deshalb wird gesucht statt "Spurzahl + 1"
 * genommen.
 *
 * @param {number[][]} trackChannels je Spur die benutzten Kanaele (player.getTrackChannels())
 * @return {?number} null, wenn alle 15 melodischen Kanaele belegt sind
 */
export function pickToneChannel(trackChannels) {
	const used = new Set((trackChannels ?? []).flat())
	for (let channel = 0; channel < MIDI_CHANNELS; channel++) {
		if (channel !== DRUM_CHANNEL && !used.has(channel)) {
			return channel
		}
	}
	return null
}

/**
 * Welcher Ton gespielt wird - oder warum keiner.
 *
 * @param {object} p
 * @param {string} p.mode MODE_VOICE oder MODE_TONIC
 * @param {?Array} p.notes Noten aus midiNotes.js; null = MIDI nicht (noch nicht) gelesen
 * @param {?number[]} p.myChannels Kanaele meiner Stimme; null = keine Stimme gewaehlt
 * @param {Array} p.keys Tonarten aus scoreFacts.fromArtifacts
 * @param {?number} p.measureNumber notierter Takt an der Cursorposition
 * @param {number} p.timeMs Partiturzeit der Cursorposition
 * @return {{pitch:number}|{reason:'noPart'|'noNotes'|'noKey'}}
 */
export function resolveStartTone({ mode, notes, myChannels, keys, measureNumber, timeMs }) {
	if (mode === MODE_TONIC) {
		const key = keyAt(keys, measureNumber ?? 1)
		if (!key) {
			return { reason: 'noKey' }
		}
		return { pitch: tonicPitch(key) }
	}
	// Ohne gewaehlte Stimme wird nicht geraten.
	if (!myChannels || myChannels.length === 0) {
		return { reason: 'noPart' }
	}
	const hit = pitchAt(notes ?? [], myChannels, Math.max(0, timeMs ?? 0) + ONSET_TOLERANCE_MS)
	if (!hit) {
		return { reason: 'noNotes' }
	}
	return { pitch: hit.pitch }
}

const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']

/**
 * Der Tonname zur Anzeige am Knopf, z. B. "E♭4". Mit B-Vorzeichen als Be,
 * sonst als Kreuz - so, wie er in der Partitur an dieser Stelle steht, statt
 * einem Alt in Es-Dur ein "D♯" anzusagen.
 *
 * @param {number} pitch MIDI-Tonhoehe
 * @param {?number} concertKey Vorzeichen (-7..7) an der Stelle, null = unbekannt
 * @return {string}
 */
export function pitchName(pitch, concertKey = null) {
	const names = concertKey !== null && concertKey < 0 ? FLAT_NAMES : SHARP_NAMES
	return `${names[((pitch % 12) + 12) % 12]}${Math.floor(pitch / 12) - 1}`
}
