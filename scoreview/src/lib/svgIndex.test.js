// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSegmentIndex, setHighlight } from './svgIndex.js'

/** Ein Ausschnitt in der Form, die MuseScore mit M10 liefert. */
function svg(inhalt) {
	const wurzel = document.createElement('div')
	wurzel.innerHTML = `<svg viewBox="0 0 10200 13200">${inhalt}</svg>`
	return wurzel
}

describe('buildSegmentIndex', () => {
	it('gruppiert die Knoten eines Segments unter seiner elid', () => {
		const root = svg(`
			<path class="Note seg-42 st-0 vc-0" d="M0 0" />
			<path class="Stem seg-42 st-0 vc-0" d="M0 0" />
			<path class="Note seg-43 st-1 vc-0" d="M0 0" />
		`)
		const index = buildSegmentIndex(root)
		expect([...index.keys()].sort((a, b) => a - b)).toEqual([42, 43])
		expect(index.get(42)).toHaveLength(2)
		expect(index.get(43)).toHaveLength(1)
	})

	it('laesst Liedtext, Bogen und Ortsfestes aussen vor', () => {
		const root = svg(`
			<text class="Lyrics seg-7 st-0 vc-0">doo</text>
			<path class="TieSegment seg-7 st-0 vc-0" d="M0 0" />
			<path class="BarLine seg-7" d="M0 0" />
			<path class="Note seg-7 st-0 vc-0" d="M0 0" />
		`)
		expect(buildSegmentIndex(root).get(7)).toHaveLength(1)
	})

	it('bleibt leer, wenn das SVG keine Kennungen traegt (Stock-MuseScore)', () => {
		const root = svg('<path class="Note" d="M0 0" /><path class="Stem" d="M0 0" />')
		expect(buildSegmentIndex(root).size).toBe(0)
	})

	it('faellt bei fehlender Wurzel nicht um', () => {
		expect(buildSegmentIndex(null).size).toBe(0)
		expect(buildSegmentIndex({}).size).toBe(0)
	})

	it('ignoriert eine Kennung, die keine Zahl ist', () => {
		const root = svg('<path class="Note seg-x st-0" d="M0 0" />')
		expect(buildSegmentIndex(root).size).toBe(0)
	})
})

describe('setHighlight', () => {
	let root
	let index

	beforeEach(() => {
		root = svg(`
			<path class="Note seg-1" d="M0 0" />
			<path class="Stem seg-1" d="M0 0" />
			<path class="Note seg-2" d="M0 0" />
		`)
		index = buildSegmentIndex(root)
	})

	it('faerbt das klingende Segment und raeumt das vorige ab', () => {
		const ersteS = setHighlight(index, 1, [], 'is-sounding')
		expect(ersteS).toHaveLength(2)
		expect(root.querySelectorAll('.is-sounding')).toHaveLength(2)

		const zweite = setHighlight(index, 2, ersteS, 'is-sounding')
		expect(zweite).toHaveLength(1)
		expect(root.querySelectorAll('.is-sounding')).toHaveLength(1)
		expect(zweite[0].getAttribute('class')).toContain('seg-2')
	})

	it('raeumt bei null ab, ohne etwas Neues zu setzen', () => {
		const gesetzt = setHighlight(index, 1, [], 'is-sounding')
		expect(setHighlight(index, null, gesetzt, 'is-sounding')).toEqual([])
		expect(root.querySelectorAll('.is-sounding')).toHaveLength(0)
	})

	it('bleibt still, wenn die elid im Notenbild nicht vorkommt', () => {
		// Der Normalfall bei einer Wiederholung auf einer anderen Seite (M7).
		expect(setHighlight(index, 99, [], 'is-sounding')).toEqual([])
	})
})
