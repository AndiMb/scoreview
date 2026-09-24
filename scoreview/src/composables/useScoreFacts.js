import axios from '@nextcloud/axios'
import { computed, shallowRef } from 'vue'
import { parseMidiNotes } from '../lib/midiNotes.js'
import { fromArtifacts, marksNeedMidi } from '../lib/scoreFacts.js'

/**
 * Partiturfakten (Tonarten, Studierbuchstaben) fuer den ganzen Viewer - EIN
 * gelesenes MIDI fuer Anfangston und Taktnavigation statt zweier.
 *
 * Das MIDI liegt normalerweise schon vor: usePlayback haelt eine Kopie fuer
 * die Partiturfakten. Nur mit SoundFont allerdings - ohne Ton (keiner
 * konfiguriert, Laden uebersprungen) laedt niemand das MIDI. Fuer den
 * Anfangston ist das gleichgueltig, er braucht ohnehin Ton; die
 * Studierbuchstaben aber kommen auf dem Sidecar-Weg NUR aus dem MIDI
 * (scoreFacts.js), und die Taktnavigation soll ohne Ton genauso gehen. Dann
 * holt dieses Composable das MIDI selbst - und nur dann (marksNeedMidi): Auf
 * dem lokalen Weg bezahlt niemand dafuer.
 *
 * Gelesen wird faul (`computed`): erst, wenn jemand die Fakten wirklich
 * braucht.
 *
 * @param {object} deps
 * @param {() => ?ArrayBuffer} deps.midiData score.mid aus usePlayback
 * @param {() => ?object} deps.meta meta.json
 * @param {() => ?object} deps.measuresTimeline
 * @return {object}
 */
export function useScoreFacts({ midiData, meta, measuresTimeline }) {
	// Das selbst geholte MIDI, falls usePlayback keines hat.
	const ownMidi = shallowRef(null)
	let generation = 0

	const parsed = computed(() => {
		const bytes = midiData() ?? ownMidi.value
		if (!bytes) {
			return null
		}
		try {
			return parseMidiNotes(bytes)
		} catch (err) {
			// eslint-disable-next-line no-console
			console.error('ScoreView: MIDI fuer die Partiturfakten nicht lesbar.', err)
			return null
		}
	})

	const facts = computed(() => fromArtifacts(meta(), parsed.value, measuresTimeline()))

	// Getrennt von `facts`, damit die Buchstaben das MIDI nur anfassen, wenn
	// sie es brauchen - `facts` liest es immer (Tonarten ohne Engine-Feld).
	const marks = computed(() => {
		const needsMidi = marksNeedMidi(meta(), measuresTimeline())
		return fromArtifacts(meta(), needsMidi ? parsed.value : null, measuresTimeline()).marks
	})

	/**
	 * Holt das MIDI, falls die Buchstaben es brauchen und keines da ist.
	 * Aufzurufen, sobald meta.json und measures.json geladen sind.
	 *
	 * @param {?string} midiUrl
	 * @param {boolean} [needed] auch ohne Studierbuchstaben laden - die
	 *   Intonation braucht die Noten der eigenen Stimme, und ohne Ton hat
	 *   sonst niemand das MIDI geholt. Nur auf ihre ausdrueckliche Handlung
	 *   hin.
	 */
	async function ensureMidi(midiUrl, needed = false) {
		const mine = ++generation
		if (!midiUrl || midiData() || ownMidi.value || (!needed && !marksNeedMidi(meta(), measuresTimeline()))) {
			return
		}
		try {
			const res = await axios.get(midiUrl, { responseType: 'arraybuffer' })
			if (mine === generation) {
				ownMidi.value = res.data
			}
		} catch (err) {
			// Ohne Buchstaben geht die Navigation allein ueber Taktnummern
			// - kein Banner fuer eine Zusatzfunktion.
			// eslint-disable-next-line no-console
			console.error('ScoreView: MIDI fuer die Studierbuchstaben nicht ladbar.', err)
		}
	}

	function reset() {
		generation++
		ownMidi.value = null
	}

	return { parsed, facts, marks, ensureMidi, reset }
}
