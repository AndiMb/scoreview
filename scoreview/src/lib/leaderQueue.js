/**
 * Die Warteschlange der Leitungs-Aktionen von „Folgt mir" (C): „der letzte
 * Tipp gewinnt".
 *
 * Eine Leitung tippt in der Probe oft zweimal kurz hintereinander („B - nein,
 * C"). Solange eine Anfrage unterwegs ist, darf die naechste nicht parallel
 * loslaufen: Der Server entscheidet ueber eine Versionspruefung (CAS in
 * FollowService::change), und zwei gleichzeitige Anfragen koennten in
 * beliebiger Reihenfolge ankommen - der aeltere Sprung laege dann ueber dem
 * neueren. Also streng nacheinander. Waehrend eine Anfrage laeuft, sammeln sich
 * die Tipps hier und gehen gleich danach als EINE Anfrage raus:
 *
 * - **Stelle** (Sprung, Studierbuchstabe, „meine Stelle"): nur die neueste
 *   zaehlt - die Folgenden sollen dort stehen, wo die Leitung zuletzt
 *   hingezeigt hat, nicht erst durch alle Zwischenstellen wandern.
 * - **Loop** (setzen oder fuer alle aufheben): ebenso nur der neueste.
 * - **Anfangston**: ein Ausloeser, kein Zustand - er wird nie von einem
 *   anderen Tipp verdraengt. Mehrere Tontipps waehrend EINER laufenden Anfrage
 *   werden aber zu einem: Der zweite Ton striche den ersten nach Sekunden-
 *   bruchteilen ohnehin ab, zu hoeren waere derselbe eine Ton.
 *
 * Der Server nimmt Stelle, Loop und Ton in einem PATCH an (eine neue Version,
 * je ein eigener Zaehler) - deshalb verschmelzen die gesammelten Tipps zu einem
 * Schritt statt zu mehreren Anfragen.
 *
 * Starten und Beenden sind keine Aenderung einer Sitzung, sondern ihr Rahmen:
 * Sie verdraengen alles, was davor noch wartete (eine Stelle fuer eine Sitzung,
 * die gleich endet, hat keinen Empfaenger; ein Start nimmt die eigene Stelle
 * ohnehin mit), und alles, was danach getippt wird, geht erst nach ihnen raus.
 *
 * Rein und ohne Netz testbar; das Senden selbst steht in useFollowSession.js.
 * Wer auf das Ergebnis eines Tipps wartet, haengt ein `waiter` an - die
 * Warteschlange reicht die Wartenden beim Verschmelzen an den Schritt weiter,
 * der den Tipp traegt, sieht sie aber nie an.
 */

/**
 * Anfragen je Zeitfenster, die sich die Warteschlange hoechstens erlaubt.
 * Der Server laesst 120 PATCH je 60 s zu (FollowController::update); das
 * Lebenszeichen und ein zweites Geraet derselben Leitung brauchen auch
 * Platz. Wird das Budget knapp, wartet der naechste Schritt - und sammelt
 * derweil weitere Tipps ein, statt am Ratenlimit abzuprallen.
 */
export const SEND_BUDGET = { limit: 100, periodMs: 60000 }

/** @return {{inflight: ?object, pending: object[]}} */
export function emptyQueue() {
	return { inflight: null, pending: [] }
}

/**
 * @param {object} step
 * @return {boolean}
 */
function isSession(step) {
	return step?.kind === 'session'
}

/**
 * Einen Tipp in den (noch nicht gesendeten) PATCH-Koerper einarbeiten.
 *
 * @param {object} data bisheriger Koerper
 * @param {object} action
 * @return {object}
 */
function mergeInto(data, action) {
	const next = { ...data }
	switch (action.type) {
		case 'position':
			next.position = action.position
			break
		case 'loop':
			// Setzen und Aufheben sind dieselbe Art - der neuere gilt.
			delete next.loop
			delete next.clearLoop
			if (action.loop) {
				next.loop = action.loop
			} else {
				next.clearLoop = true
			}
			break
		case 'tone':
			next.tone = true
			break
		default:
			break
	}
	return next
}

