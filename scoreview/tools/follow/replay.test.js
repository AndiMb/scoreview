import { describe, expect, it } from 'vitest'
import { createTuningState, fold12, similarity } from '../../src/lib/chroma.js'
import { buildFollowReference } from '../../src/lib/followRef.js'
import { generatePiece } from './piece.mjs'
import { featureFrames, fftSizeFor, followCase, syntheticCase } from './replay.mjs'
import { renderPerformance, truthAt } from './synth.mjs'

const piece = generatePiece()
const bar = (n) => n * piece.barMs
const reference = buildFollowReference(piece.notes, piece.parts, { durationMs: piece.durationMs })

/** Mean similarity of live frames to the tutti reference at the true position. */
function similarityAtTruth(performance, { tuning = createTuningState() } = {}) {
	const frames = featureFrames(performance.samples, performance.sampleRate)
	const tutti = reference.ensembles[0]
	const sims = []
	for (const frame of frames) {
		const scoreMs = truthAt(performance.truth, frame.atMs)
		if (scoreMs === null || !frame.c36) {
			continue
		}
		const f = Math.min(reference.frames - 1, Math.floor(scoreMs / reference.frameMs))
		if (tutti.silent[f]) {
			continue
		}
		const live = fold12(frame.c36, tuning).chroma
		sims.push(similarity(live, tutti.chroma.subarray(f * 12, f * 12 + 12)))
	}
	sims.sort((a, b) => a - b)
	return sims[Math.floor(sims.length / 2)]
}

describe('generatePiece', () => {
	it('is deterministic and has the planned shape', () => {
		const again = generatePiece()
		expect(again.notes).toEqual(piece.notes)
		expect(piece.measureStartsMs).toHaveLength(32)
		expect(piece.slices).toHaveLength(8)
		// The choir rests in the intro: only the piano channel sounds there.
		const intro = piece.notes.filter((n) => n.onMs < bar(2))
		expect(new Set(intro.map((n) => n.channel))).toEqual(new Set([piece.channels.piano]))
	})
})

describe('renderPerformance', () => {
	it('maps performance to score time and marks inserts as not sung', () => {
		const performance = renderPerformance(piece.notes, [
			{ type: 'play', fromMs: bar(2), toMs: bar(3), rate: 1.25 },
			{ type: 'speech', durMs: 1000 },
			{ type: 'play', fromMs: bar(10), toMs: bar(11) },
		], { pianoChannels: [piece.channels.piano] })
		const { truth } = performance
		// 2500 ms of score at 1.25x take 2000 ms.
		expect(truthAt(truth, 0)).toBeCloseTo(bar(2), -1)
		expect(truthAt(truth, 1000)).toBeCloseTo(bar(2) + 1250, -1)
		expect(truthAt(truth, 2500)).toBeNull()
		expect(truthAt(truth, 3100)).toBeCloseTo(bar(10) + 100, -1)
		expect(performance.events.map((e) => e.type)).toEqual(['play', 'speech', 'play'])
	})
})

describe('feature chain on synthetic sound', () => {
	it('matches the reference at the true position', () => {
		const performance = renderPerformance(piece.notes, [{ type: 'play', fromMs: bar(2), toMs: bar(6) }], { pianoChannels: [piece.channels.piano] })
		expect(similarityAtTruth(performance)).toBeGreaterThan(0.85)
	})

	it('keeps matching while an a-cappella choir sinks by 70 cents', () => {
		const voices = [0, 1, 2, 3]
		const performance = renderPerformance(piece.notes, [{ type: 'play', fromMs: bar(2), toMs: bar(10), channels: voices }], { driftCents: -70 })
		const tuning = createTuningState()
		expect(similarityAtTruth(performance, { tuning })).toBeGreaterThan(0.8)
		expect(tuning.cents).toBeLessThan(-45)
	})

	it('picks an FFT size of about 170 ms', () => {
		expect(fftSizeFor(48000)).toBe(8192)
		expect(fftSizeFor(22050)).toBe(4096)
	})
})

describe('score follower on synthetic cases (regression net, not proof)', () => {
	// Each case renders and follows 40-80 s of sound: a few seconds per test.
	const slow = 30000

	it('follows partial ensembles from an anchor: tenor alone, piano with soprano, bass alone (F24)', () => {
		const { metrics } = followCase(syntheticCase('partial'), { anchored: true })
		expect(metrics.a1WithinOneBar).toBeGreaterThan(0.95)
	}, slow)

	it('follows an a-cappella choir that sinks by 70 cents and skips the piano interlude', () => {
		const { metrics, replay } = followCase(syntheticCase('acappellaDrift'), { anchored: true })
		expect(metrics.a1WithinOneBar).toBeGreaterThan(0.95)
		expect(replay.at(-1).tuningCents).toBeLessThan(-60)
	}, slow)

	it('finds the place from cold within seconds, turns in time and never wrongly', () => {
		const { metrics, replay } = followCase(syntheticCase('tempo'))
		expect(replay.find((r) => r.phase === 'following').atMs).toBeLessThan(8000)
		expect(metrics.a2WrongJumps).toBe(0)
		expect(metrics.a2WrongTurns).toBe(0)
		expect(metrics.leadShortfalls).toBe(0)
	}, slow)

	it('starts an ensemble a semitone flat (R8: baroque pitch)', () => {
		const { metrics } = followCase(syntheticCase('lowPitch'))
		expect(metrics.a1WithinOneBar).toBeGreaterThan(0.9)
		expect(metrics.a2WrongJumps).toBe(0)
	}, slow)

	it('rehearsal: speech, jumps, a repeated passage - no wrong jump or turn, an offer where it is ambiguous', () => {
		const { metrics, replay } = followCase(syntheticCase('rehearsal'))
		expect(metrics.a2WrongJumps).toBe(0)
		expect(metrics.a2WrongTurns).toBe(0)
		expect(metrics.a6TurnsWhileSilent).toBe(0)
		// The restart in section C is found within four bars.
		expect(metrics.a3Refind.at(-1).bars).toBeLessThanOrEqual(4)
		// A' sounds exactly like A: lost with an offer, not a jump.
		expect(replay.some((r) => r.phase === 'lost')).toBe(true)
	}, slow)
})
