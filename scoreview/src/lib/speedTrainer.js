// Speed-Trainer: Jeder Loop-Durchlauf wird um einen Schritt schneller,
// bis das Zieltempo erreicht ist - dort bleibt es stehen. Rein, ohne Uhr und
// ohne Player: Wann ein Durchlauf endet, meldet useLoop (onWrap), gesetzt
// wird das Tempo in usePlayback.

/**
 * Die Grenzen, in denen der Trainer rechnet. Ein Schritt von 0 wuerde nie
 * ankommen, einer ueber 40 BPM ist keine Steigerung mehr, sondern ein Sprung.
 */
export const MIN_STEP_BPM = 1
export const MAX_STEP_BPM = 40

/**
 * @param {object} opts
 * @param {number} opts.startBpm Tempo des ersten Durchlaufs
 * @param {number} opts.targetBpm Tempo, bei dem der Trainer stehen bleibt
 * @param {number} opts.stepBpm Zuwachs je Durchlauf (Betrag; die Richtung
 *   ergibt sich aus Start und Ziel)
 * @return {{current: () => number, onLoopWrap: () => number, finished: () => boolean, passes: () => number}}
 */
export function createSpeedTrainer({ startBpm, targetBpm, stepBpm }) {
	const start = Math.round(Number(startBpm))
	const target = Math.round(Number(targetBpm))
	const step = Math.min(MAX_STEP_BPM, Math.max(MIN_STEP_BPM, Math.round(Math.abs(Number(stepBpm)) || MIN_STEP_BPM)))
	// Auch langsamer werden ist erlaubt (Ziel unter dem Start) - wer ein
	// Stueck zum Schluss bewusst ausbremsen will, soll nicht an einer
	// Richtungspruefung scheitern.
	const richtung = target >= start ? 1 : -1
	let tempo = start
	let durchlauf = 1

	return {
		current: () => tempo,
		passes: () => durchlauf,
		finished: () => tempo === target,
		/**
		 * Ein Durchlauf ist zu Ende; liefert das Tempo des naechsten. Am Ziel
		 * bleibt es stehen, statt darueber hinaus zu wachsen.
		 *
		 * @return {number}
		 */
		onLoopWrap() {
			durchlauf++
			const naechstes = tempo + richtung * step
			tempo = richtung > 0 ? Math.min(target, naechstes) : Math.max(target, naechstes)
			return tempo
		},
	}
}
