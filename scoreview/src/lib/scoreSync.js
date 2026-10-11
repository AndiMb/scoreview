import { findStepIndex } from './timingSync.js'

/**
 * Ordnet eine Wiedergabezeit dem aktuellen Notenkopf zu und meldet einen
 * Wechsel nach außen.
 *
 * Reine Fabrikfunktion, keine Reaktivität, kein Lifecycle - deshalb hier in
 * `lib/`, bei den anderen DOM-freien Modulen.
 *
 * **Keine eigene rAF-Schleife**: die Zeitschleife in `useScoreSession.js`
 * treibt diese Funktion mit, statt eine zweite Schleife mit eigener
 * Binärsuche pro Frame nebenherlaufen zu lassen. Beide brauchen dieselbe
 * Zeitquelle und denselben Takt.
 *
 * The resolution also runs while stopped, for a moment after every change
 * the clock announces (lib/timeLoopWake.js): the setter
 * `sequencer.currentTime` in `player.js` does NOT take effect synchronously -
 * the time read right after it in the `seeked` event is still the old one.
 * Without resolving on the following frames the cursor would stay put after
 * a jump while stopped, while the transport already showed the new time
 * (measured on a jump to measure 30: time 1:29, cursor in measure 1).
 *
 * Tempo-unabhängig: die Zeitquelle liefert bereits Original-Partiturzeit,
 * kein Umrechnen hier - eine Tempoänderung skaliert `getCurrentTimeMs()` an
 * der Quelle, nicht die Timingdaten selbst.
 *
 * @param {import('./scoreLayout.js').Timeline} timeline
 * @param {(rect: {page:number,x:number,y:number,w:number,h:number}|null) => void} onCursorChange
 * @return {{update: (timeMs: number) => ?number, reset: () => void}}
 */
export function createScoreSync(timeline, onCursorChange) {
	let lastRect

	return {
		/**
		 * Löst die Zeit auf, meldet einen Cursorwechsel und liefert das `elid`
		 * zurück - **eine** Binärsuche für beides. Vorher suchte der Viewer
		 * dasselbe `elid` in seiner eigenen Schleife ein zweites Mal, weil eine
		 * Notiz das `elid` explizit braucht und der Cursor nur das Rechteck.
		 *
		 * @param {number} timeMs
		 * @return {?number} elid an dieser Stelle, oder null bei leerer Zeitachse
		 */
		update(timeMs) {
			if (timeline.events.length === 0) {
				return null
			}
			const index = findStepIndex(timeline.times, timeMs)
			const { elid } = timeline.events[index]
			const rect = timeline.elements[String(elid)] ?? null
			// Objektreferenz aus timeline.elements ist für dasselbe elid stabil
			// (siehe scoreLayout.js) - so löst ein unveränderter Notenkopf über
			// mehrere Frames hinweg keine unnötige Vue-Reaktivität aus.
			if (rect !== lastRect) {
				lastRect = rect
				onCursorChange(rect)
			}
			return elid
		},

		reset() {
			lastRect = undefined
		},
	}
}
