// Ein ID3v2.3-Kopf fuer den Uebe-Track (F1.4): Titel, Stimme und Mischung
// stehen so in jedem Player und in der Nextcloud-App lesbar - nicht nur im
// Dateinamen, der beim Weiterreichen oft verloren geht.
//
// v2.3 statt v2.4: Aeltere Autoradios und Windows lesen v2.4 teils nicht.
// Text als UTF-16 mit BOM (Kodierung 1), die einzige Unicode-Kodierung, die
// v2.3 kennt - Umlaute und Silben in Liedtiteln muessen ueberleben.

/** Laengster Text je Feld, in Zeichen. */
const MAX_TEXT = 1000

/**
 * @param {object} tags
 * @param {string} [tags.title] TIT2
 * @param {string} [tags.artist] TPE1 (Komponist)
 * @param {string} [tags.album] TALB (Partiturtitel)
 * @param {string} [tags.comment] COMM (die Mischung in Worten)
 * @param {string} [tags.lang] dreistellige Sprache fuer COMM, Vorgabe "und"
 * @return {Uint8Array} vollstaendiger Kopf, vor die MP3-Frames zu setzen
 */
export function id3v23(tags) {
	const frames = []
	if (tags.title) {
		frames.push(textFrame('TIT2', tags.title))
	}
	if (tags.artist) {
		frames.push(textFrame('TPE1', tags.artist))
	}
	if (tags.album) {
		frames.push(textFrame('TALB', tags.album))
	}
	if (tags.comment) {
		frames.push(commentFrame(tags.comment, tags.lang ?? 'und'))
	}
	const body = concat(frames)
	const header = new Uint8Array(10)
	header.set([0x49, 0x44, 0x33, 3, 0, 0]) // "ID3", v2.3.0, keine Flags
	header.set(syncsafe(body.length), 6)
	return concat([header, body])
}

/**
 * Text aus der Partitur ist fremd: ohne Steuerzeichen (ein U+0000 kuerzte die
 * Anzeige in Playern) und begrenzt - ein Titel ist kein Roman.
 *
 * @param {string} text
 * @return {string}
 */
export function tagText(text) {
	// eslint-disable-next-line no-control-regex
	return [...String(text ?? '').replace(/[\u0000-\u001F\u007F]+/gu, ' ')].slice(0, MAX_TEXT).join('').trim()
}

function textFrame(id, text) {
	return frame(id, concat([Uint8Array.of(1), utf16(tagText(text))]))
}

function commentFrame(text, lang) {
	const l = new TextEncoder().encode(String(lang).padEnd(3, ' ').slice(0, 3))
	// Kodierung, Sprache, leere Kurzbeschreibung (BOM + Terminator), Text
	return frame('COMM', concat([Uint8Array.of(1), l, utf16(''), Uint8Array.of(0, 0), utf16(tagText(text))]))
}

function frame(id, data) {
	const head = new Uint8Array(10)
	head.set(new TextEncoder().encode(id), 0)
	// In v2.3 ist die Frame-Groesse eine gewoehnliche 32-Bit-Zahl, nur der
	// Gesamtkopf ist "syncsafe".
	new DataView(head.buffer).setUint32(4, data.length)
	return concat([head, data])
}

/**
 * UTF-16LE mit BOM.
 *
 * @param {string} text
 * @return {Uint8Array}
 */
function utf16(text) {
	const s = String(text)
	const out = new Uint8Array(2 + s.length * 2)
	out[0] = 0xFF
	out[1] = 0xFE
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i)
		out[2 + i * 2] = c & 0xFF
		out[3 + i * 2] = c >> 8
	}
	return out
}

/**
 * @param {number} n
 * @return {number[]} vier Bytes zu je 7 Bit
 */
export function syncsafe(n) {
	return [(n >> 21) & 0x7F, (n >> 14) & 0x7F, (n >> 7) & 0x7F, n & 0x7F]
}

function concat(parts) {
	const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0))
	let o = 0
	for (const p of parts) {
		out.set(p, o)
		o += p.length
	}
	return out
}
