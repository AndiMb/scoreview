import { describe, expect, it } from 'vitest'
import { ACTIONS } from './interactionPolicy.js'
import { KEY_BINDINGS, resolveKey } from './keyMap.js'

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