/**
 * Einen Tipp einreihen.
 *
 * @param {{inflight: ?object, pending: object[]}} queue
 * @param {{type: 'start'|'end'|'position'|'loop'|'tone', data?: object, position?: object, loop?: ?object}} action
 * @param {unknown} [waiter] wird an den Schritt gehaengt, der den Tipp traegt
 * @return {{inflight: ?object, pending: object[]}}
 */
export function enqueue(queue, action, waiter) {
	const waiters = waiter === undefined ? [] : [waiter]
	if (action.type === 'start' || action.type === 'end') {
		const method = action.type === 'start' ? 'post' : 'delete'
		// Doppeltipp auf „Starten": Laeuft genau dieser Schritt schon und
		// wartet nichts dahinter, waere ein zweiter derselbe Wunsch.
		if (queue.pending.length === 0 && isSession(queue.inflight) && queue.inflight.method === method) {
			return { ...queue, inflight: { ...queue.inflight, waiters: [...queue.inflight.waiters, ...waiters] } }
		}
		// Verdraengt wird, was wartete - die Wartenden erfahren das Ergebnis
		// des Schritts, der ihren Tipp ueberholt hat.
		const carried = queue.pending.flatMap((step) => step.waiters)
		return {
			...queue,
			pending: [{
				kind: 'session',
				method,
				data: action.data,
				last: action.type,
				waiters: [...carried, ...waiters],
			}],
		}
	}
	const tail = queue.pending[queue.pending.length - 1]
	if (tail && !isSession(tail)) {
		const merged = { ...tail, data: mergeInto(tail.data, action), last: action.type, waiters: [...tail.waiters, ...waiters] }
		return { ...queue, pending: [...queue.pending.slice(0, -1), merged] }
	}
	return {
		...queue,
		pending: [...queue.pending, { kind: 'patch', data: mergeInto({}, action), last: action.type, waiters }],
	}
}

/**
 * Den naechsten Schritt losschicken - nur, wenn keiner unterwegs ist.
 *
 * @param {{inflight: ?object, pending: object[]}} queue
 * @return {{queue: {inflight: ?object, pending: object[]}, step: ?object}}
 */
export function takeNext(queue) {
	if (queue.inflight !== null || queue.pending.length === 0) {
		return { queue, step: null }
	}
	const [step, ...rest] = queue.pending
	return { queue: { inflight: step, pending: rest }, step }
}

/**
 * Der laufende Schritt ist beantwortet (Erfolg oder Fehler).
 *
 * @param {{inflight: ?object, pending: object[]}} queue
 * @return {{inflight: ?object, pending: object[]}}
 */
export function settle(queue) {
	return { ...queue, inflight: null }
}

/**
 * Ob noch etwas unterwegs ist oder wartet - fuer die dezente Anzeige.
 *
 * @param {{inflight: ?object, pending: object[]}} queue
 * @return {boolean}
 */
export function isBusy(queue) {
	return queue.inflight !== null || queue.pending.length > 0
}

/**
 * Wie lange der naechste Schritt warten muss, damit die Warteschlange ihr
 * Budget nicht ueberzieht (gleitendes Fenster ueber die eigenen Sendezeiten).
 *
 * @param {number[]} sentAt Sendezeitpunkte in ms, aufsteigend
 * @param {number} now
 * @param {{limit: number, periodMs: number}} [budget]
 * @return {number} 0 = sofort
 */
export function sendDelay(sentAt, now, budget = SEND_BUDGET) {
	const recent = sentAt.filter((t) => now - t < budget.periodMs)
	if (recent.length < budget.limit) {
		return 0
	}
	return recent[recent.length - budget.limit] + budget.periodMs - now
}

/**
 * Die Sendezeiten auf das Fenster kuerzen, damit die Liste nicht waechst.
 *
 * @param {number[]} sentAt
 * @param {number} now
 * @param {{limit: number, periodMs: number}} [budget]
 * @return {number[]}
 */
export function recordSend(sentAt, now, budget = SEND_BUDGET) {
	return [...sentAt.filter((t) => now - t < budget.periodMs), now]
}
