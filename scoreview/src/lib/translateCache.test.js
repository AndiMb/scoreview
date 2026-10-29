import { describe, expect, it, vi } from 'vitest'
import { createCachedTranslate } from './translateCache.js'

describe('createCachedTranslate', () => {
	it('uebersetzt einen Text ohne Platzhalter nur einmal', () => {
		const inner = vi.fn((app, text) => `${app}:${text}`)
		const t = createCachedTranslate(inner)
		expect(t('scoreview', 'Play')).toBe('scoreview:Play')
		expect(t('scoreview', 'Play')).toBe('scoreview:Play')
		expect(inner).toHaveBeenCalledTimes(1)
	})

	it('reicht Platzhalter jedes Mal durch', () => {
		const inner = vi.fn((app, text, vars) => text.replace('{n}', vars.n))
		const t = createCachedTranslate(inner)
		expect(t('scoreview', 'Page {n}', { n: 1 })).toBe('Page 1')
		expect(t('scoreview', 'Page {n}', { n: 2 })).toBe('Page 2')
		expect(inner).toHaveBeenCalledTimes(2)
	})

	it('trennt Apps und gleich lautende Texte sauber', () => {
		const inner = vi.fn((app, text) => `${app}|${text}`)
		const t = createCachedTranslate(inner)
		expect(t('a', 'x')).toBe('a|x')
		expect(t('b', 'x')).toBe('b|x')
		expect(inner).toHaveBeenCalledTimes(2)
	})
})
