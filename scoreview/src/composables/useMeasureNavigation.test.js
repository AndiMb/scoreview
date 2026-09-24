import { describe, expect, it, vi } from 'vitest'
// Das Taktfeld ist Anzeige UND Eingabe zugleich. Die Fehler, gegen die das
// hier steht: die Wiedergabe ueberschreibt die gerade getippte Zahl, ein
// Sprung im Aufführungsmodus geht trotz Sperre durch, und ein Sprung der
// Leitung meldet sich als eigenes Navigieren und loest damit das Folgen.
import { nextTick, ref } from 'vue'
import { buildTimeline } from '../lib/scoreLayout.js'
import { useMeasureNavigation } from './useMeasureNavigation.js'

// Fuenf Takte zu je 2 s; elid = Takt - 1.
const MEASURES = buildTimeline({
	events: [0, 1, 2, 3, 4].map((elid) => ({ elid, timeMs: elid * 2000 })),
	elements: {},
})
const MARKS = [{ measure: 1, text: 'A' }, { measure: 3, text: 'B' }]

/**
 * @param {object} [options]
 * @param {boolean} [options.allowed] was die Policy fuer 'seek' sagt
 */
function setup({ allowed = true } = {}) {
	const time = ref(0)
	const seek = vi.fn()
	const onNavigate = vi.fn()
	const forceAutoScrollFor = vi.fn()
	const nav = useMeasureNavigation({
		measuresTimeline: () => MEASURES,
		durationMs: () => 10000,
		displayTimeMs: () => time.value,
		currentElid: () => 5,
		currentEtag: () => 'etag',
		clock: () => ({ seek }),
		marks: () => MARKS,
		totalMeasures: () => 5,
		can: () => allowed,
		onNavigate,
		forceAutoScrollFor,
	})
	return { nav, time, seek, onNavigate, forceAutoScrollFor }
}

describe('useMeasureNavigation', () => {
	it('bildet den Anker aus der gehoerten Stelle', () => {
		const { nav, time } = setup()
		time.value = 5000
		expect(nav.currentAnchor.value).toEqual({ measureNumber: 3, fraction: 0.5, elid: 5, anchorEtag: 'etag' })
	})

	it('fuehrt das Feld mit Studierbuchstaben nach - aber nicht, waehrend darin getippt wird', async () => {
		const { nav, time } = setup()
		time.value = 6500
		await nextTick()
		expect(nav.input.value).toBe('4 (B+1)')

		nav.onFieldFocus({ target: { select: vi.fn() } })
		nav.input.value = '2'
		time.value = 8500
		await nextTick()
		expect(nav.input.value).toBe('2')

		// Beim Verlassen steht wieder da, wo die Wiedergabe ist.
		nav.onFieldBlur()
		expect(nav.input.value).toBe('5 (B+2)')
	})

	it('springt auf Zahl, Buchstabe und Buchstabe plus Abstand', () => {
		const { nav, seek, onNavigate } = setup()
		for (const [text, ms] of [['2', 2000], ['B', 4000], ['B+1', 6000]]) {
			nav.input.value = text
			nav.jumpToInput()
			expect(seek).toHaveBeenLastCalledWith(ms)
		}
		expect(onNavigate).toHaveBeenCalledWith('measure')
	})

	it('tut bei unbekannter Eingabe nichts, statt irgendwohin zu springen', () => {
		const { nav, seek, onNavigate } = setup()
		nav.input.value = 'Z'
		nav.jumpToInput()
		expect(seek).not.toHaveBeenCalled()
		expect(onNavigate).not.toHaveBeenCalled()
	})

	it('haelt sich an die Policy - eigene Spruenge sind im Aufführungsmodus gesperrt', () => {
		const { nav, seek, onNavigate } = setup({ allowed: false })
		nav.input.value = '3'
		nav.jumpToInput()
		nav.jumpRelative(1)
		nav.jumpToMark(MARKS[1])
		expect(seek).not.toHaveBeenCalled()
		expect(onNavigate).not.toHaveBeenCalled()
		// Der Aufklapper geht trotzdem zu.
		expect(nav.marksOpen.value).toBe(false)
	})

	it('laesst den Sprung der Leitung auch ohne Erlaubnis durch - ohne eigenes Navigieren zu melden', () => {
		const { nav, seek, onNavigate, forceAutoScrollFor } = setup({ allowed: false })
		expect(nav.followSeek(4)).toBe(6000)
		expect(seek).toHaveBeenCalledWith(6000)
		expect(forceAutoScrollFor).toHaveBeenCalledWith(1500)
		expect(onNavigate).not.toHaveBeenCalled()
		expect(nav.followSeek(99)).toBeNull()
	})

	it('geht mit den Pfeiltasten einen Takt weiter, nie vor Takt 1', () => {
		const { nav, time, seek } = setup()
		time.value = 2500
		nav.jumpRelative(1)
		expect(seek).toHaveBeenLastCalledWith(4000)
		time.value = 500
		nav.jumpRelative(-1)
		expect(seek).toHaveBeenLastCalledWith(0)
	})

	it('meldet der Leitung den Buchstaben nur auf genau seinem Takt', () => {
		const { nav, time } = setup()
		time.value = 4100
		expect(nav.followPosition()).toEqual({ measure: 3, mark: 'B' })
		time.value = 6100
		expect(nav.followPosition()).toEqual({ measure: 4, mark: null })
	})

	it('faengt nach reset() wieder bei Takt 1 an', () => {
		const { nav } = setup()
		nav.input.value = '4 (B+1)'
		nav.onFieldFocus()
		nav.reset()
		expect(nav.input.value).toBe('1')
	})
})
