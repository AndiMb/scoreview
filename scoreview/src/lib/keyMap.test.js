import { describe, expect, it } from 'vitest'
import { ACTIONS } from './interactionPolicy.js'
import { KEY_BINDINGS, keyBelongsToTarget, resolveKey } from './keyMap.js'

describe('keyMap.resolveKey', () => {
	it('blaettert mit PageDown/PageUp in beiden Modi, mit preventDefault', () => {
		for (const performance of [false, true]) {
			expect(resolveKey({ code: 'PageDown', key: 'PageDown' }, { performance })).toEqual({ command: 'pageDown', action: 'page', preventDefault: true })
			expect(resolveKey({ code: 'PageUp', key: 'PageUp' }, { performance })).toEqual({ command: 'pageUp', action: 'page', preventDefault: true })
		}
	})

	it('laesst die Pfeile hoch/runter ausserhalb der Aufführung nativ scrollen', () => {
		expect(resolveKey({ code: 'ArrowDown' })).toEqual({ command: 'scroll', action: null, preventDefault: false })
	})

	it('blaettert im Aufführungsmodus mit allen vier Pfeilen (Pedale)', () => {
		const ctx = { performance: true }
		expect(resolveKey({ code: 'ArrowDown' }, ctx).command).toBe('pageDown')
		expect(resolveKey({ code: 'ArrowRight' }, ctx).command).toBe('pageDown')
		expect(resolveKey({ code: 'ArrowUp' }, ctx).command).toBe('pageUp')
		expect(resolveKey({ code: 'ArrowLeft' }, ctx).command).toBe('pageUp')
	})

	it('springt ausserhalb der Aufführung mit links/rechts um einen Takt', () => {
		expect(resolveKey({ code: 'ArrowRight' })).toEqual({ command: 'nextMeasure', action: 'seek', preventDefault: true })
	})

	it('schluckt die Leertaste im Aufführungsmodus, statt zu scrollen oder zu spielen', () => {
		expect(resolveKey({ code: 'Space', key: ' ' }, { performance: true })).toEqual({ command: 'blocked', action: null, preventDefault: true })
		expect(resolveKey({ code: 'Space', key: ' ' }).command).toBe('togglePlay')
	})

	it('liest Zoomtasten am Zeichen, nicht an der Lage', () => {
		expect(resolveKey({ code: 'BracketRight', key: '+' }).command).toBe('zoomIn')
		expect(resolveKey({ code: 'Digit0', key: '0' }).command).toBe('zoomWidth')
	})

	it('findet Pedaltasten auch ohne code', () => {
		expect(resolveKey({ code: '', key: 'PageDown' }).command).toBe('pageDown')
	})

	it('ignoriert fremde Tasten', () => {
		expect(resolveKey({ code: 'KeyQ', key: 'q' })).toBeNull()
		expect(resolveKey({ code: '', key: ' ' })).toBeNull()
	})

	it('opens the print page on Ctrl+P and Cmd+P, but not on a plain P', () => {
		expect(resolveKey({ code: 'KeyP', key: 'p', ctrlKey: true })).toEqual({ command: 'print', action: 'settings', preventDefault: true })
		expect(resolveKey({ code: 'KeyP', key: 'p', metaKey: true }).command).toBe('print')
		expect(resolveKey({ code: 'KeyP', key: 'p' })).toBeNull()
	})

	it('swallows Ctrl+P in performance mode instead of printing the Files page', () => {
		expect(resolveKey({ code: 'KeyP', key: 'p', ctrlKey: true }, { performance: true })).toEqual({ command: 'blocked', action: null, preventDefault: true })
	})

	it('leaves Ctrl combinations of other keys to the browser', () => {
		expect(resolveKey({ code: 'KeyL', key: 'l', ctrlKey: true })).toBeNull()
		expect(resolveKey({ code: 'ArrowRight', key: 'ArrowRight', metaKey: true })).toBeNull()
	})

	it('steps note by note with Shift+arrows, measures stay on the plain arrows', () => {
		expect(resolveKey({ code: 'ArrowRight', key: 'ArrowRight', shiftKey: true })).toEqual({ command: 'nextNote', action: 'seek', preventDefault: true })
		expect(resolveKey({ code: 'ArrowLeft', key: 'ArrowLeft', shiftKey: true }).command).toBe('previousNote')
		expect(resolveKey({ code: 'ArrowRight', key: 'ArrowRight' }).command).toBe('nextMeasure')
		expect(resolveKey({ code: '', key: 'ArrowRight', shiftKey: true }).command).toBe('nextNote')
	})

	it('swallows Shift+arrows in performance mode, a step would sound', () => {
		expect(resolveKey({ code: 'ArrowRight', key: 'ArrowRight', shiftKey: true }, { performance: true }).command).toBe('blocked')
	})

	it('still reads keys that need Shift on the layout', () => {
		expect(resolveKey({ code: 'BracketRight', key: '+', shiftKey: true }).command).toBe('zoomIn')
		expect(resolveKey({ code: 'ArrowDown', key: 'ArrowDown', shiftKey: true }).command).toBe('scroll')
	})

	it('nennt nur Bedienungen, die die Policy kennt', () => {
		for (const binding of KEY_BINDINGS) {
			for (const entry of [binding.normal, binding.performance]) {
				if (entry && entry[1] !== null) {
					expect(ACTIONS).toContain(entry[1])
				}
			}
		}
	})
})

