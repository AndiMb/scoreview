import { describe, expect, it } from 'vitest'
import { initialFollowState, KEEPS_FOLLOWING, reduce, TONE_MAX_AGE_MS, UNFOLLOWING } from './followState.js'

const NOW = 1790000000000

/**
 * Eine Serverantwort wie aus FollowController - nur die Teile, die der Test
 * aendert, werden angegeben.
 *
 * @param {object} teile Abweichungen vom Grundstand
 * @return {object}
 */
function body({ version = '101', session = 100, me = false, name = 'Anna', position = [0, null, null], loop = [0, null, null], tone = [0, null], serverNow = NOW } = {}) {
	return {
		version,
		active: true,
		serverNow,
		pollMs: 800,
		leader: { displayName: name, me },
		state: {
			session,
			position: { seq: position[0], measure: position[1], mark: position[2] },
			loop: { seq: loop[0], from: loop[1], to: loop[2] },
			tone: { seq: tone[0], issuedAt: tone[1] },
		},
	}
}

const ENDED = { version: '0', active: false, serverNow: NOW, pollMs: 800 }

/**
 * Spielt eine Folge von Ereignissen ab und gibt Endzustand und die Aktionen
 * je Schritt zurueck.
 *
 * @param {Array<object>} events Ereignisse fuer reduce
 * @param {object} [start] Ausgangszustand
 * @return {{local: object, steps: Array<Array<object>>}}
 */
function run(events, start = initialFollowState()) {
	let local = start
	const steps = []
	for (const event of events) {
		const result = reduce(local, event)
		local = result.local
		steps.push(result.actions)
	}
	return { local, steps }
}

const state = (b) => ({ type: 'state', body: b })

describe('followState.reduce - Position', () => {
	// [Beschreibung, Ereignisse, erwartete Aktionen des LETZTEN Schritts]
	const TABLE = [
		['Beitritt ohne gesendete Position: nichts', [state(body())], []],
		['Nachzuegler bekommt den letzten Stand', [state(body({ position: [3, 47, 'C'] }))], [{ type: 'seek', measure: 47, mark: 'C' }]],
		['gleicher Zaehler: kein zweiter Sprung', [state(body({ position: [3, 47, 'C'] })), state(body({ version: '102', position: [3, 47, 'C'] }))], []],
		['gestiegener Zaehler, gleicher Takt: springt erneut („nochmal ab C")', [state(body({ position: [3, 47, 'C'] })), state(body({ version: '102', position: [4, 47, 'C'] }))], [{ type: 'seek', measure: 47, mark: 'C' }]],
		['uebersprungene Zaehler: nur der letzte Stand', [state(body({ position: [1, 5, null] })), state(body({ version: '109', position: [7, 60, 'D'] }))], [{ type: 'seek', measure: 60, mark: 'D' }]],
		['gesunkener Zaehler in derselben Sitzung: nichts', [state(body({ position: [5, 10, null] })), state(body({ version: '102', position: [4, 3, null] }))], []],
		['eigenes Geraet der Leitung: kein Sprung', [state(body({ me: true, position: [3, 47, 'C'] }))], []],
		['Takt 0 wird nicht angesprungen', [state(body({ position: [2, 0, null] }))], []],
	]
	for (const [name, events, expected] of TABLE) {
		it(name, () => {
			const { steps } = run(events)
			expect(steps.at(-1)).toEqual(expected)
		})
	}
})

