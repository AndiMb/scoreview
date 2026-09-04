// Ob die Wiedergabe rundlaeuft - messbar statt gefuehlt. Rein, ohne DOM und
// ohne AudioContext, deshalb hier bei den uebrigen testbaren Modulen.
//
// Anlass: "bei der Wiedergabe der einzelnen Spuren scheint es nicht sauber zu
// synchronisieren" laesst zwei ganz verschiedene Ursachen zu, die dieselbe
// Beschreibung erzeugen - die Anzeige laeuft dem Ton VORAUS (Ausgabelatenz,
// siehe playbackTime.js), oder der Ton selbst SETZT AUS, weil die Synthese
// auf dem Geraet nicht mitkommt. Das eine ist eine Rechnung, das andere eine
// Frage der Rechenlast; ohne Messung ist beides nur eine Vermutung. Die
// Unterscheidung leistet der Zaehler hier.
//
// Verfahren: Waehrend der Wiedergabe muss die Audiouhr in derselben Zeit
// genauso weit laufen wie die Wanduhr (mal Tempofaktor). Bleibt sie in einem
// Fenster spuerbar zurueck, hat der Audiothread gestockt - und genau diese
// Fehlzeit ist es, die man als Knacken oder Verrutschen hoert.

// Fenster, ueber das verglichen wird. Ein einzelner Frame taugt nicht: Die
// Audiouhr wird in Bloecken fortgeschrieben, im 16-ms-Raster von rAF sieht
// sie deshalb immer ungleichmaessig aus. Ueber eine Sekunde mittelt sich das
// heraus, ein echter Aussetzer nicht.
const DEFAULT_WINDOW_MS = 1000

// Ab welchem Rueckstand ein Fenster als Aussetzer zaehlt. 10 % Reserve fuer
// die Messungenauigkeit der beiden Uhren gegeneinander.
const DEFAULT_TOLERANCE = 0.9

/**
 * Zaehlt Aussetzer des Audiothreads.
 *
 * @param {object} [options]
 * @param {number} [options.windowMs]
 * @param {number} [options.tolerance] Anteil des Solls, ab dem es als in
 *   Ordnung gilt (0-1)
 * @return {{
 *   update: (audioTimeMs: number, nowMs: number, playing: boolean, tempoFactor?: number) => void,
 *   count: () => number,
 *   lostMs: () => number,
 *   reset: () => void,
 * }}
 */
export function createDropoutCounter({ windowMs = DEFAULT_WINDOW_MS, tolerance = DEFAULT_TOLERANCE } = {}) {
	let windowStartNowMs = null
	let windowStartAudioMs = 0
	let dropouts = 0
	let lostMs = 0

	function restart(audioTimeMs, nowMs) {
		windowStartNowMs = nowMs
		windowStartAudioMs = audioTimeMs
	}

	return {
		/**
		 * Einmal je Frame, mit der ROHEN Audiozeit (nicht der geglaetteten -
		 * die wuerde genau das verstecken, was hier gesucht wird).
		 *
		 * @param {number} audioTimeMs
		 * @param {number} nowMs performance.now()
		 * @param {boolean} playing
		 * @param {number} [tempoFactor]
		 */
		update(audioTimeMs, nowMs, playing, tempoFactor = 1) {
			if (!playing || !Number.isFinite(audioTimeMs)) {
				windowStartNowMs = null
				return
			}
			if (windowStartNowMs === null) {
				restart(audioTimeMs, nowMs)
				return
			}
			const wallElapsed = nowMs - windowStartNowMs
			if (wallElapsed < windowMs) {
				return
			}
			const factor = Number.isFinite(tempoFactor) && tempoFactor > 0 ? tempoFactor : 1
			const expected = wallElapsed * factor
			const actual = audioTimeMs - windowStartAudioMs
			// Rueckwaertssprung (seek, Loop) ist kein Aussetzer - nur ein
			// Fenster, das nichts aussagt.
			if (actual >= 0 && actual < expected * tolerance) {
				dropouts += 1
				lostMs += expected - actual
			}
			restart(audioTimeMs, nowMs)
		},

		count() {
			return dropouts
		},

		lostMs() {
			return Math.round(lostMs)
		},

		reset() {
			windowStartNowMs = null
			windowStartAudioMs = 0
			dropouts = 0
			lostMs = 0
		},
	}
}

// Traegheit des Mittelwerts. Klein genug, dass ein Einbruch auffaellt, gross
// genug, dass die Zahl nicht flackert und ablesbar bleibt.
const DEFAULT_RATE_SMOOTHING = 0.05

/**
 * Bildrate der Zeitschleife als gleitender Mittelwert.
 *
 * Gehoert neben den Aussetzerzaehler: Eine eingebrochene Bildrate erklaert
 * einen hakenden Cursor, ohne dass am Ton etwas fehlt - wieder zwei Ursachen
 * mit derselben Beschreibung.
 *
 * @param {number} [smoothing]
 * @return {{update: (nowMs: number) => void, fps: () => number, reset: () => void}}
 */
export function createFrameRateMeter(smoothing = DEFAULT_RATE_SMOOTHING) {
	let lastNowMs = null
	let averageIntervalMs = null

	return {
		update(nowMs) {
			if (lastNowMs !== null) {
				const interval = nowMs - lastNowMs
				// Ein Tab im Hintergrund bekommt keine Frames; der erste
				// Frame danach ist Sekunden alt und wuerde den Mittelwert
				// unbrauchbar machen.
				if (interval > 0 && interval < 500) {
					averageIntervalMs = averageIntervalMs === null
						? interval
						: averageIntervalMs + (interval - averageIntervalMs) * smoothing
				}
			}
			lastNowMs = nowMs
		},

		fps() {
			return averageIntervalMs ? Math.round(1000 / averageIntervalMs) : 0
		},

		reset() {
			lastNowMs = null
			averageIntervalMs = null
		},
	}
}
