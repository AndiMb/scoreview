// Die Rechnung hinter "Bild und Ton gehoeren zusammen" - rein, ohne DOM und
// ohne AudioContext, deshalb hier bei den uebrigen testbaren Modulen.
//
// Der Ausgangsbefund: `AudioContext.currentTime` (und damit
// `sequencer.currentTime` in lib/player.js) ist die Zeit des Audios, das
// gerade an das Ausgabegeraet UEBERGEBEN wurde - nicht die des Audios, das
// gerade an einem Ohr ankommt. Dazwischen liegt die Ausgabelatenz: am
// Desktop 10-30 ms, ueber Bluetooth A2DP gemessene 150-300 ms. Bei Viertel =
// 120 ist das eine Achtelnote, und der Cursor stuende die ganze Zeit dort, wo
// die Musik erst noch hinkommt.
//
// Ein Videoplayer loest dasselbe Problem seit jeher andersherum, als man
// zuerst denkt: Nicht der Ton kommt frueher, sondern das BILD wird spaeter
// gezeigt. Die Media-Pipeline des Browsers haengt die Videoframes an die
// hoerbare Audioposition. Genau das tut toDisplayTimeMs() fuer den Cursor.
//
// **Zwei Zeiten, nicht eine** - der eine Punkt, an dem sich hier alles
// entscheidet:
//
// - Die *Renderzeit* (was die Audiouhr sagt) bekommt alles, was gegen
//   dieselbe Audiouhr TERMINIERT oder springt: die Metronomklicks
//   (useMetronome.js reicht eine Restzeit an den AudioContext weiter), der
//   Loop-Ruecksprung, jedes seek().
// - Die *Anzeigezeit* bekommt alles, was zeigt, was gerade zu HOEREN ist:
//   Cursor, Autoscroll, Taktanzeige, Notiz-Anker, Suchlaufposition.
//
// Ein pauschaler Abzug in `player.js:getCurrentTimeMs()` waere deshalb falsch:
// Er verschoebe die Metronom-Terminierung gleich mit, und der Klick kaeme um
// die Latenz zu SPAET - der Fehler waere verdoppelt statt behoben.

// Groesser als das ist keine Ausgabelatenz mehr, sondern ein kaputter Wert
// (gesehen: 0 bei nicht implementiertem getOutputTimestamp, absurd grosse
// Werte bei suspendiertem Context). Dann lieber gar nicht korrigieren als
// falsch.
export const MAX_PLAUSIBLE_LATENCY_MS = 1000

// Grenzen des Werts von Hand. Negativ, weil auch der umgekehrte Fall
// vorkommen kann (die Automatik zieht zu viel ab); nach oben grosszuegig,
// weil aeltere Bluetooth-Kopfhoerer ohne Delay-Reporting weit jenseits
// dessen liegen koennen, was der Browser meldet.
export const MIN_MANUAL_OFFSET_MS = -100
export const MAX_MANUAL_OFFSET_MS = 500

/**
 * Die anzuwendende Latenz aus dem, was der Browser hergibt, plus dem Wert von
 * Hand.
 *
 * `measuredMs` hat Vorrang: Es ist die Differenz zwischen
 * `context.currentTime` und `context.getOutputTimestamp().contextTime`, also
 * die tatsaechlich am Geraet gemessene Position - dieselbe Groesse, mit der
 * die Media-Pipeline ein `<video>` an den Ton haengt. `reportedMs`
 * (`baseLatency + outputLatency`) ist der Rueckfall, wo
 * `getOutputTimestamp()` nichts Brauchbares liefert.
 *
 * Beide sagen allerdings nur, was das SYSTEM weiss. Ob der Bluetooth-Anteil
 * darin steckt, haengt daran, ob der Kopfhoerer seine Verzoegerung per
 * AVDTP-Delay-Reporting nennt und Android sie durchreicht - deshalb der
 * Wert von Hand, und deshalb ist er kein Feinschliff, sondern moeglicherweise
 * der groessere Teil.
 *
 * @param {object} params
 * @param {?number} params.measuredMs aus getOutputTimestamp(), oder null
 * @param {?number} params.reportedMs baseLatency + outputLatency, oder null
 * @param {number} [params.manualOffsetMs] von Hand nachgestellt
 * @return {number} Latenz in ms, nie NaN
 */
export function resolveLatencyMs({ measuredMs, reportedMs, manualOffsetMs = 0 }) {
	const automatic = plausibleLatency(measuredMs) ?? plausibleLatency(reportedMs) ?? 0
	const manual = Number.isFinite(manualOffsetMs) ? manualOffsetMs : 0
	return automatic + manual
}

/**
 * @param {?number} value
 * @return {?number} der Wert, wenn er als Latenz taugt, sonst null
 */
function plausibleLatency(value) {
	if (!Number.isFinite(value) || value <= 0 || value > MAX_PLAUSIBLE_LATENCY_MS) {
		return null
	}
	return value
}

