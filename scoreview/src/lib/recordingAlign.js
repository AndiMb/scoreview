// Aufnahme und Partitur auf eine Zeitachse legen - rein, ohne AudioContext.
//
// Die Aufnahme liegt zeitlich HINTER der Partitur, und zwar um zwei Anteile
// (docs/architecture.md, Abschnitt Mikrofon):
//
// - **Ausgabelatenz:** Die Saengerin hoert die Begleitung erst, nachdem sie
//   den Ausgabepuffer (und ueber Bluetooth das Funkstueck) durchlaufen hat,
//   und singt zu dem, was sie HOERT. Den Wert misst die App schon fuer den
//   Cursor (lib/playbackTime.js), er steckt im Bild/Ton-Abgleich - samt dem
//   Anteil von Hand.
// - **Eingangslatenz:** Ein Sample, das im Graphen ankommt, wurde um die
//   Eingangslatenz frueher gesungen. Der Browser nennt sie, wo er kann, in
//   `MediaStreamTrack.getSettings().latency`; dazu kommt
//   `AudioContext.baseLatency`, die Verarbeitungszeit des Kontexts selbst.
//
// Eine Zeitachse fuer alles: die Uhr des Wiedergabe-AudioContext. Das
// Aufnahme-Worklet stempelt jeden Block mit ihr (`currentFrame`), und die
// Partiturzeit haengt ueber einen **Anker** daran - ein Paar aus
// Kontextzeit und Partiturzeit, im selben Moment abgelesen. Der Sequencer
// rechnet seine Zeit selbst als (Kontextzeit - Start) × Tempo; der Anker
// reproduziert genau diese Gerade.
//
// Was als Restfehler bleibt, steht gemessen in docs/limits.md.

/** Groesser ist keine Eingangslatenz mehr, sondern ein kaputter Wert. */
export const MAX_PLAUSIBLE_INPUT_LATENCY_MS = 1000

/**
 * Die Eingangslatenz aus dem, was der Browser meldet.
 *
 * @param {object} params
 * @param {?number} params.trackLatencySec `getSettings().latency`, oft undefined
 * @param {?number} params.baseLatencySec `AudioContext.baseLatency`
 * @return {number} ms, nie NaN
 */
export function inputLatencyMs({ trackLatencySec, baseLatencySec }) {
	const teile = [trackLatencySec, baseLatencySec]
		.map((sec) => (Number.isFinite(sec) && sec > 0 ? sec * 1000 : 0))
	const summe = teile[0] + teile[1]
	return summe > MAX_PLAUSIBLE_INPUT_LATENCY_MS ? 0 : summe
}

/**
 * Partiturzeit zu einer Kontextzeit, ueber den Anker.
 *
 * @param {number} contextTimeSec
 * @param {{contextTimeSec:number, scoreMs:number}} anchor
 * @param {number} tempoFactor Partitur-ms je Echtzeit-ms
 * @return {number} Partiturzeit in ms
 */
export function scoreTimeAt(contextTimeSec, anchor, tempoFactor) {
	return anchor.scoreMs + (contextTimeSec - anchor.contextTimeSec) * 1000 * tempoFactor
}

/**
 * Zu welcher Partiturstelle ein aufgenommenes Sample gehoert.
 *
 * Das Sample kam zur Kontextzeit `c` im Graphen an. Gesungen wurde es um die
 * Eingangslatenz frueher, und gesungen wurde zu dem, was da gerade zu hoeren
 * war - gerendert also noch einmal um die Ausgabelatenz frueher.
 *
 * @param {object} params
 * @param {number} params.captureContextTimeSec Zeitstempel aus dem Worklet
 * @param {{contextTimeSec:number, scoreMs:number}} params.anchor
 * @param {number} params.tempoFactor
 * @param {number} params.outputLatencyMs angewandter Bild/Ton-Abgleich
 * @param {number} params.inputLatencyMs aus inputLatencyMs()
 * @return {number} Partiturzeit in ms
 */
