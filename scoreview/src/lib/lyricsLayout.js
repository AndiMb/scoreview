// Liedtext-Ansicht (H2): aus der Silbenliste der Engine (`lyricSyllables`,
// E12/E15) Woerter, Strophen und Bloecke machen, und beim Abspielen die
// gesungene Silbe finden. Rein, ohne DOM.
//
// Warum aus der Silbenliste und nicht aus dem SVG: Dort steht der Text nur
// als Glyphen, ohne Zeichen und ohne Strophe (M12, gemessen an
// lyrics-test.mscz auf beiden Wegen).
//
// Welche Strophe klingt, sagt die Wiederholung: Das n-te Auftreten einer
// `elid` im ausgerollten Timing (M7) singt Strophe n - so steht es unter
// einer Wiederholung mit mehreren Strophen. Gibt es an der Stelle weniger
// Strophen als Durchlaeufe, bleibt es bei der letzten vorhandenen.

/**
 * @typedef {{elid:number, staff:number, voice:number, verse:number, syllabic:string, text:string, melisma?:boolean}} Syllable
 * @typedef {{id:string, elid:number, text:string, joinNext:boolean}} SyllableRef
 * @typedef {{index:number, verse:number, text:string, syllables:SyllableRef[]}} Word
 * @typedef {{key:string|number, verses:Array<{verse:number, words:Word[]}>}} Block
 */

/**
 * Kennung einer Silbe in der Ansicht - Stelle plus Strophe.
 *
 * @param elid
 * @param verse
 */
export const syllableId = (elid, verse) => `${elid}:${verse}`

/**
 * @param {object} input
 * @param {Syllable[]} input.syllables
 * @param {?Iterable<number>} input.staves die Notenzeilen der eigenen Stimme;
 *   null = die oberste Zeile, die Text traegt (D8)
 * @param {(elid:number) => (string|number)} [input.blockKeyOf] Block einer
 *   Stelle, ueblicherweise das System; ohne gibt es einen Block
 * @return {{blocks: Block[], staves: number[], verses: number[]}}
 */
export function buildLyrics({ syllables, staves = null, blockKeyOf = () => 0 }) {
	const all = syllables ?? []
	const chosen = chooseStaves(all, staves)
	// Je Stelle und Strophe eine Silbe: Bei Divisi in einer Zeile traegt
	// meist nur eine Stimme Text; stehen doch zwei da, gilt die tiefere
	// Stimmnummer (die obere Stimme).
	const bySlot = new Map()
	for (const s of all) {
		if (!chosen.has(s.staff)) {
			continue
		}
		const key = syllableId(s.elid, s.verse)
		const have = bySlot.get(key)
		if (!have || s.staff < have.staff || (s.staff === have.staff && s.voice < have.voice)) {
			bySlot.set(key, s)
		}
	}
	const verses = [...new Set([...bySlot.values()].map((s) => s.verse))].sort((a, b) => a - b)

	// Woerter je Strophe in Notenreihenfolge (elid aufsteigend = Lesereihenfolge
	// der MM-Kette).
	const wordsByVerse = new Map()
	let wordIndex = 0
	for (const verse of verses) {
		const list = [...bySlot.values()].filter((s) => s.verse === verse).sort((a, b) => a.elid - b.elid)
		const words = []
		let current = null
		for (const s of list) {
			const ref = { id: syllableId(s.elid, verse), elid: s.elid, text: s.text, joinNext: s.syllabic === 'begin' || s.syllabic === 'middle' }
			if (current && current.open) {
				current.word.syllables.push(ref)
			} else {
				current = { word: { index: wordIndex++, verse, text: '', syllables: [ref] }, open: false }
				words.push(current.word)
			}
			current.open = ref.joinNext
		}
		for (const w of words) {
			w.text = w.syllables.map((r) => r.text).join('')
		}
		wordsByVerse.set(verse, words)
	}

	// Bloecke: in der Reihenfolge, in der sie zuerst vorkommen; ein Wort
	// gehoert dem Block seiner ersten Silbe - ueber einen Zeilenumbruch
	// getrennte Woerter bleiben ganz.
	const blocks = new Map()
	const ordered = [...bySlot.values()].sort((a, b) => a.elid - b.elid)
	for (const s of ordered) {
		const key = blockKeyOf(s.elid)
		if (!blocks.has(key)) {
			blocks.set(key, { key, verses: verses.map((verse) => ({ verse, words: [] })) })
		}
	}
	for (const [verse, words] of wordsByVerse) {
		for (const w of words) {
			const block = blocks.get(blockKeyOf(w.syllables[0].elid))
			block.verses.find((v) => v.verse === verse).words.push(w)
		}
	}
	for (const block of blocks.values()) {
		block.verses = block.verses.filter((v) => v.words.length > 0)
	}
	return { blocks: [...blocks.values()], staves: [...chosen].sort((a, b) => a - b), verses }
}

