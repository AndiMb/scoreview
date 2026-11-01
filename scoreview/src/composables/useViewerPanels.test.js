import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { PANELS, useViewerPanels } from './useViewerPanels.js'

describe('useViewerPanels', () => {
	it('opens, toggles and closes cards by tool id', () => {
		const panels = useViewerPanels()
		expect(panels.open.value).toEqual([])
		panels.toggle('tuner')
		panels.set('mixer', true)
		expect(panels.open.value).toEqual(['mixer', 'tuner'])
		panels.toggle('tuner')
		expect(panels.isOpen('tuner')).toBe(false)
		panels.closeAll()
		expect(panels.open.value).toEqual([])
	})

	it('uses an adopted flag as the state itself', () => {
		const visible = ref(false)
		const panels = useViewerPanels({ adopt: { annotations: visible } })
		panels.set('annotations', true)
		expect(visible.value).toBe(true)
		visible.value = false
		expect(panels.isOpen('annotations')).toBe(false)
	})

	it('keeps a card open but hidden while it has nothing to show', () => {
		const hasSound = ref(false)
		const panels = useViewerPanels({ shownIf: { mixer: () => hasSound.value } })
		panels.set('mixer', true)
		expect(panels.shown('mixer')).toBe(false)
		expect(panels.anyShown.value).toBe(false)
		hasSound.value = true
		expect(panels.shown('mixer')).toBe(true)
		expect(panels.anyShown.value).toBe(true)
	})

	it('closes only the cards asked for', () => {
		const panels = useViewerPanels()
		PANELS.forEach((id) => panels.set(id, true))
		panels.closeAll(PANELS.filter((id) => id !== 'tuner'))
		expect(panels.open.value).toEqual(['tuner'])
	})

	it('ignores an unknown id', () => {
		const panels = useViewerPanels()
		panels.set('print', true)
		expect(panels.isOpen('print')).toBe(false)
	})
})
