import { describe, expect, it } from 'vitest'
import { addScore, moveRow, payloadFor, removeRow, rowsFromSetlist } from './setlistEdit.js'

const liste = {
	entries: [
		{ label: 'Kyrie', path: '../Messe/Kyrie.mscz', fileId: 1, status: 'ok' },
		{ label: 'Weg', path: 'Weg.mscz', fileId: null, status: 'missing' },
		{ label: 'Kyrie', path: '../Messe/Kyrie.mscz', fileId: 1, status: 'ok' },
	],
}

describe('Setlisten-Editor', () => {
	it('vorhandene Eintraege gehen als Herkunft zurueck, auch fehlende', () => {
		const zeilen = rowsFromSetlist(liste)

		expect(payloadFor(zeilen)).toEqual([{ origin: 0 }, { origin: 1 }, { origin: 2 }])
		expect(new Set(zeilen.map((z) => z.key)).size).toBe(3)
	})

	it('neue Partituren gehen als fileId mit Titel ohne Endung', () => {
		const zeilen = addScore(rowsFromSetlist({ entries: [] }), { fileId: '42', name: 'Ave verum.mscz', path: 'Sub/Ave verum.mscz' })

		expect(zeilen[0]).toMatchObject({ label: 'Ave verum', path: 'Sub/Ave verum.mscz', status: 'ok' })
		expect(payloadFor(zeilen)).toEqual([{ fileId: 42, label: 'Ave verum' }])
	})

	it('nimmt auch Knoten aus der Dateiauswahl (basename)', () => {
		expect(addScore([], { fileId: 3, basename: 'Psalm.MSCZ' })[0].label).toBe('Psalm')
	})

	it('dasselbe Stueck darf zweimal hinein', () => {
		const zeilen = addScore(addScore([], { fileId: 1, name: 'a.mscz' }), { fileId: 1, name: 'a.mscz' })

		expect(payloadFor(zeilen)).toHaveLength(2)
	})

	it('verschieben und entfernen', () => {
		const zeilen = rowsFromSetlist(liste)

		expect(payloadFor(moveRow(zeilen, 0, 2))).toEqual([{ origin: 1 }, { origin: 2 }, { origin: 0 }])
		expect(payloadFor(moveRow(zeilen, 2, 0))).toEqual([{ origin: 2 }, { origin: 0 }, { origin: 1 }])
		expect(moveRow(zeilen, 1, 1)).toBe(zeilen)
		expect(moveRow(zeilen, 5, 0)).toBe(zeilen)
		expect(payloadFor(moveRow(zeilen, 0, 99))).toEqual([{ origin: 1 }, { origin: 2 }, { origin: 0 }])
		expect(payloadFor(removeRow(zeilen, 1))).toEqual([{ origin: 0 }, { origin: 2 }])
	})

	it('laesst die Eingabe unveraendert', () => {
		const zeilen = rowsFromSetlist(liste)
		const kopie = zeilen.slice()
		moveRow(zeilen, 0, 2)
		removeRow(zeilen, 0)
		addScore(zeilen, { fileId: 9, name: 'x.mscz' })

		expect(zeilen).toEqual(kopie)
	})
})