/**
 * Renderzeit -> Anzeigezeit.
 *
 * Der Tempofaktor gehoert dazu, weil `playbackRate` die Zeitachse streckt:
 * Die Latenz ist in echten Sekunden gemessen, die Zeitachse laeuft mit dem
 * Faktor schneller oder langsamer (siehe player.js, setTempo). Bei halbem
 * Tempo entsprechen 200 ms Ausgabelatenz nur 100 ms Zeitachse.
 *
 * @param {number} renderTimeMs was die Audiouhr sagt
 * @param {number} latencyMs aus resolveLatencyMs()
 * @param {number} [tempoFactor] playbackRate
 * @return {number} nie negativ - vor dem Stueckanfang gibt es nichts zu zeigen
 */
export function toDisplayTimeMs(renderTimeMs, latencyMs, tempoFactor = 1) {
	if (!Number.isFinite(renderTimeMs)) {
		return 0
	}
	const factor = Number.isFinite(tempoFactor) && tempoFactor > 0 ? tempoFactor : 1
	return Math.max(0, renderTimeMs - latencyMs * factor)
}

/**
 * Traegt einen laufend neu gemessenen Wert nach, ohne sein Rauschen
 * mitzunehmen.
 *
 * Gebraucht fuer die Latenz: `getOutputTimestamp().contextTime` wird nur beim
 * Audio-Callback fortgeschrieben, die Differenz zu `currentTime` schwankt
 * zwischen zwei Callbacks deshalb um bis zu eine Pufferlaenge. Ungeglaettet
 * zoege der Cursor diese Schwankung mit.
 *
 * @param {number} [factor] Anteil, mit dem ein neuer Wert einfliesst (0-1)
 * @return {{update: (raw: number) => number, value: () => number, reset: () => void}}
 */
export function createLatencySmoother(factor = 0.05) {
	let current = null

	return {
		update(raw) {
			if (!Number.isFinite(raw)) {
				return current ?? 0
			}
			current = current === null ? raw : current + (raw - current) * factor
			return current
		},
		value() {
			return current ?? 0
		},
		reset() {
			current = null
		},
	}
}

// Ab dieser Abweichung ist es kein Stottern der Audiouhr mehr, sondern ein
// Sprung (seek, Loop-Neustart, Tempowechsel) - dann wird nicht angeglichen,
// sondern uebernommen.
const DEFAULT_MAX_DRIFT_MS = 60

// Anteil der verbleibenden Abweichung, der je Frame aufgeholt wird. Klein
// genug, dass ein Stotterer nicht sichtbar wird; gross genug, dass die
// vorhergesagte Zeit nicht davonlaeuft (bei 60 Hz nach ~10 Frames, also
// gut 0,15 s, wieder auf der Audiouhr).
const DEFAULT_CATCH_UP = 0.1

/**
 * Glaettet die Wiedergabezeit fuer die Anzeige.
 *
 * `AudioContext.currentTime` schreibt auf manchen Android-Builds in groben
 * Schritten fort statt gleichmaessig - der Cursor zittert dann, obwohl der
 * Ton gleichmaessig laeuft. Diese Funktion sagt die Zeit zwischen zwei
 * Fortschreibungen aus `performance.now()` voraus und zieht sich langsam an
 * die Audiouhr heran, statt ihr sprunghaft zu folgen.
 *
 * Dasselbe Verfahren steckt in spessasynth_lib als
 * `sequencer.currentHighResolutionTime`. Bewusst hier nachgebaut statt von
 * dort genommen: So gilt es auch fuer lib/silentClock.js, es ist ohne
 * AudioContext testbar, und es steht an derselben Stelle wie die
 * Latenzrechnung, mit der es zusammen angewandt wird.
 *
 * @param {object} [options]
 * @param {number} [options.maxDriftMs]
 * @param {number} [options.catchUpFactor]
 * @return {{update: (audioTimeMs: number, nowMs: number, tempoFactor?: number) => number, reset: () => void}}
 */
export function createTimeSmoother({ maxDriftMs = DEFAULT_MAX_DRIFT_MS, catchUpFactor = DEFAULT_CATCH_UP } = {}) {
	let lastTimeMs = null
	let lastNowMs = 0

	return {
		/**
		 * @param {number} audioTimeMs was die Audiouhr sagt
		 * @param {number} nowMs performance.now()
		 * @param {number} [tempoFactor] playbackRate
		 * @return {number}
		 */
		update(audioTimeMs, nowMs, tempoFactor = 1) {
			if (!Number.isFinite(audioTimeMs)) {
				return lastTimeMs ?? 0
			}
			if (lastTimeMs === null) {
				lastTimeMs = audioTimeMs
				lastNowMs = nowMs
				return audioTimeMs
			}
			const factor = Number.isFinite(tempoFactor) && tempoFactor > 0 ? tempoFactor : 1
			const elapsed = Math.max(0, nowMs - lastNowMs) * factor
			let predicted = lastTimeMs + elapsed
			const drift = audioTimeMs - predicted
			if (Math.abs(drift) > maxDriftMs) {
				// Ein Sprung, kein Stottern - die Vorhersage ist wertlos.
				predicted = audioTimeMs
			} else {
				predicted += drift * catchUpFactor
			}
			lastTimeMs = predicted
			lastNowMs = nowMs
			return predicted
		},

		reset() {
			lastTimeMs = null
			lastNowMs = 0
		},
	}
}
