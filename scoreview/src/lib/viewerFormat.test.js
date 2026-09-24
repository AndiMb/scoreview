import { describe, expect, it } from 'vitest'
import { formatMs, formatTime, progressPercent } from './viewerFormat.js'

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
