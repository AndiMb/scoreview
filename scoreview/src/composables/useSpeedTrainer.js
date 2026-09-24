import { ref, watch } from 'vue'
import { createSpeedTrainer } from '../lib/speedTrainer.js'

/** Vorgabe fuer die Schrittweite - 5 BPM ist in der Probe die uebliche Stufe. */
const DEFAULT_STEP_BPM = 5
/** Vorgabe fuer den Start: ein Fuenftel langsamer als das jetzige Tempo. */
const DEFAULT_START_FACTOR = 0.8

/**
 * Speed-Trainer: verdrahtet lib/speedTrainer.js mit Loop und Tempo.
 *
 * Er laeuft nur mit aktivem Loop - ohne Loop gaebe es keinen Durchlauf, an
 * dem er zaehlen koennte - und endet beim ersten Tempoeingriff von Hand
 *: Wer selbst am Regler dreht, will gerade etwas anderes als der
 * Trainer, und ein Trainer, der die Hand beim naechsten Durchlauf
 * ueberschreibt, waere ein Kampf um den Regler.
 *
 * @param {object} deps
 * @param {() => boolean} deps.loopActive
 * @param {() => number} deps.effectiveTempoBpm
 * @param {() => number} deps.minTempoBpm
 * @param {() => number} deps.maxTempoBpm
 * @param {(bpm: number) => void} deps.setTempoBpm
 * @param {() => number} deps.manualTempoChanges Zaehler aus usePlayback
 * @return {object}
 */
export function useSpeedTrainer({ loopActive, effectiveTempoBpm, minTempoBpm, maxTempoBpm, setTempoBpm, manualTempoChanges }) {
	// '' statt null: NcTextField nimmt nur string|number (siehe useLoop.js).
	const startBpm = ref('')
	const targetBpm = ref('')
	const stepBpm = ref(DEFAULT_STEP_BPM)
	const active = ref(false)
	const passes = ref(0)
	let trainer = null

	const clamp = (bpm) => Math.min(maxTempoBpm(), Math.max(minTempoBpm(), Math.round(Number(bpm))))

	/**
	 * Leere Felder mit sinnvollen Werten fuellen - aufgerufen, wenn der
	 * Loop-Aufklapper sichtbar wird. Ueberschreibt nichts, was schon dasteht.
	 */
	function prefill() {
		const jetzt = effectiveTempoBpm()
		if (startBpm.value === '') {
			startBpm.value = clamp(jetzt * DEFAULT_START_FACTOR)
		}
		if (targetBpm.value === '') {
			targetBpm.value = clamp(jetzt)
		}
	}

	function start() {
		if (!loopActive()) {
			return
		}
		prefill()
		startBpm.value = clamp(startBpm.value)
		targetBpm.value = clamp(targetBpm.value)
		trainer = createSpeedTrainer({ startBpm: startBpm.value, targetBpm: targetBpm.value, stepBpm: stepBpm.value })
		active.value = true
		passes.value = trainer.passes()
		setTempoBpm(trainer.current())
	}

	function stop() {
		trainer = null
		active.value = false
	}

	function toggle() {
		if (active.value) {
			stop()
		} else {
			start()
		}
	}

	/** Aus useLoop.onWrap: ein Durchlauf ist vorbei. */
	function onLoopWrap() {
		if (!trainer) {
			return
		}
		setTempoBpm(trainer.onLoopWrap())
		passes.value = trainer.passes()
	}

	watch(manualTempoChanges, stop)
	watch(loopActive, (aktiv) => {
		if (aktiv) {
			prefill()
		} else {
			stop()
		}
	})

	function reset() {
		stop()
		startBpm.value = ''
		targetBpm.value = ''
		stepBpm.value = DEFAULT_STEP_BPM
		passes.value = 0
	}

	return { startBpm, targetBpm, stepBpm, active, passes, prefill, start, stop, toggle, onLoopWrap, reset }
}
