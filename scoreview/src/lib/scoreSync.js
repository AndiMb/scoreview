import { findStepIndex } from './timingSync.js'

/**
 * Ordnet eine Wiedergabezeit dem aktuellen Notenkopf zu und meldet einen
 * Wechsel nach außen.
 *
 * Reine Fabrikfunktion, keine Reaktivität, kein Lifecycle - deshalb hier in
 * `lib/`, bei den anderen DOM-freien Modulen.
 *
 * **Keine eigene rAF-Schleife**: die Schleife der Transportanzeige in
 * `ScoreViewer.vue` treibt diese Funktion mit, statt eine zweite
 * Dauerschleife mit eigener Binärsuche pro Frame nebenherlaufen zu lassen.
 * Beide brauchen dieselbe Zeitquelle und denselben Takt, ununterbrochen,
 * solange der Viewer offen ist - das zählt gegen genau das Ziel, für das der
 * Wake Lock eingebaut ist: ein Tablet am Notenständer, über eine ganze Probe.
 *
 * Die Auflösung läuft JEDEN Frame, nicht nur während der Wiedergabe: der
 * Setter `sequencer.currentTime` in `player.js` wirkt NICHT synchron - der
 * unmittelbar danach im `seeked`-Ereignis gelesene Zeitwert wäre noch der
 * alte. Ohne Auflösung pro Frame bliebe der Cursor bei einem Sprung mit
 * angehaltener Wiedergabe stehen, während die Transportanzeige längst die
 * neue Zeit zeigte (gemessen an einem Sprung zu Takt 30: Zeit 1:29, Cursor
 * in Takt 1).
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
