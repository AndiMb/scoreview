import { describe, expect, it } from 'vitest'
import { candidateQuery, normalizeLeaders } from './leaders.js'

describe('normalizeLeaders', () => {
	it('uebernimmt Kennung und Abberufbarkeit fuer eine Leitung', () => {
		expect(normalizeLeaders({
			isLeader: true,
			leaders: [
				{ displayName: 'Anna', isOwner: true, me: false, userId: 'anna', canRevoke: false },
				{ displayName: 'Bert', isOwner: false, me: true, userId: 'bert', canRevoke: true },
			],
		})).toEqual({
			isLeader: true,
			leaders: [
				{ displayName: 'Anna', isOwner: true, me: false, userId: 'anna', canRevoke: false },
				{ displayName: 'Bert', isOwner: false, me: true, userId: 'bert', canRevoke: true },
			],
		})
	})

	it('zeigt Nicht-Leitungen nur Namen, auch wenn der Server mehr schickte', () => {
		const { isLeader, leaders } = normalizeLeaders({
			isLeader: false,
			leaders: [{ displayName: 'Anna', isOwner: true, userId: 'anna', canRevoke: true }],
		})
		expect(isLeader).toBe(false)
		expect(leaders).toEqual([{ displayName: 'Anna', isOwner: true, me: false, userId: null, canRevoke: false }])
	})

	it('macht die Eigentuemerin nie abberufbar', () => {
		const { leaders } = normalizeLeaders({
			isLeader: true,
			leaders: [{ displayName: 'Anna', isOwner: true, userId: 'anna', canRevoke: true }],
		})
		expect(leaders[0].canRevoke).toBe(false)
	})

	it('vertraegt eine leere oder kaputte Antwort', () => {
		expect(normalizeLeaders(null)).toEqual({ isLeader: false, leaders: [] })
		expect(normalizeLeaders({ isLeader: 'ja', leaders: 'x' })).toEqual({ isLeader: false, leaders: [] })
	})
})

describe('candidateQuery', () => {
	it('sucht erst ab zwei Zeichen, ohne Rand', () => {
		expect(candidateQuery('')).toBeNull()
		expect(candidateQuery(' a ')).toBeNull()
		expect(candidateQuery(' an ')).toBe('an')
		expect(candidateQuery(null)).toBeNull()
	})
})