/**
 * A stand-in element: `inside` lists the selectors of the ancestors it sits
 * in, `focusVisible` whether it was reached by keyboard.
 */
function el(tagName, { inside = [], focusVisible = false, editable = false } = {}) {
	return {
		tagName,
		isContentEditable: editable,
		closest: (selector) => (selector.split(',').some((part) => inside.includes(part.trim())) ? {} : null),
		matches: (selector) => selector === ':focus-visible' && focusVisible,
	}
}

describe('keyMap.keyBelongsToTarget', () => {
	it('leaves fields alone', () => {
		for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
			expect(keyBelongsToTarget({ code: 'Space', key: ' ', target: el(tag) })).toBe(true)
		}
		expect(keyBelongsToTarget({ code: 'KeyL', key: 'l', target: el('DIV', { editable: true }) })).toBe(true)
	})

	it('takes keys on the modal around the viewer - where the focus mostly sits', () => {
		expect(keyBelongsToTarget({ code: 'Space', key: ' ', target: el('DIV') })).toBe(false)
		expect(keyBelongsToTarget({ code: 'ArrowRight', key: 'ArrowRight', target: el('DIV') })).toBe(false)
	})

	it('leaves Space on a control reached by keyboard to the control', () => {
		const button = el('BUTTON', { inside: ['button'], focusVisible: true })
		expect(keyBelongsToTarget({ code: 'Space', key: ' ', target: button })).toBe(true)
		expect(keyBelongsToTarget({ code: 'Enter', key: 'Enter', target: button })).toBe(true)
	})

	it('takes Space on a control that was clicked: that means playback', () => {
		const button = el('BUTTON', { inside: ['button'], focusVisible: false })
		expect(keyBelongsToTarget({ code: 'Space', key: ' ', target: button })).toBe(false)
	})

	it('leaves the arrows to menus and lists, which move their own focus', () => {
		const item = el('BUTTON', { inside: ['button', '[role="menuitem"]', '[role="menu"]'] })
		expect(keyBelongsToTarget({ code: 'ArrowDown', key: 'ArrowDown', target: item })).toBe(true)
		const plain = el('BUTTON', { inside: ['button'] })
		expect(keyBelongsToTarget({ code: 'ArrowRight', key: 'ArrowRight', target: plain })).toBe(false)
	})

	it('steps aside when someone already handled the key', () => {
		expect(keyBelongsToTarget({ code: 'Space', key: ' ', target: el('DIV'), defaultPrevented: true })).toBe(true)
	})
})
