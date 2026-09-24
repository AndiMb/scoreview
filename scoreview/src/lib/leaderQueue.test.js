import { describe, expect, it } from 'vitest'
import { emptyQueue, enqueue, isBusy, recordSend, sendDelay, settle, takeNext } from './leaderQueue.js'

const B = { measure: 3, mark: 'B' }
const C = { measure: 4, mark: 'C' }

/**
 * Wie useFollowSession: sofort losschicken, wenn nichts unterwegs ist.
 *
 * @param {object} queue
 * @param {object} action
 * @param {unknown} [waiter]
 */
function tap(queue, action, waiter) {
	return takeNext(enqueue(queue, action, waiter))
}

describe('leaderQueue', () => {
	it('schickt den ersten Tipp sofort', () => {
		const { queue, step } = tap(emptyQueue(), { type: 'position', position: B })
		expect(step).toMatchObject({ kind: 'patch', data: { position: B } })
		expect(queue.pending).toEqual([])
		expect(isBusy(queue)).toBe(true)
	})

	it('verliert den zweiten Tipp waehrend der laufenden Anfrage nicht', () => {
		let { queue } = tap(emptyQueue(), { type: 'position', position: B })
		queue = tap(queue, { type: 'position', position: C }).queue
		expect(queue.pending).toHaveLength(1)
		const next = takeNext(settle(queue))
		expect(next.step.data).toEqual({ position: C })
		expect(isBusy(settle(next.queue))).toBe(false)
	})

	it('laesst von mehreren wartenden Stellen nur die neueste uebrig', () => {
		let { queue } = tap(emptyQueue(), { type: 'position', position: { measure: 1, mark: 'A' } })
		for (const position of [B, C, B, C]) {
			queue = tap(queue, { type: 'position', position }).queue
		}
		expect(queue.pending).toHaveLength(1)
		expect(queue.pending[0].data).toEqual({ position: C })
	})

	it('verdraengt den Anfangston nie durch eine Stelle oder einen Loop', () => {
		let { queue } = tap(emptyQueue(), { type: 'position', position: B })
		queue = tap(queue, { type: 'tone' }).queue
		queue = tap(queue, { type: 'position', position: C }).queue
		queue = tap(queue, { type: 'loop', loop: { from: 2, to: 5 } }).queue
		expect(queue.pending[0].data).toEqual({ position: C, tone: true, loop: { from: 2, to: 5 } })
	})

	it('fasst zwei Tontipps waehrend einer Anfrage zu einem zusammen', () => {
		let { queue } = tap(emptyQueue(), { type: 'tone' })
		queue = tap(queue, { type: 'tone' }).queue
		queue = tap(queue, { type: 'tone' }).queue
		expect(queue.pending).toEqual([expect.objectContaining({ data: { tone: true } })])
	})

	it('laesst beim Loop das Neueste gelten, auch zwischen Setzen und Aufheben', () => {
		let { queue } = tap(emptyQueue(), { type: 'tone' })
		queue = tap(queue, { type: 'loop', loop: { from: 2, to: 5 } }).queue
		queue = tap(queue, { type: 'loop', loop: null }).queue
		expect(queue.pending[0].data).toEqual({ clearLoop: true })
		queue = tap(queue, { type: 'loop', loop: { from: 7, to: 9 } }).queue
		expect(queue.pending[0].data).toEqual({ loop: { from: 7, to: 9 } })
	})

	it('schickt nie parallel', () => {
		const first = tap(emptyQueue(), { type: 'position', position: B })
		expect(first.step).not.toBeNull()
		const second = tap(first.queue, { type: 'position', position: C })
		expect(second.step).toBeNull()
		expect(second.queue.inflight.data.position).toEqual(B)
	})

	it('laesst Beenden alles Wartende verdraengen und reicht die Wartenden weiter', () => {
		let { queue } = tap(emptyQueue(), { type: 'position', position: B }, 'w1')
		queue = tap(queue, { type: 'position', position: C }, 'w2').queue
		queue = tap(queue, { type: 'end' }, 'w3').queue
		expect(queue.pending).toEqual([{ kind: 'session', method: 'delete', data: undefined, last: 'end', waiters: ['w2', 'w3'] }])
		expect(queue.inflight.waiters).toEqual(['w1'])
	})

	it('stellt Tipps nach einem Start hinter den Start, nie davor', () => {
		let { queue } = tap(emptyQueue(), { type: 'tone' })
		queue = tap(queue, { type: 'start', data: { measure: 1 } }).queue
		queue = tap(queue, { type: 'position', position: C }).queue
		expect(queue.pending.map((s) => s.kind)).toEqual(['session', 'patch'])
		const first = takeNext(settle(queue))
		expect(first.step.method).toBe('post')
		const second = takeNext(settle(first.queue))
		expect(second.step.data).toEqual({ position: C })
	})

	it('macht aus einem Doppeltipp auf Starten keinen zweiten Start', () => {
		let { queue } = tap(emptyQueue(), { type: 'start', data: {} }, 'w1')
		queue = tap(queue, { type: 'start', data: {} }, 'w2').queue
		expect(queue.pending).toEqual([])
		expect(queue.inflight.waiters).toEqual(['w1', 'w2'])
	})

	it('merkt sich die Art des letzten Tipps fuer die Fehlermeldung', () => {
		let { queue } = tap(emptyQueue(), { type: 'tone' })
		queue = tap(queue, { type: 'position', position: B }).queue
		queue = tap(queue, { type: 'tone' }).queue
		expect(queue.pending[0].last).toBe('tone')
	})
})

describe('sendDelay', () => {
	const budget = { limit: 3, periodMs: 1000 }

	it('laesst unter dem Budget sofort senden', () => {
		expect(sendDelay([], 0, budget)).toBe(0)
		expect(sendDelay([0, 100], 200, budget)).toBe(0)
	})

	it('wartet bei vollem Fenster, bis der aelteste Versand herausfaellt', () => {
		expect(sendDelay([0, 100, 200], 300, budget)).toBe(700)
		expect(sendDelay([0, 100, 200], 1000, budget)).toBe(0)
	})

	it('haelt die Sendezeiten auf das Fenster begrenzt', () => {
		expect(recordSend([0, 100, 900], 1050, budget)).toEqual([100, 900, 1050])
	})
})
