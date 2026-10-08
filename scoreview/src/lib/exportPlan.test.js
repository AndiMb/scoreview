import { describe, expect, it } from 'vitest'
import { COACH_PROGRAM } from './coachMix.js'
import { buildExportPlan, plansForAllParts, TAIL_MS } from './exportPlan.js'

// vier 4/4-Takte zu je 2000 ms bei 120 BPM
const measures = { events: [{ timeMs: 0 }, { timeMs: 2000 }, { timeMs: 4000 }, { timeMs: 6000 }] }
const volumes = new Map([[1, 127], [0, 40]])
const pans = new Map([[0, -1], [1, 1]])

describe('buildExportPlan', () => {
	it('uebernimmt die Mischung je Kanal, sortiert', () => {
		const plan = buildExportPlan({ volumes, pans, programs: new Map([[1, 0]]), durationMs: 8000 })
		expect(plan.channels).toEqual([
			{ channel: 0, volume: 40, pan: -1, program: null },
			{ channel: 1, volume: 127, pan: 1, program: 0 },
		])
	})

	it('rendert das ganze Stueck mit Ausklang', () => {
		const plan = buildExportPlan({ volumes, pans, durationMs: 8000 })
		expect(plan.startMs).toBe(0)
		expect(plan.endMs).toBe(8000)
		expect(plan.outputSeconds).toBe((8000 + TAIL_MS) / 1000)
	})

	it('rechnet das Tempo in die Laenge ein', () => {
		const plan = buildExportPlan({ volumes, pans, durationMs: 8000, rate: 0.8 })
		expect(plan.outputSeconds).toBeCloseTo((8000 / 0.8 + TAIL_MS) / 1000)
	})

	it('beschraenkt auf den Loop', () => {
		const plan = buildExportPlan({ volumes, pans, durationMs: 8000, range: { fromMs: 2000, toMs: 6000 } })
		expect([plan.startMs, plan.endMs]).toEqual([2000, 6000])
	})

	it('klickt jeden Schlag mit betonter Eins', () => {
		const plan = buildExportPlan({ volumes, pans, durationMs: 8000, measures, metronome: { everyBeat: true }, baseBpm: 120 })
		expect(plan.clicks).toHaveLength(16)
		expect(plan.clicks[0]).toEqual({ timeMs: 0, accent: true })
		expect(plan.clicks[1]).toEqual({ timeMs: 500, accent: false })
		expect(plan.clicks[4]).toEqual({ timeMs: 2000, accent: true })
	})

	it('klickt nur die Eins, wenn so eingestellt', () => {
		const plan = buildExportPlan({ volumes, pans, durationMs: 8000, measures, metronome: { everyBeat: false } })
		expect(plan.clicks.map((c) => c.timeMs)).toEqual([0, 2000, 4000, 6000])
	})

	it('klickt im Loop nur im Bereich', () => {
		const plan = buildExportPlan({ volumes, pans, durationMs: 8000, measures, metronome: { everyBeat: false }, range: { fromMs: 2000, toMs: 6000 } })
		expect(plan.clicks.map((c) => c.timeMs)).toEqual([2000, 4000])
	})

	it('ohne Metronom keine Klicks', () => {
		expect(buildExportPlan({ volumes, pans, durationMs: 8000, measures }).clicks).toEqual([])
	})

	it('nimmt die Transposition ganzzahlig', () => {
		expect(buildExportPlan({ volumes, pans, durationMs: 1, transpose: -2.7 }).transpose).toBe(-2)
	})
})

describe('plansForAllParts', () => {
	const mixerChannels = [
		{ channel: 0, partId: 'S', name: 'Sopran' },
		{ channel: 2, partId: 'A', name: 'Alt' },
		{ channel: 3, partId: 'A', name: 'Alt' },
	]
	const parts = [{ partId: 'S', name: 'Sopran' }, { partId: 'A', name: 'Alt' }, { partId: 'X', name: 'Leer' }]

	it('macht je Stimme einen Coach-Plan', () => {
		const plans = plansForAllParts({ mixerChannels, parts, othersLevel: 30, base: { durationMs: 1000, rate: 0.9 } })
		expect(plans.map((p) => p.name)).toEqual(['Sopran', 'Alt'])
		const alt = plans[1].plan
		expect(alt.channels.find((c) => c.channel === 2)).toEqual({ channel: 2, volume: 127, pan: 1, program: COACH_PROGRAM })
		expect(alt.channels.find((c) => c.channel === 0)).toMatchObject({ volume: 30, pan: -1 })
		expect(alt.rate).toBe(0.9)
	})
})
