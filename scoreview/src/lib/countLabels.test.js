import { describe, expect, it } from 'vitest'
import { countLabels, countText } from './countLabels.js'
import { meterOf } from './scoreFacts.js'

const fourFour = { ...meterOf(4, 4), tick: 0 }
const sixEight = { ...meterOf(6, 8), tick: 1920 }
const pickup = { ...meterOf(4, 4, 480), tick: 0 }

describe('countText', () => {
	it('numbers the beats of a simple metre and marks the halves with +', () => {
		expect([0, 240, 480, 720, 960, 1440].map((t) => countText(fourFour, t))).toEqual(['1', '+', '2', '+', '3', '4'])
	})

	it('leaves sixteenths and triplets blank', () => {
		expect(countText(fourFour, 120)).toBe('')
		expect(countText(fourFour, 160)).toBe('')
		expect(countText(fourFour, 360)).toBe('')
	})

	it('numbers every eighth of a compound metre', () => {
		expect([0, 240, 480, 720, 960, 1200].map((t) => countText(sixEight, t))).toEqual(['1', '2', '3', '4', '5', '6'])
		expect(countText(sixEight, 120)).toBe('')
	})

	it('counts a pickup from its end', () => {
		expect(countText(pickup, 0)).toBe('4')
		expect(countText(pickup, 240)).toBe('+')
		const halfBar = { ...meterOf(4, 4, 960), tick: 0 }
		expect([0, 480].map((t) => countText(halfBar, t))).toEqual(['3', '4'])
	})

	it('keeps counting in a measure longer than its signature', () => {
		const long = { ...meterOf(4, 4, 2400), tick: 0 }
		expect(countText(long, 1920)).toBe('5')
	})
})

describe('countLabels', () => {
	const meters = [fourFour, sixEight]
	const spellings = [
		{ elid: 0, staff: 0, voice: 0, tick: 0, notes: [[60, 14]] },
		{ elid: 0, staff: 1, voice: 0, tick: 0, notes: [[48, 14]] },
		{ elid: 1, staff: 0, voice: 0, tick: 480, notes: [[62, 16]] },
		{ elid: 2, staff: 0, voice: 0, tick: 600, notes: [[64, 18]] },
		{ elid: 3, staff: 0, voice: 1, tick: 720, notes: [[64, 18]] },
		{ elid: 4, staff: 0, voice: 0, tick: 1920, notes: [[65, 13]] },
		{ elid: 5, staff: 0, voice: 0, tick: 2640, notes: [[67, 15]] },
		{ elid: 6, staff: 0, voice: 0, tick: 9999, notes: [[67, 15]] },
	]

	it('labels the first voice by elid, across staves, and skips the rest', () => {
		expect([...countLabels({ meters, spellings })]).toEqual([[0, '1'], [1, '2'], [4, '1'], [5, '4']])
	})

	it('can label another voice', () => {
		expect([...countLabels({ meters, spellings, voice: 1 })]).toEqual([[3, '+']])
	})

	it('needs engine meters with ticks', () => {
		expect(countLabels({ meters: [meterOf(4, 4)], spellings }).size).toBe(0)
		expect(countLabels({ meters: [], spellings }).size).toBe(0)
		expect(countLabels({ meters, spellings: null }).size).toBe(0)
		expect(countLabels({ meters, spellings: [{ elid: 0, voice: 0 }] }).size).toBe(0)
	})
})
