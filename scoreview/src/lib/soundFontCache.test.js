import { describe, expect, it, vi } from 'vitest'
import { createSoundFontCache } from './soundFontCache.js'

/** Ein Abruf, der sich von aussen erfuellen, melden und abbrechen laesst. */
function steuerbarerAbruf() {
	const abruf = { starts: 0, aborted: 0 }
	abruf.start = (report) => {
		abruf.starts++
		abruf.report = report
		return {
			promise: new Promise((resolve, reject) => {
				abruf.resolve = resolve
				abruf.reject = reject
			}),
			abort: () => {
				abruf.aborted++
				const err = new Error('abgebrochen')
				err.name = 'AbortError'
				abruf.reject(err)
			},
		}
	}
	return abruf
}

const bytes = (...werte) => new Uint8Array(werte).buffer

describe('createSoundFontCache', () => {
	it('laedt einmal und gibt jedem eine eigene Kopie', async () => {
		const cache = createSoundFontCache()
		const abruf = steuerbarerAbruf()
		const erster = cache.get('/sf', abruf.start)
		abruf.resolve(bytes(1, 2, 3))
		const a = await erster
		const b = await cache.get('/sf', abruf.start)

		expect(abruf.starts).toBe(1)
		expect(new Uint8Array(b)).toEqual(new Uint8Array([1, 2, 3]))
		expect(a).not.toBe(b)
		expect(cache.has('/sf')).toBe(true)
	})

	it('eine uebertragene Kopie laesst den Speicher unberuehrt', async () => {
		const cache = createSoundFontCache()
		const abruf = steuerbarerAbruf()
		const erster = cache.get('/sf', abruf.start)
		abruf.resolve(bytes(9, 9))
		const kopie = await erster
		// Wie die Transferliste des Worklets: der Puffer wird abgeloest.
		structuredClone(kopie, { transfer: [kopie] })

		expect(kopie.byteLength).toBe(0)
		expect((await cache.get('/sf', abruf.start)).byteLength).toBe(2)
	})

	it('teilt einen laufenden Abruf und meldet allen den Fortschritt', async () => {
		const cache = createSoundFontCache()
		const abruf = steuerbarerAbruf()
		const erster = vi.fn()
		const zweiter = vi.fn()
		const p1 = cache.get('/sf', abruf.start, erster)
		abruf.report(40)
		const p2 = cache.get('/sf', abruf.start, zweiter)
		abruf.report(80)
		abruf.resolve(bytes(1))
		await Promise.all([p1, p2])

		expect(abruf.starts).toBe(1)
		expect(erster).toHaveBeenLastCalledWith(80)
		expect(zweiter.mock.calls.map((c) => c[0])).toEqual([40, 80])
	})

	it('merkt sich keinen Fehler', async () => {
		const cache = createSoundFontCache()
		const abruf = steuerbarerAbruf()
		const erster = cache.get('/sf', abruf.start)
		abruf.reject(new Error('503'))
		await expect(erster).rejects.toThrow('503')

		const zweiter = cache.get('/sf', abruf.start)
		abruf.resolve(bytes(1))
		await zweiter

		expect(abruf.starts).toBe(2)
	})

	it('Abbruch trifft den laufenden Abruf und wird nicht gemerkt', async () => {
		const cache = createSoundFontCache()
		const abruf = steuerbarerAbruf()
		const laufend = cache.get('/sf', abruf.start)
		cache.abort('/sf')

		await expect(laufend).rejects.toMatchObject({ name: 'AbortError' })
		expect(abruf.aborted).toBe(1)
		expect(cache.has('/sf')).toBe(false)
	})

	it('Abbruch nach dem Laden laesst den Eintrag stehen', async () => {
		const cache = createSoundFontCache()
		const abruf = steuerbarerAbruf()
		const laufend = cache.get('/sf', abruf.start)
		abruf.resolve(bytes(1))
		await laufend
		cache.abort('/sf')

		expect(abruf.aborted).toBe(0)
		expect(cache.has('/sf')).toBe(true)
	})

	it('eine neue Adresse ersetzt die alte', async () => {
		const cache = createSoundFontCache()
		const alt = steuerbarerAbruf()
		const neu = steuerbarerAbruf()
		const p1 = cache.get('/alt', alt.start)
		p1.catch(() => {})
		const p2 = cache.get('/neu', neu.start)
		neu.resolve(bytes(2))
		await p2

		expect(alt.aborted).toBe(1)
		expect(cache.has('/alt')).toBe(false)
		expect(cache.has('/neu')).toBe(true)
	})
})