describe('followState.reduce - Folgen loesen und zurueckkehren', () => {
	for (const kind of UNFOLLOWING) {
		it(`„${kind}" loest das Folgen, danach springt nichts mehr`, () => {
			const { local, steps } = run([
				state(body({ position: [1, 5, null] })),
				{ type: 'navigate', kind },
				state(body({ version: '102', position: [2, 20, 'B'], loop: [1, 18, 22] })),
			])
			expect(local.following).toBe(false)
			expect(steps.at(-1)).toEqual([])
		})
	}

	for (const kind of KEEPS_FOLLOWING) {
		it(`„${kind}" (Blaettern/Zoom) laesst das Folgen an`, () => {
			const { local, steps } = run([
				state(body({ position: [1, 5, null] })),
				{ type: 'navigate', kind },
				state(body({ version: '102', position: [2, 20, 'B'] })),
			])
			expect(local.following).toBe(true)
			expect(steps.at(-1)).toEqual([{ type: 'seek', measure: 20, mark: 'B' }])
		})
	}

	it('unbekannte Bedienung loest nichts', () => {
		const { local } = run([state(body()), { type: 'navigate', kind: 'irgendwas' }])
		expect(local.following).toBe(true)
	})

	it('ohne Sitzung aendert eigenes Navigieren nichts', () => {
		const { local } = run([{ type: 'navigate', kind: 'seek' }])
		expect(local).toEqual(initialFollowState())
	})

	it('die Leitung selbst loest sich nicht', () => {
		const { local } = run([state(body({ me: true })), { type: 'navigate', kind: 'seek' }])
		expect(local.following).toBe(true)
	})

	it('„Zurueck zur Leitung" wendet Position und Loop des letzten Stands an', () => {
		const { local, steps } = run([
			state(body({ position: [1, 5, null] })),
			{ type: 'navigate', kind: 'noteClick' },
			state(body({ version: '102', position: [2, 20, 'B'], loop: [1, 18, 22], tone: [1, NOW] })),
			{ type: 'resume' },
		])
		expect(local.following).toBe(true)
		// Kein Ton: Er galt einem Augenblick, der vorbei ist.
		expect(steps.at(-1)).toEqual([{ type: 'seek', measure: 20, mark: 'B' }, { type: 'setLoop', from: 18, to: 22 }])
	})

	it('„Zurueck" nach aufgehobenem Loop hebt auch hier auf', () => {
		const { steps } = run([
			state(body({ loop: [1, 18, 22] })),
			{ type: 'navigate', kind: 'loop' },
			state(body({ version: '102', loop: [2, null, null] })),
			{ type: 'resume' },
		])
		expect(steps.at(-1)).toEqual([{ type: 'clearLoop' }])
	})

	it('„Zurueck" ohne gesendete Angaben: nur wieder folgen', () => {
		const { local, steps } = run([state(body()), { type: 'navigate', kind: 'seek' }, { type: 'resume' }])
		expect(local.following).toBe(true)
		expect(steps.at(-1)).toEqual([])
	})

	it('nach „Zurueck" wirkt der naechste Sprung wieder', () => {
		const { steps } = run([
			state(body({ position: [1, 5, null] })),
			{ type: 'navigate', kind: 'measure' },
			{ type: 'resume' },
			state(body({ version: '103', position: [2, 9, null] })),
		])
		expect(steps.at(-1)).toEqual([{ type: 'seek', measure: 9, mark: null }])
	})
})

describe('followState.reduce - Loop', () => {
	const TABLE = [
		['Loop setzen', [state(body({ loop: [1, 40, 48] }))], [{ type: 'setLoop', from: 40, to: 48 }]],
		['Loop aufheben', [state(body({ loop: [1, 40, 48] })), state(body({ version: '102', loop: [2, null, null] }))], [{ type: 'clearLoop' }]],
		['Beitritt mit aufgehobenem Loop: eigener Loop bleibt', [state(body({ loop: [2, null, null] }))], []],
		['gleicher Zaehler: nichts', [state(body({ loop: [1, 40, 48] })), state(body({ version: '102', loop: [1, 40, 48] }))], []],
		['Leitung selbst: nichts', [state(body({ me: true, loop: [1, 40, 48] }))], []],
	]
	for (const [name, events, expected] of TABLE) {
		it(name, () => {
			expect(run(events).steps.at(-1)).toEqual(expected)
		})
	}
})