export function captureToScoreMs({ captureContextTimeSec, anchor, tempoFactor, outputLatencyMs, inputLatencyMs: inMs }) {
	const gerendertSec = captureContextTimeSec - (outputLatencyMs + inMs) / 1000
	return scoreTimeAt(gerendertSec, anchor, tempoFactor)
}

/**
 * Partiturzeit des i-ten Samples einer gespeicherten Aufnahme.
 *
 * @param {{scoreStartMs:number, tempoFactor:number}} recording
 * @param {number} seconds Zeit in der Aufnahme
 * @return {number}
 */
export function recordingToScoreMs(recording, seconds) {
	return recording.scoreStartMs + seconds * 1000 * (recording.tempoFactor || 1)
}

/**
 * Umkehrung: die Stelle in der Aufnahme zu einer Partiturzeit.
 *
 * @param {{scoreStartMs:number, tempoFactor:number}} recording
 * @param {number} scoreMs
 * @return {number} Sekunden in der Aufnahme (auch negativ oder hinter dem Ende)
 */
export function scoreToRecordingSec(recording, scoreMs) {
	return (scoreMs - recording.scoreStartMs) / 1000 / (recording.tempoFactor || 1)
}

/**
 * Wann und ab wo die Aufnahme zu starten ist, damit sie mit dem Sequencer
 * zusammen klingt.
 *
 * Beide laufen durch denselben AudioContext und damit durch dieselbe
 * Ausgabelatenz - hier ist also nichts auszugleichen, nur dieselbe
 * Kontextzeit zu treffen. Gestartet wird ein wenig in der Zukunft
 * (`leadSec`), weil ein Start in der Vergangenheit vom Browser auf „sofort"
 * gezogen wird und damit um die verstrichene Zeit daneben laege.
 *
 * @param {object} params
 * @param {{scoreStartMs:number, tempoFactor:number, durationMs:number}} params.recording
 * @param {{contextTimeSec:number, scoreMs:number}} params.anchor jetzt abgelesen, Sequencer laeuft
 * @param {number} params.tempoFactor aktuelles Tempo des Sequencers
 * @param {number} [params.leadSec]
 * @return {?{whenSec:number, offsetSec:number}} null, wenn die Aufnahme an dieser Stelle schon vorbei ist
 */
export function playbackSchedule({ recording, anchor, tempoFactor, leadSec = 0.05 }) {
	const whenSec = anchor.contextTimeSec + leadSec
	const scoreAtWhen = scoreTimeAt(whenSec, anchor, tempoFactor)
	const offsetSec = scoreToRecordingSec(recording, scoreAtWhen)
	if (offsetSec >= recording.durationMs / 1000) {
		return null
	}
	if (offsetSec < 0) {
		// Die Aufnahme beginnt erst spaeter in der Partitur: so lange warten.
		// Umgerechnet mit dem Tempo des Sequencers, der bis dahin laeuft.
		const warteSec = (-offsetSec * (recording.tempoFactor || 1)) / (tempoFactor || 1)
		return { whenSec: whenSec + warteSec, offsetSec: 0 }
	}
	return { whenSec, offsetSec }
}

/**
 * Welches Tempo nach dem Abhoeren gelten soll. Fuers Abhoeren uebernimmt der
 * Sequencer das Tempo der Aufnahme (eine Aufnahme laesst sich nicht
 * strecken); danach soll wieder das eigene gelten - aber nur, wenn es
 * waehrenddessen niemand umgestellt hat: Eine bewusste Aenderung waehrend
 * des Abhoerens ueberschreiben hiesse, dem Nutzer seine Einstellung zu nehmen.
 *
 * @param {object} args
 * @param {?number} args.before Tempo vor dem ersten Abhoeren, null = keins gemerkt
 * @param {?number} args.listened das fuer die Aufnahme gesetzte Tempo
 * @param {number} args.current das jetzt eingestellte Tempo
 * @return {?number} das wiederherzustellende Tempo oder null (nichts tun)
 */
export function tempoAfterListening({ before, listened, current }) {
	if (before === null || before === undefined || listened === null || listened === undefined) {
		return null
	}
	if (Math.abs(current - listened) > 1e-9 || Math.abs(before - listened) <= 1e-9) {
		return null
	}
	return before
}
