import { translate } from '@nextcloud/l10n'
import { computed, ref } from 'vue'
import { channelsOfPart } from '../lib/panLayout.js'
import { keyAt } from '../lib/scoreFacts.js'
import { resolveMeasurePosition } from '../lib/scoreLayout.js'
import { MODE_TONIC, MODE_VOICE, pitchName, resolveStartTone } from '../lib/startTone.js'

const t = (text, vars) => translate('scoreview', text, vars)

/** Feste Dauer, wenn niemand einen Knopf haelt (Folge-Befehl „Ton", E10). */
const FIXED_TONE_MS = 2000

/**
 * Anfangston: der Ton meiner Stimme oder der Grundton der Tonart an der
 * Cursorposition, als Klavierton, solange der Knopf gedrueckt ist.
 *
 * Die Position ist die ANZEIGEzeit (Zeitregel aus playbackTime.js):
 * Gemeint ist die Stelle, die man sieht und gerade hoert - nicht die, die
 * schon im Ausgabepuffer steht.
 *
 * Das MIDI wird erst beim ersten Druck gelesen und dann je Partitur behalten
 * (useScoreFacts, `computed` ist in Vue faul): Wer den Knopf nie drueckt,
 * bezahlt nichts dafuer.
 *
 * @param {object} deps
 * @param {() => object|null} deps.clock Zeitquelle; nur der echte Player kann Toene
 * @param {() => boolean} deps.hasRealPlayer
 * @param {() => ?object} deps.parsedMidi gelesenes MIDI (useScoreFacts)
 * @param {() => {keys:Array}} deps.facts Partiturfakten (useScoreFacts)
 * @param {() => object|null} deps.measuresTimeline
 * @param {() => number} deps.displayTimeMs
 * @param {() => number} deps.durationMs
 * @param {() => Array} deps.mixerChannels Kanaele je Stimme (mixerLayout.js)
 * @param {() => ?string} deps.myPartId
 * @param {() => boolean} deps.permitted ob die Bedienung gerade wirken darf (interactionPolicy)
 * @param {() => void} deps.onNeedPart Stimmauswahl oeffnen
 * @return {object}
 */
export function useStartTone({ clock, hasRealPlayer, parsedMidi, facts, measuresTimeline, displayTimeMs, durationMs, mixerChannels, myPartId, permitted, onNeedPart }) {
	const mode = ref(MODE_VOICE)
	const sounding = ref(false)
	// Der zuletzt gespielte Ton als Name ("E♭4") - steht am Knopf, damit man
	// ihn auch ablesen kann, wenn man ihn in der Probe nicht sicher hoert.
	const lastToneName = ref('')
	// Ob zuletzt die Stimme fehlte - dann zeigt der Viewer einen Hinweis
	// neben der Stimmauswahl.
	const needPart = ref(false)
	let pressId = 0
	let fixedTimer = null

	/**
	 * Warum der Knopf nicht geht, im Klartext - leer, wenn er geht. Im stillen
	 * Modus (ohne SoundFont) gibt es keinen Klavierklang; ein Sinuston waere
	 * moeglich, widerspraeche aber dem Klavierton aus der Ausgabekette und klaenge in der Probe falsch.
	 */
	const unavailableReason = computed(() => {
		if (!hasRealPlayer()) {
			return t('The starting note needs sound, and no SoundFont is loaded.')
		}
		if (!clock()?.canPlayTone?.()) {
			return t('The score uses every MIDI channel, so there is none left for the starting note.')
		}
		return ''
	})

	function currentTone() {
		const timeMs = displayTimeMs()
		const position = resolveMeasurePosition(measuresTimeline(), timeMs, durationMs())
		const measureNumber = position?.measureNumber ?? 1
		const result = resolveStartTone({
			mode: mode.value,
			notes: parsedMidi()?.notes ?? null,
			myChannels: channelsOfPart(mixerChannels(), myPartId()),
			keys: facts().keys,
			measureNumber,
			timeMs,
		})
		const key = keyAt(facts().keys, measureNumber)
		return { ...result, concertKey: key?.concertKey ?? null }
	}

	/**
	 * Ton an. Aus pointerdown (Halten) oder aus startToneFor().
	 *
	 * @param {boolean} [checkPolicy] im Aufführungsmodus gesperrt;
	 *   der Folge-Befehl der Leitung prueft selbst
	 * @return {Promise<?number>} die Kennung dieses Anschlags, null ohne Ton
	 */
	async function press(checkPolicy = true) {
		if (unavailableReason.value || (checkPolicy && !permitted())) {
			return null
		}
		const tone = currentTone()
		if (tone.reason === 'noPart') {
			needPart.value = true
			onNeedPart()
			return null
		}
		needPart.value = false
		if (tone.pitch === undefined) {
			return null
		}
		// Ein neuer Anschlag loest den Zeitgeber eines frueheren Festdauer-Tons:
		// Der liefe sonst weiter und schnitte diesen Ton vorzeitig ab.
		clearFixedTimer()
		const mine = ++pressId
		sounding.value = true
		lastToneName.value = pitchName(tone.pitch, tone.concertKey)
		await clock()?.startTone?.(tone.pitch)
		// Losgelassen, waehrend der AudioContext noch aufwachte: Dann kam
		// stopTone() VOR dem Anschlag und haette nichts beendet - der Ton
		// klaenge bis zur Obergrenze weiter.
		if (mine !== pressId || !sounding.value) {
			clock()?.stopTone?.()
		}
		return mine
	}

	function clearFixedTimer() {
		if (fixedTimer) {
			clearTimeout(fixedTimer)
			fixedTimer = null
		}
	}

	function release() {
		clearFixedTimer()
		if (!sounding.value) {
			return
		}
		sounding.value = false
		clock()?.stopTone?.()
	}

	/**
	 * Der Ton fuer eine feste Dauer - fuer den Folge-Befehl „Ton" (E10): Dort
	 * haelt niemand einen Knopf.
	 *
	 * @param {number} [durationMs]
	 */
	async function startToneFor(durationMs = FIXED_TONE_MS) {
		const mine = await press(false)
		// Nur fuer den eigenen Anschlag: Kam inzwischen ein weiterer, gehoert
		// der Ton ihm, und dessen Ende bestimmt er selbst.
		if (mine !== null && mine === pressId && sounding.value) {
			clearFixedTimer()
			fixedTimer = setTimeout(release, durationMs)
		}
	}

	function setMode(neu) {
		mode.value = neu === MODE_TONIC ? MODE_TONIC : MODE_VOICE
	}

	function reset() {
		release()
		lastToneName.value = ''
		needPart.value = false
	}

	return { mode, sounding, lastToneName, needPart, unavailableReason, press, release, startToneFor, setMode, reset }
}
