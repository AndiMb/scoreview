import { describe, expect, it } from 'vitest'
import { emptyPageDom, forgetSpellings } from './pageDom.js'

describe('emptyPageDom', () => {
	it('shares no container between two states', () => {
		const a = emptyPageDom()
		const b = emptyPageDom()
		a.highlighted.push(1)
		a.labelLayouts.set('k', {})
		expect(b.highlighted).toEqual([])
		expect(b.labelLayouts.size).toBe(0)
		expect(a.headYs).not.toBe(b.headYs)
	})

	it('keeps the page it belongs to', () => {
		const page = { markup: '<svg/>' }
		expect(emptyPageDom(page).page).toBe(page)
		expect(emptyPageDom().page).toBeNull()
	})
})

describe('forgetSpellings', () => {
	it('drops measured notes and layouts, keeps the indexes', () => {
		const dom = emptyPageDom()
		const index = new Map()
		dom.noteIndex = index
		dom.noteItems = [{}]
		dom.noteItemsMeasured = true
		dom.labelObstacles = []
		dom.labelLayouts.set('k', {})
		dom.labelScaleKey = 'k'
		forgetSpellings(dom)
		expect(dom).toMatchObject({ noteIndex: index, noteItems: [], noteItemsMeasured: false, labelObstacles: null, labelScaleKey: null })
		expect(dom.labelLayouts.size).toBe(0)
	})
})
