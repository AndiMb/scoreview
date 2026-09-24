import { describe, expect, it } from 'vitest'
import { channelsOfPart, computePans, PAN_CENTER, PAN_MINE, PAN_OTHERS } from './panLayout.js'

describe('panLayout.computePans', () => {
	it('legt meine Stimme nach rechts und alle anderen nach links', () => {
		const pans = computePans([0, 1, 2, 3], [2], true)
		expect([...pans]).toEqual([[0, PAN_OTHERS], [1, PAN_OTHERS], [2, PAN_MINE], [3, PAN_OTHERS]])
	})

	it('nimmt bei Divisi alle Kanaele meiner Stimme mit', () => {
		const pans = computePans([0, 2, 3, 6], [3, 6], true)
		expect(pans.get(3)).toBe(PAN_MINE)
		expect(pans.get(6)).toBe(PAN_MINE)
		expect(pans.get(0)).toBe(PAN_OTHERS)
	})

	it('bleibt ohne Schalter in der Mitte', () => {
		const pans = computePans([0, 1], [1], false)
		expect([...pans.values()]).toEqual([PAN_CENTER, PAN_CENTER])
	})

	it('bleibt ohne gewaehlte Stimme in der Mitte, auch mit Schalter', () => {
		expect([...computePans([0, 1], null, true).values()]).toEqual([PAN_CENTER, PAN_CENTER])
		expect([...computePans([0, 1], [], true).values()]).toEqual([PAN_CENTER, PAN_CENTER])
	})

	it('legt die Seiten ganz nach aussen', () => {
		expect([PAN_OTHERS, PAN_CENTER, PAN_MINE]).toEqual([-1, 0, 1])
	})
})

describe('panLayout.channelsOfPart', () => {
	const mixer = [
		{ channel: 0, partId: '1' },
		{ channel: 2, partId: '2' },
		{ channel: 3, partId: '2' },
	]

	it('liefert alle Kanaele der Stimme', () => {
		expect(channelsOfPart(mixer, '2')).toEqual([2, 3])
	})

	it('vergleicht die Stimmen-ID als Text', () => {
		expect(channelsOfPart(mixer, 1)).toEqual([0])
	})

	it('liefert null ohne Stimme oder ohne Treffer', () => {
		expect(channelsOfPart(mixer, null)).toBeNull()
		expect(channelsOfPart(mixer, '9')).toBeNull()
	})
})