/**
 * @param {Syllable[]} all
 * @param {?Iterable<number>} staves
 * @return {Set<number>}
 */
function chooseStaves(all, staves) {
	if (staves !== null && staves !== undefined) {
		const set = new Set(staves)
		if ([...set].some((st) => all.some((s) => s.staff === st))) {
			return set
		}
	}
	// Ohne gewaehlte Stimme - oder wenn die eigene Stimme keinen Text hat
	// (Begleitung) - die oberste Zeile mit Text.
	const top = all.reduce((min, s) => Math.min(min, s.staff), Infinity)
	return Number.isFinite(top) ? new Set([top]) : new Set()
}

/**
 * Das wievielte Auftreten seiner `elid` jedes Timing-Ereignis ist (1-basiert).
 *
 * @param {Array<{elid:number}>} events timing.json, ausgerollt
 * @return {number[]}
 */
export function occurrences(events) {
	const seen = new Map()
	return (events ?? []).map((e) => {
		const n = (seen.get(e.elid) ?? 0) + 1
		seen.set(e.elid, n)
		return n
	})
}

/**
 * Die Silbe, die beim Ereignis `eventIndex` gesungen wird - oder null, wenn
 * dort keine steht (Melisma, Pause). Die Ansicht laesst dann die letzte
 * hervorgehoben.
 *
 * @param {{syllableVerses: Map<number, number[]>, events: Array<{elid:number}>, occ: number[]}} index
 * @param {number} eventIndex
 * @return {?string} syllableId
 */
export function activeSyllable({ syllableVerses, events, occ }, eventIndex) {
	const e = events?.[eventIndex]
	if (!e) {
		return null
	}
	const verses = syllableVerses.get(e.elid)
	if (!verses || verses.length === 0) {
		return null
	}
	const n = occ[eventIndex] ?? 1
	return syllableId(e.elid, verses[Math.min(n, verses.length) - 1])
}

/**
 * Je Stelle die Strophen, die dort Text haben - sortiert. Grundlage fuer
 * activeSyllable.
 *
 * @param {Block[]} blocks
 * @return {Map<number, number[]>}
 */
export function versesByElid(blocks) {
	const map = new Map()
	for (const b of blocks) {
		for (const v of b.verses) {
			for (const w of v.words) {
				for (const s of w.syllables) {
					const list = map.get(s.elid) ?? []
					if (!list.includes(v.verse)) {
						list.push(v.verse)
						list.sort((a, b2) => a - b2)
					}
					map.set(s.elid, list)
				}
			}
		}
	}
	return map
}

/**
 * Wohin ein Tipp auf eine Silbe springt: zu dem Durchlauf, in dem diese
 * Strophe gesungen wird. Fehlt er (weniger Wiederholungen als Strophen),
 * zum letzten.
 *
 * @param {Array<{elid:number, timeMs:number}>} events
 * @param {Map<number, number[]>} syllableVerses
 * @param {number} elid
 * @param {number} verse
 * @return {?number} Partiturzeit in ms
 */
export function seekTimeFor(events, syllableVerses, elid, verse) {
	const times = (events ?? []).filter((e) => e.elid === elid).map((e) => e.timeMs)
	if (times.length === 0) {
		return null
	}
	const position = (syllableVerses.get(elid) ?? [verse]).indexOf(verse)
	return times[Math.min(Math.max(0, position), times.length - 1)]
}

/**
 * Der Block (das System), in dem eine Stelle steht: Takt-Rechtecke derselben
 * Seite mit derselben Oberkante bilden ein System (measures.json, M4). Die
 * Stelle gehoert zu dem, in dessen Hoehe sie liegt - sonst zum naechsten
 * darueber.
 *
 * @param {?{page:number, y:number}} element timing.elements[elid]
 * @param {Array<Array<{y:number, h:number}>>} measureRectsByPage scoreLayout.groupRectsByPage
 * @return {string} `${page}:${y}` - oder die Seite allein ohne Rechtecke
 */
export function systemKeyFor(element, measureRectsByPage) {
	if (!element) {
		return 'x'
	}
	const rects = measureRectsByPage?.[element.page] ?? []
	let best = null
	for (const r of rects) {
		if (r.y <= element.y + 1 && (best === null || r.y > best.y)) {
			best = r
		}
	}
	return best ? `${element.page}:${Math.round(best.y)}` : `${element.page}`
}

/**
 * Kennung einer Silbe in der Ansicht aller Stimmen - die Stelle allein ist
 * dort nicht eindeutig: Alle Zeilen eines Systems teilen sich die Segmente.
 *
 * @param {number} staff
 * @param {number} elid
 * @param {number} verse
 */
export const choirSyllableId = (staff, elid, verse) => `${staff}:${elid}:${verse}`

