import { describe, expect, it } from 'vitest'
import { formatDuration, formatMs, formatTime, progressPercent, seekValue } from './viewerFormat.js'

describe('formatTime', () => {
	it('schreibt Minuten und zweistellige Sekunden', () => {
		expect(formatTime(0)).toBe('0:00')
		expect(formatTime(9000)).toBe('0:09')
		expect(formatTime(61000)).toBe('1:01')
		expect(formatTime(600000)).toBe('10:00')
	})

	it('rundet ab statt auf', () => {
		expect(formatTime(59999)).toBe('0:59')
	})
})

describe('formatMs', () => {
	it('rundet auf ganze Millisekunden', () => {
		expect(formatMs(12.6)).toBe('13 ms')
		expect(formatMs(0)).toBe('0 ms')
	})

	it('zeigt fuer fehlende Angaben einen Strich statt 0', () => {
		expect(formatMs(null)).toBe('–')
		expect(formatMs(Number.NaN)).toBe('–')
		expect(formatMs(Number.POSITIVE_INFINITY)).toBe('–')
	})
})

describe('progressPercent', () => {
	it('rechnet den Anteil an der Dauer', () => {
		expect(progressPercent(2500, 10000)).toBe(25)
	})

	it('liefert ohne Dauer 0 statt NaN', () => {
		expect(progressPercent(500, 0)).toBe(0)
		expect(progressPercent(500, Number.NaN)).toBe(0)
	})

	it('kappt bei 100, wenn die Anzeigezeit das Ende ueberholt', () => {
		expect(progressPercent(10300, 10000)).toBe(100)
	})
})

describe('seekValue', () => {
	it('rundet auf das Raster ab', () => {
		expect(seekValue(0)).toBe(0)
		expect(seekValue(249)).toBe(0)
		expect(seekValue(1013.7)).toBe(1000)
		expect(seekValue(1250)).toBe(1250)
	})
	it('haelt unbrauchbare Werte auf 0', () => {
		expect(seekValue(-5)).toBe(0)
		expect(seekValue(NaN)).toBe(0)
		expect(seekValue(undefined)).toBe(0)
	})
})

describe('formatDuration', () => {
	it('rounds a length where formatTime floors a position', () => {
		expect(formatDuration(4800)).toBe('0:05')
		expect(formatTime(4800)).toBe('0:04')
		expect(formatDuration(125400)).toBe('2:05')
	})
	it('reads a missing length as zero', () => {
		expect(formatDuration(null)).toBe('0:00')
		expect(formatDuration(undefined)).toBe('0:00')
	})
})
