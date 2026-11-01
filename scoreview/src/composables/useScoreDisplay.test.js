import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

vi.mock('../l10n.js', () => ({
	translate: (app, text, vars) => text.replace(/\{(\w+)\}/g, (m, key) => String(vars?.[key] ?? m)),
}))
vi.mock('../lib/capabilities.js', () => ({
	unavailableReason: (caps, feature) => caps[feature] ?? null,
}))

const { useScoreDisplay } = await import('./useScoreDisplay.js')

function setUp({ caps = {}, prefs = {}, width = 2000, myPart = 1, mappingOk = true } = {}) {
	const preferences = {
		layout: ref('pages'),
		doublePage: ref('off'),
		noteNames: ref('off'),
		noteNamesMine: ref(false),
		beatCounts: ref('off'),
		...Object.fromEntries(Object.entries(prefs).map(([k, v]) => [k, ref(v)])),
	}
	const display = useScoreDisplay({
		capabilities: () => caps,
		pictureMeta: () => null,
		preferences,
		meters: () => [],
		myPartIndex: () => myPart,
		staffMappingOk: () => mappingOk,
		pagesWidthPx: () => width,
	})
	return { display, preferences }
}

describe('useScoreDisplay', () => {
	it('falls back to the pages when the lyrics view is not possible, and says why', () => {
		const { display } = setUp({ caps: { lyrics: 'no-lyrics' }, prefs: { layout: 'lyrics' } })
		expect(display.activeLayout.value).toBe('pages')
		expect(display.lyricsUnavailable.value).toBe('This score has no lyrics.')
	})

	it('keeps the chosen layout when it is possible', () => {
		const { display } = setUp({ prefs: { layout: 'lyrics' } })
		expect(display.activeLayout.value).toBe('lyrics')
		expect(display.lyricsUnavailable.value).toBe('')
	})

	it('explains a spread that cannot show outside the page view', () => {
		const { display } = setUp({ prefs: { layout: 'band', doublePage: 'left' } })
		expect(display.spreadMode.value).toBe('off')
		expect(display.spreadUnavailable.value).toBe('Only in the page view.')
	})

	it('draws note names only where the picture has the data for them', () => {
		expect(setUp({ prefs: { noteNames: 'de' } }).display.noteNameSystem.value).toBe('de')
		expect(setUp({ caps: { noteNames: 'old-pages' }, prefs: { noteNames: 'de' } }).display.noteNameSystem.value).toBeNull()
		expect(setUp().display.noteNameSystem.value).toBeNull()
	})

	it('limits names and counts to my staff only where staves map to parts', () => {
		expect(setUp({ prefs: { noteNamesMine: true } }).display.noteNameStaves.value).toEqual([1])
		expect(setUp({ prefs: { noteNamesMine: true }, mappingOk: false }).display.noteNameStaves.value).toBeNull()
		expect(setUp({ prefs: { beatCounts: 'mine' } }).display.countStaves.value).toEqual([1])
		expect(setUp({ prefs: { beatCounts: 'all' } }).display.countStaves.value).toBeNull()
	})

	it('has no counts while they are off or not possible', () => {
		expect(setUp().display.countOfElid.value).toBeNull()
		expect(setUp({ caps: { counts: 'old-pages' }, prefs: { beatCounts: 'all' } }).display.countOfElid.value).toBeNull()
	})
})