/**
 * The lyrics of every part (E15, the "all parts" view): per system a row per
 * staff that carries text there, labelled with its part. Which parts sing
 * together is read from the rows, not guessed - a staff without text in a
 * system has no row in it.
 *
 * Built from buildLyrics per staff, so a row reads exactly as that part's own
 * view would; only the ids get the staff, and the word numbers run across
 * all rows (the view looks words up by number).
 *
 * @param {object} input
 * @param {Syllable[]} input.syllables
 * @param {(elid:number) => (string|number)} [input.blockKeyOf]
 * @param {(staff:number) => string} [input.labelOf] the part's name
 * @return {{blocks: Array<{key:string|number, rows: Array<{staff:number, label:string, verses:Array<{verse:number, words:Word[]}>}>}>, staves: number[], verseCount: number}}
 */
export function buildChoirLyrics({ syllables, blockKeyOf = () => 0, labelOf = (staff) => String(staff + 1) }) {
	const all = syllables ?? []
	const staves = [...new Set(all.map((s) => s.staff))].sort((a, b) => a - b)
	const blocks = new Map()
	let wordIndex = 0
	let verseCount = 0
	for (const staff of staves) {
		const own = buildLyrics({ syllables: all.filter((s) => s.staff === staff), staves: [staff], blockKeyOf })
		verseCount = Math.max(verseCount, own.verses.length)
		for (const block of own.blocks) {
			const verses = block.verses.map((v) => ({
				verse: v.verse,
				words: v.words.map((w) => ({
					...w,
					index: wordIndex++,
					staff,
					syllables: w.syllables.map((r) => ({ ...r, id: choirSyllableId(staff, r.elid, v.verse) })),
				})),
			}))
			const first = Math.min(...verses.flatMap((v) => v.words.map((w) => w.syllables[0].elid)))
			const entry = blocks.get(block.key) ?? { key: block.key, first, rows: [] }
			entry.first = Math.min(entry.first, first)
			entry.rows.push({ staff, label: labelOf(staff), verses })
			blocks.set(block.key, entry)
		}
	}
	const ordered = [...blocks.values()]
		.sort((a, b) => a.first - b.first)
		.map(({ key, rows }) => ({ key, rows: rows.sort((a, b) => a.staff - b.staff) }))
	return { blocks: ordered, staves, verseCount }
}

/**
 * Je Notenzeile: Stelle -> Strophen mit Text (wie versesByElid, aber fuer die
 * Ansicht aller Stimmen).
 *
 * @param {ReturnType<typeof buildChoirLyrics>['blocks']} blocks
 * @return {Map<number, Map<number, number[]>>}
 */
export function choirVersesByElid(blocks) {
	const byStaff = new Map()
	for (const block of blocks) {
		for (const row of block.rows) {
			const map = byStaff.get(row.staff) ?? new Map()
			for (const v of row.verses) {
				for (const w of v.words) {
					for (const s of w.syllables) {
						const list = map.get(s.elid) ?? []
						if (!list.includes(v.verse)) {
							list.push(v.verse)
							list.sort((a, b) => a - b)
						}
						map.set(s.elid, list)
					}
				}
			}
			byStaff.set(row.staff, map)
		}
	}
	return byStaff
}

/**
 * Who sings at an event: the syllable of every staff that has one at this
 * place. The verse is chosen per staff the same way as in activeSyllable -
 * the n-th time through sings verse n.
 *
 * @param {{byStaff: Map<number, Map<number, number[]>>, events: Array<{elid:number}>, occ: number[]}} index
 * @param {number} eventIndex
 * @return {Array<{staff:number, id:string}>} empty when nobody starts a syllable here
 */
export function choirActiveSyllables({ byStaff, events, occ }, eventIndex) {
	const e = events?.[eventIndex]
	if (!e) {
		return []
	}
	const n = occ[eventIndex] ?? 1
	const out = []
	for (const [staff, verses] of byStaff) {
		const list = verses.get(e.elid)
		if (list && list.length > 0) {
			out.push({ staff, id: choirSyllableId(staff, e.elid, list[Math.min(n, list.length) - 1]) })
		}
	}
	return out
}

/**
 * The part name for each staff with text - only where staves and parts
 * match one to one. The count of staves comes from the engine's own lists
 * (spellings and syllables name every staff with notes); a piano part with
 * two staves breaks the count, and a wrong name is worse than "Staff 2".
 *
 * @param {Array<{name:string}>} parts the picture's parts (meta.parts)
 * @param {Array<{staff:number}>} entries noteSpellings and lyricSyllables
 * @return {?string[]} index = staff, or null when they cannot be matched
 */
export function staffPartNames(parts, entries) {
	let max = -1
	for (const e of entries ?? []) {
		if (Number.isInteger(e?.staff) && e.staff > max) {
			max = e.staff
		}
	}
	if (!parts?.length || max + 1 !== parts.length) {
		return null
	}
	return parts.map((part) => part.name ?? '')
}
