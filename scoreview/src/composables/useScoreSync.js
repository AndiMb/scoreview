import { resolveCursorRect } from '../lib/scoreLayout.js'

/**
 * Treibt eine reaktive Cursor-Position aus einer Zeitquelle (bis Phase 9
 * lib/silentClock.js, danach lib/player.js - beide erfüllen dieselbe
 * kleine Schnittstelle, siehe dort). Reine rAF-Schleife, die reine
 * Zuordnungslogik (Zeit -> Element-Koordinate) steckt in
 * lib/scoreLayout.js.
 *
 * Tempo-unabhängig: die Zeitquelle liefert bereits Original-Partiturzeit,
 * kein Umrechnen hier - eine Tempoänderung (Phase 9) skaliert
 * `getCurrentTimeMs()` an der Quelle, nicht die Timingdaten selbst (siehe
 * PLAN.md Phase 8, "Tempo-unabhängig rechnen").
 *
 * Ersetzt vollständig den vorherigen OSMD-Cursor-Ansatz: kein
 * `countCursorSteps()` (lief die ganze Partitur nur zum Zählen durch), kein
 * ordinales Index-Matching, kein `currentIndex`-Sonderfall für den
 * allerersten Tick - der Overlay-Cursor braucht nichts davon, weil er kein
 * Renderer-interner Zustand ist, sondern bei jedem Tick direkt aus der Zeit
 * berechnet wird (siehe PLAN.md Abschnitt 2/4).
 *
 * @param {import('../lib/scoreLayout.js').Timeline} timeline
 * @param {{getCurrentTimeMs():number, isPlaying():boolean, addEventListener:(type: string, cb: () => void) => void, removeEventListener:(type: string, cb: () => void) => void}} clock
 * @param {(rect: {page:number,x:number,y:number,w:number,h:number}|null) => void} onCursorChange
 * @return {{ stop: () => void }}
 */
export function useScoreSync(timeline, clock, onCursorChange) {
	let rafHandle = null
	let lastRect

	function update() {
		const rect = resolveCursorRect(timeline, clock.getCurrentTimeMs())
		// Objektreferenz aus timeline.elements ist für dasselbe elid stabil
		// (siehe scoreLayout.js) - so löst ein unveränderter Notenkopf über
		// mehrere rAF-Frames hinweg keine unnötige Vue-Reaktivität aus.
		if (rect !== lastRect) {
			lastRect = rect
			onCursorChange(rect)
		}
	}

	// Bewusst JEDEN Frame, nicht nur während der Wiedergabe (Phase 22): ein
	// Sprung bei angehaltener Wiedergabe (Taktfeld, Klick auf eine Note,
	// Loop-Start) wirkte sonst nicht sichtbar. Grund ist der Setter
	// `sequencer.currentTime` in player.js - er wirkt NICHT synchron, der
	// unmittelbar danach aus dem 'seeked'-Ereignis gelesene Zeitwert war noch
	// der alte. Der Cursor blieb deshalb stehen, während die Transportanzeige
	// (eigene rAF-Schleife in ScoreViewer.vue) längst die neue Zeit zeigte -
	// gemessen an einem Sprung zu Takt 30, der die Zeit auf 1:29 setzte und
	// den Cursor in Takt 1 stehen ließ. Die Kosten sind eine Binärsuche pro
	// Frame; die Referenzgleichheit unten verhindert weiterhin jede unnötige
	// Vue-Reaktivität.
	function tick() {
		update()
		rafHandle = requestAnimationFrame(tick)
	}

	function onSeeked() {
		update()
	}

	clock.addEventListener('seeked', onSeeked)
	update()
	rafHandle = requestAnimationFrame(tick)

	function stop() {
		cancelAnimationFrame(rafHandle)
		clock.removeEventListener('seeked', onSeeked)
	}

	return { stop }
}
