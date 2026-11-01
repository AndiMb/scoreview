import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

vi.mock('../l10n.js', () => ({
	translate: (app, text, vars) => text.replace(/\{(\w+)\}/g, (m, key) => String(vars?.[key] ?? m)),
}))

const { useSingView } = await import('./useSingView.js')

function storage(initial = {}) {
	const data = { ...initial }
	return {
		data,
		getItem: (key) => data[key] ?? null,
		setItem: (key, value) => {
			data[key] = value
		},
		removeItem: (key) => {
			delete data[key]
		},
	}
}

function setUp({ loop = { active: false, from: 1, to: 1 }, saved = [] } = {}) {
	const loopRef = ref(loop)
	const view = useSingView({
		pictureMeta: () => null,
		myStaves: () => null,
		timeline: () => null,
		loop: () => loopRef.value,
		savedLoops: () => saved,
		level: () => 'choir',
	})
	return { view, loopRef }
}

describe('useSingView', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('remembers the view in this browser', () => {
		const store = storage({ 'scoreview.singView': 'stage' })
		vi.stubGlobal('localStorage', store)
		const { view } = setUp()
		expect(view.view.value).toBe('stage')
		view.setView('anything')
		expect(view.view.value).toBe('band')
		expect(store.data['scoreview.singView']).toBe('band')
	})

	it('names the stretch of a run: whole piece, measures, or the saved loop', () => {
		const { view, loopRef } = setUp({ saved: [{ from: 3, to: 5, name: 'Bridge' }] })
		expect(view.unitLabel.value).toBe('Whole piece')
		loopRef.value = { active: true, from: 7, to: 7 }
		expect(view.unitLabel.value).toBe('Measure 7')
		loopRef.value = { active: true, from: 3, to: 5 }
		expect(view.unitLabel.value).toBe('Bridge (Measures 3–5)')
		expect(view.levelLabel.value).toBe('Choir')
	})

	it('has no syllables without lyrics', () => {
		const { view } = setUp()
		expect(view.lyricsBlocks.value).toEqual([])
		expect(view.syllablesFor(0, 1000)).toEqual([])
	})
})
