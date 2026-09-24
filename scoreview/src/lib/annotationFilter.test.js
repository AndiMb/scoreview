import { describe, expect, it } from 'vitest'
import { classify, DIM, HIDE, isWithoutVoice, resolveTarget, SHOW, targetNames } from './annotationFilter.js'

// meta.parts einer SATB-Partitur, wie sie die Engine liefert (IDs als Text).
const satb = [
	{ id: '1', name: 'Sopran' },
	{ id: '2', name: 'Alt' },
	{ id: '3', name: 'Tenor' },
	{ id: '4', name: 'Bass' },
]
const tenorNotiz = { visibility: 'parts', targetParts: [{ id: '3', name: 'Tenor' }] }

describe('classify', () => {
	it('zeigt die Tenornotiz dem Tenor und verbirgt sie vor dem Alt (B2-Abnahme)', () => {
		expect(classify(tenorNotiz, '3', satb)).toBe(SHOW)
		expect(classify(tenorNotiz, '2', satb)).toBe(HIDE)
	})

	it('zeigt Leitungen alles', () => {
		expect(classify(tenorNotiz, '2', satb, true)).toBe(SHOW)
		expect(classify(tenorNotiz, null, satb, true)).toBe(SHOW)
	})

	it('nimmt ohne gewaehlte Stimme zurueck statt zu verbergen', () => {
		expect(classify(tenorNotiz, null, satb)).toBe(DIM)
		expect(classify(tenorNotiz, undefined, satb)).toBe(DIM)
		// Eine gemerkte Stimme, die es nicht mehr gibt, ist keine Stimme.
		expect(classify(tenorNotiz, '9', satb)).toBe(DIM)
	})

	it('laesst private und geteilte Notizen unberuehrt', () => {
		expect(classify({ visibility: 'private' }, '2', satb)).toBe(SHOW)
		expect(classify({ visibility: 'shared', targetParts: [{ id: '3', name: 'Tenor' }] }, '2', satb)).toBe(SHOW)
	})

	it('trifft eine von mehreren Zielstimmen', () => {
		const maenner = { visibility: 'parts', targetParts: [{ id: '3', name: 'Tenor' }, { id: '4', name: 'Bass' }] }
		expect(classify(maenner, '4', satb)).toBe(SHOW)
		expect(classify(maenner, '1', satb)).toBe(HIDE)
	})

	it('findet eine umbenannte Stimme ueber die ID', () => {
		const umbenannt = satb.map((p) => (p.id === '3' ? { id: '3', name: 'Tenor 1' } : p))
		expect(classify(tenorNotiz, '3', umbenannt)).toBe(SHOW)
		expect(targetNames(tenorNotiz, umbenannt)).toEqual(['Tenor 1'])
	})

	it('findet eine Stimme mit neuer ID ueber den Namen', () => {
		const neueIds = satb.map((p, i) => ({ ...p, id: String(10 + i) }))
		expect(classify(tenorNotiz, '12', neueIds)).toBe(SHOW)
		expect(classify(tenorNotiz, '11', neueIds)).toBe(HIDE)
	})

	it('folgt bei umsortierten Stimmen dem Namen, nicht dem Platz', () => {
		// Tenor und Bass getauscht, IDs fortlaufend nach Platz vergeben.
		const umsortiert = [
			{ id: '1', name: 'Sopran' },
			{ id: '2', name: 'Alt' },
			{ id: '3', name: 'Bass' },
			{ id: '4', name: 'Tenor' },
		]
		expect(resolveTarget(tenorNotiz.targetParts[0], umsortiert)).toEqual({ id: '4', name: 'Tenor' })
		expect(classify(tenorNotiz, '4', umsortiert)).toBe(SHOW)
		expect(classify(tenorNotiz, '3', umsortiert)).toBe(HIDE)
	})

	it('zeigt eine Notiz ohne auffindbare Stimme allen', () => {
		const ohne = [{ id: '1', name: 'Sopran' }, { id: '2', name: 'Alt' }]
		expect(classify(tenorNotiz, '2', ohne)).toBe(SHOW)
		expect(classify(tenorNotiz, null, ohne)).toBe(SHOW)
		expect(isWithoutVoice(tenorNotiz, ohne)).toBe(true)
		expect(isWithoutVoice(tenorNotiz, satb)).toBe(false)
		// Der gespeicherte Name bleibt als Hinweis, an wen sie ging.
		expect(targetNames(tenorNotiz, ohne)).toEqual(['Tenor'])
	})

	it('vergleicht Namen ohne Gross/klein und Randleerzeichen', () => {
		const note = { visibility: 'parts', targetParts: [{ id: '99', name: ' tenor ' }] }
		expect(classify(note, '3', satb)).toBe(SHOW)
	})

	it('vertraegt fehlende Felder', () => {
		expect(classify({ visibility: 'parts' }, '3', satb)).toBe(SHOW)
		expect(classify(tenorNotiz, '3', null)).toBe(SHOW)
		expect(classify(null, '3', satb)).toBe(SHOW)
		expect(targetNames({}, satb)).toEqual([])
	})

	it('vergleicht Zahl- und Text-IDs gleich', () => {
		expect(classify(tenorNotiz, 3, satb.map((p) => ({ ...p, id: Number(p.id) })))).toBe(SHOW)
	})
})