describe('followState.reduce - Anfangston', () => {
	const TABLE = [
		['frisch', 0, true],
		['1,5 s alt', 1500, true],
		['genau 2 s alt', TONE_MAX_AGE_MS, true],
		['2,001 s alt: verworfen', TONE_MAX_AGE_MS + 1, false],
		['nach einem Funkloch (30 s): verworfen', 30000, false],
		['Serveruhr knapp hinter der Ausgabe (negatives Alter)', -5, true],
	]
	for (const [name, age, plays] of TABLE) {
		it(name, () => {
			const { steps } = run([state(body({ tone: [1, NOW - age] }))])
			expect(steps.at(-1)).toEqual(plays ? [{ type: 'tone' }] : [])
		})
	}

	it('ein verworfener Ton kommt auch spaeter nicht nach', () => {
		const { steps } = run([
			state(body({ tone: [1, NOW - 10000] })),
			state(body({ version: '102', tone: [1, NOW - 10000], serverNow: NOW })),
		])
		expect(steps).toEqual([[], []])
	})

	it('ohne Zeitstempel kein Ton', () => {
		expect(run([state(body({ tone: [1, null] }))]).steps.at(-1)).toEqual([])
	})

	it('wer nicht folgt, hoert keinen Ton', () => {
		const { steps } = run([state(body()), { type: 'navigate', kind: 'seek' }, state(body({ version: '102', tone: [1, NOW] }))])
		expect(steps.at(-1)).toEqual([])
	})

	it('die Leitung hoert ihren eigenen Befehl nicht', () => {
		expect(run([state(body({ me: true, tone: [1, NOW] }))]).steps.at(-1)).toEqual([])
	})

	it('Sprung und Ton in einem Stand: erst springen, dann der Ton', () => {
		expect(run([state(body({ position: [1, 12, null], tone: [1, NOW] }))]).steps.at(-1))
			.toEqual([{ type: 'seek', measure: 12, mark: null }, { type: 'tone' }])
	})
})

describe('followState.reduce - Sitzungswechsel, Uebernahme, Ende', () => {
	it('Ende einer laufenden Sitzung meldet „ended" und setzt zurueck', () => {
		const { local, steps } = run([state(body({ position: [2, 5, null] })), { type: 'navigate', kind: 'seek' }, state(ENDED)])
		expect(steps.at(-1)).toEqual([{ type: 'ended' }])
		expect(local).toEqual({ ...initialFollowState(), version: '0' })
	})

	it('ohne Sitzung meldet ein weiterer leerer Stand kein zweites Ende', () => {
		expect(run([state(ENDED), state(ENDED)]).steps).toEqual([[], []])
	})

	it('neue Sitzung: alte Zaehler gelten nicht, niedrigere Zaehler springen', () => {
		const { steps } = run([
			state(body({ session: 100, version: '105', position: [5, 30, null] })),
			state(body({ session: 777, version: '778', position: [1, 3, null] })),
		])
		expect(steps.at(-1)).toEqual([{ type: 'seek', measure: 3, mark: null }])
	})

	it('neue Sitzung: wer sich geloest hatte, folgt wieder', () => {
		const { local } = run([
			state(body({ session: 100 })),
			{ type: 'navigate', kind: 'seek' },
			state(body({ session: 777, version: '777' })),
		])
		expect(local.following).toBe(true)
	})

	it('Uebernahme durch eine andere Leitung wird gemeldet, Zaehler laufen weiter', () => {
		const { local, steps } = run([
			state(body({ position: [2, 5, null] })),
			state(body({ version: '102', name: 'Bert', position: [2, 5, null] })),
		])
		expect(steps.at(-1)).toEqual([{ type: 'leaderChanged', name: 'Bert' }])
		expect(local.leaderName).toBe('Bert')
	})

	it('wird man selbst zur Leitung, springt das eigene Geraet nicht', () => {
		const { local, steps } = run([
			state(body({ position: [2, 5, null] })),
			state(body({ version: '102', me: true, name: 'Carla', position: [3, 9, null] })),
		])
		expect(local.mine).toBe(true)
		expect(steps.at(-1)).toEqual([{ type: 'leaderChanged', name: 'Carla' }])
	})

	it('unbekanntes Ereignis und kaputte Antwort aendern nichts', () => {
		const start = initialFollowState()
		expect(reduce(start, { type: 'unsinn' })).toEqual({ local: start, actions: [] })
		expect(reduce(start, { type: 'state', body: null })).toEqual({ local: start, actions: [] })
	})

	it('reduce veraendert den uebergebenen Zustand nicht', () => {
		const start = initialFollowState()
		const kopie = JSON.parse(JSON.stringify(start))
		reduce(start, state(body({ position: [1, 5, null], loop: [1, 2, 3], tone: [1, NOW] })))
		expect(start).toEqual(kopie)
	})
})
