import { describe, expect, it } from 'vitest'
import {
	firstPlayableIndex,
	indexOfFile,
	isPlayable,
	nextIndex,
	positionOf,
	previousIndex,
} from './setlistNav.js'

const ok = (fileId) => ({ status: 'ok', fileId })
const fehlt = { status: 'missing', fileId: null }
const fremd = { status: 'unsupported', fileId: null }

describe('isPlayable', () => {
	it('nur aufgeloeste Eintraege mit fileId', () => {
		expect(isPlayable(ok(1))).toBe(true)
		expect(isPlayable(fehlt)).toBe(false)
		expect(isPlayable(fremd)).toBe(false)
		expect(isPlayable({ status: 'ok', fileId: null })).toBe(false)
		expect(isPlayable(undefined)).toBe(false)
	})
})

describe('Weiterblaettern', () => {
	// Drei Stuecke, das mittlere fehlt fuer diese Nutzerin.
	const liste = [ok(1), fehlt, ok(3)]

	it('ueberspringt den fehlenden Eintrag in beide Richtungen', () => {
		expect(nextIndex(liste, 0)).toBe(2)
		expect(previousIndex(liste, 2)).toBe(0)
	})

	it('laeuft am Ende nicht um', () => {
		expect(nextIndex(liste, 2)).toBeNull()
		expect(previousIndex(liste, 0)).toBeNull()
	})

	it('ueberspringt mehrere nacheinander', () => {
		expect(nextIndex([ok(1), fehlt, fremd, fehlt, ok(5)], 0)).toBe(4)
	})

	it('findet nichts in einer Liste ohne Spielbares', () => {
		expect(firstPlayableIndex([fehlt, fremd])).toBeNull()
		expect(firstPlayableIndex([])).toBeNull()
		expect(firstPlayableIndex(null)).toBeNull()
	})

	it('beginnt beim ersten spielbaren Eintrag (Weg 1)', () => {
		expect(firstPlayableIndex([fehlt, ok(2), ok(3)])).toBe(1)
	})

	it('kommt auch von einem fehlenden Eintrag aus weiter', () => {
		expect(nextIndex(liste, 1)).toBe(2)
		expect(previousIndex(liste, 1)).toBe(0)
	})
})

describe('indexOfFile (Weg 2)', () => {
	const liste = [ok(7), ok(8), ok(7)]

	it('nimmt die erste Stelle, wenn nichts bevorzugt ist', () => {
		expect(indexOfFile(liste, 7)).toBe(0)
		expect(indexOfFile(liste, '8')).toBe(1)
	})

	it('nimmt die bevorzugte Stelle bei Duplikaten', () => {
		expect(indexOfFile(liste, 7, 2)).toBe(2)
	})

	it('ignoriert eine bevorzugte Stelle, die nicht passt', () => {
		expect(indexOfFile(liste, 7, 1)).toBe(0)
		expect(indexOfFile(liste, 7, 99)).toBe(0)
	})

	it('null, wenn die Partitur nicht in der Liste steht', () => {
		expect(indexOfFile(liste, 9)).toBeNull()
		expect(indexOfFile([fehlt], 9)).toBeNull()
	})
})

describe('positionOf', () => {
	it('zaehlt fehlende Eintraege mit, wie auf dem Blatt', () => {
		expect(positionOf([ok(1), fehlt, ok(3)], 2)).toEqual({ number: 3, total: 3, hasNext: false, hasPrevious: true })
	})

	it('am Anfang geht es nur vorwaerts', () => {
		expect(positionOf([ok(1), fehlt, ok(3)], 0)).toEqual({ number: 1, total: 3, hasNext: true, hasPrevious: false })
	})

	it('ohne Stelle weder vor noch zurueck ausser zum ersten Stueck', () => {
		expect(positionOf([fehlt, ok(2)], null)).toEqual({ number: 0, total: 2, hasNext: true, hasPrevious: false })
	})
})
