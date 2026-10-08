// Notenkopf im SVG <-> Tonhoehe und Schreibweise aus `noteSpellings` (E15).
// Rein, ohne DOM: Die Knoten sind hier nur Werte, die durchgereicht werden.
//
// Die Engine liefert je (Segment, Notenzeile, Stimme) die Koepfe in genau der
// Reihenfolge, in der das SVG sie zeichnet - einschliesslich Vorschlags- und
// Ornament-Hilfsnoten (gemessen ueber den vtest-Korpus: 14 254 Noten, jede
// Gruppe gleich gross). Zugeordnet wird deshalb der Reihe nach. Stimmt die
// Zahl einer Gruppe einmal nicht, bleibt diese Gruppe ohne Namen - lieber
// keiner als ein falscher.

/**
 * @param {?Array<{elid:number, staff:number, voice:number, notes:Array<[number, number]>}>} noteSpellings
 * @return {Map<string, Array<[number, number]>>} Schluessel `${elid}:${staff}:${voice}`
 */
export function spellingMap(noteSpellings) {
	const map = new Map()
	for (const entry of noteSpellings ?? []) {
		map.set(`${entry.elid}:${entry.staff}:${entry.voice}`, entry.notes ?? [])
	}
	return map
}

/**
 * @template N
 * @param {Map<string, Array<{node: N, voice: ?number}>>} noteIndex aus
 *   svgIndex.buildNoteIndex (Schluessel `${elid}:${staff}`, Dokumentreihenfolge)
 * @param {Map<string, Array<[number, number]>>} spellings aus spellingMap
 * @return {Array<{node: N, elid: number, staff: number, voice: number, pitch: number, tpc: number}>}
 */
export function matchNoteheads(noteIndex, spellings) {
	const out = []
	if (!noteIndex || !spellings || spellings.size === 0) {
		return out
	}
	for (const [key, entries] of noteIndex) {
		const [elid, staff] = key.split(':').map(Number)
		const byVoice = new Map()
		for (const entry of entries) {
			if (entry.voice === null || entry.voice === undefined) {
				continue
			}
			const list = byVoice.get(entry.voice) ?? []
			list.push(entry.node)
			byVoice.set(entry.voice, list)
		}
		for (const [voice, nodes] of byVoice) {
			const notes = spellings.get(`${elid}:${staff}:${voice}`)
			if (!notes || notes.length !== nodes.length) {
				continue
			}
			nodes.forEach((node, i) => {
				out.push({ node, elid, staff, voice, pitch: notes[i][0], tpc: notes[i][1] })
			})
		}
	}
	return out
}

/**
 * Der getroffene Notenkopf an einem Punkt (SVG-Einheiten). Ein Kopf ist
 * klein - auf dem Handy trifft ein Finger selten genau. Gesucht wird deshalb
 * in einer um `tolerance` erweiterten Box, bei mehreren Treffern der naechste.
 *
 * @template T
 * @param {Array<T & {box: {x:number, y:number, width:number, height:number}}>} items
 * @param {number} x
 * @param {number} y
 * @param {number} tolerance in SVG-Einheiten
 * @return {?T}
 */
export function hitNotehead(items, x, y, tolerance) {
	let best = null
	let bestDistance = Infinity
	for (const item of items) {
		const b = item.box
		if (!b) {
			continue
		}
		if (x < b.x - tolerance || x > b.x + b.width + tolerance || y < b.y - tolerance || y > b.y + b.height + tolerance) {
			continue
		}
		const dx = x - (b.x + b.width / 2)
		const dy = y - (b.y + b.height / 2)
		const d = dx * dx + dy * dy
		if (d < bestDistance) {
			bestDistance = d
			best = item
		}
	}
	return best
}
