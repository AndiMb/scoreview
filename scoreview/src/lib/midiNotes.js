// Reiner SMF-Parser (Standard MIDI File) fuer die Partiturfakten: Noten,
// Studierbuchstaben und Tonarten, alle auf der Zeitachse von timing.json.
//
// Warum ein eigener Parser und nicht der des Players: `sequencer.midiData`
// liefert in spessasynth_lib keine Ereignisse an die Seite (player.js), und
// der stille Modus ohne SoundFont hat gar keinen Sequencer. Anfangston,
// Studierbuchstaben-Rueckfall und spaeter Intonation und Mitverfolgen
// brauchen die Noten aber in beiden Faellen. `BasicMIDI` aus spessasynth_core
// waere die Alternative - dafuer muesste eine nur transitive
// Abhaengigkeit ausdruecklich werden, fuer wenige hundert Zeilen.
//
// **Zeitachse:** MuseScore schreibt die Wiederholungen ausgerollt ins MIDI,
// genau wie in timing.json (M7). Die Millisekunden hier sind deshalb
// Partiturzeit im Sinne des Cursors, ein Takt kann mehrfach vorkommen.
// Gemessen an der Testpartitur m1-test: Note 2 beginnt bei 500 ms, derselbe Wert wie das
// zweite Segment in timing.json.

const DEFAULT_TEMPO_US_PER_QUARTER = 500000

const META_MARKER = 0x06
const META_TEMPO = 0x51
const META_KEY_SIGNATURE = 0x59
const META_END_OF_TRACK = 0x2f

/**
 * @typedef {{onMs:number, offMs:number, pitch:number, channel:number, track:number, velocity:number}} MidiNote
 * @typedef {{timeMs:number, text:string}} MidiMarker
 * @typedef {{timeMs:number, sf:number, mi:number}} MidiKeySig
 * @typedef {{notes:MidiNote[], markers:MidiMarker[], keySigs:MidiKeySig[], durationMs:number}} ParsedMidi
 */

/**
 * @param {ArrayBuffer|Uint8Array} input die Datei score.mid
 * @return {ParsedMidi}
 * @throws {Error} wenn es gar keine SMF-Datei ist. Ein abgeschnittener Track
 *   dagegen liefert, was bis dahin lesbar war - eine halbe Partitur ist fuer
 *   den Anfangston nuetzlicher als keine.
 */
export function parseMidiNotes(input) {
	const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
	const reader = createReader(bytes)

	if (reader.ascii(4) !== 'MThd') {
		throw new Error('Keine MIDI-Datei (MThd fehlt)')
	}
	const headerLength = reader.uint32()
	reader.uint16() // Format: 0 und 1 werden gleich behandelt - alle Spuren laufen parallel.
	const trackCount = reader.uint16()
	const division = reader.uint16()
	reader.skip(headerLength - 6)

	const rawTracks = []
	for (let t = 0; t < trackCount && !reader.atEnd(); t++) {
		const chunkId = reader.ascii(4)
		const length = reader.uint32()
		const start = reader.pos
		const end = Math.min(bytes.length, start + length)
		if (chunkId === 'MTrk') {
			rawTracks.push(readTrackEvents(bytes, start, end))
		} else {
			// Fremde Chunks sind laut SMF erlaubt und zu ueberspringen; sie
			// zaehlen nicht als Spur.
			t--
		}
		reader.seek(end)
	}

	const toMs = createTickConverter(division, rawTracks)

	const notes = []
	const markers = []
	const keySigs = []
	let endTick = 0
	const decoder = new TextDecoder('utf-8')

	rawTracks.forEach((events, trackIndex) => {
		// Offene Noten je Kanal und Tonhoehe als Warteschlange: Liegt dieselbe
		// Tonhoehe zweimal an, endet die zuerst begonnene zuerst.
		const open = new Map()
		for (const event of events) {
			endTick = Math.max(endTick, event.tick)
			if (event.type === 'noteOn' && event.velocity > 0) {
				const key = event.channel * 128 + event.pitch
				if (!open.has(key)) {
					open.set(key, [])
				}
				open.get(key).push(event)
			} else if (event.type === 'noteOn' || event.type === 'noteOff') {
				const queue = open.get(event.channel * 128 + event.pitch)
				const begin = queue?.shift()
				if (begin) {
					notes.push(makeNote(begin, event.tick, trackIndex, toMs))
				}
			} else if (event.type === 'meta' && event.metaType === META_MARKER) {
				markers.push({ timeMs: toMs(event.tick), text: decoder.decode(event.data).trim() })
			} else if (event.type === 'meta' && event.metaType === META_KEY_SIGNATURE && event.data.length >= 2) {
				// sf ist vorzeichenbehaftet (-7..7), mi 0 = Dur, 1 = Moll.
				// MuseScore schreibt mi gemessen immer 0 - deshalb
				// traegt der Rueckfall in scoreFacts.js keinen Modus.
				keySigs.push({ timeMs: toMs(event.tick), sf: (event.data[0] << 24) >> 24, mi: event.data[1] })
			}
		}
		// Ohne Note-off (abgeschnittene Datei) endet die Note mit der Spur.
		const trackEnd = events.length > 0 ? events[events.length - 1].tick : 0
		for (const queue of open.values()) {
			for (const begin of queue) {
				notes.push(makeNote(begin, trackEnd, trackIndex, toMs))
			}
		}
	})

	notes.sort((a, b) => a.onMs - b.onMs || a.pitch - b.pitch)
	markers.sort((a, b) => a.timeMs - b.timeMs)
	keySigs.sort((a, b) => a.timeMs - b.timeMs)

	return { notes, markers, keySigs, durationMs: toMs(endTick) }
}

function makeNote(begin, endTick, track, toMs) {
	return {
		onMs: toMs(begin.tick),
		offMs: toMs(Math.max(endTick, begin.tick)),
		pitch: begin.pitch,
		channel: begin.channel,
		track,
		velocity: begin.velocity,
	}
}

/**
 * Liest die Ereignisse einer Spur mit absoluten Ticks. Laufstatus (running
 * status) ist Pflicht: MuseScore nutzt ihn fuer jede Folgenote.
 *
 * @param {Uint8Array} bytes
 * @param {number} start
 * @param {number} end
 * @return {Array<object>}
 */
function readTrackEvents(bytes, start, end) {
	const reader = createReader(bytes, start, end)
	const events = []
	let tick = 0
	let runningStatus = 0

	while (!reader.atEnd()) {
		const delta = reader.varLen()
		if (delta === null) {
			break
		}
		tick += delta
		let status = reader.peek()
		if (status === null) {
			break
		}
		if (status & 0x80) {
			reader.skip(1)
		} else {
			status = runningStatus
			if (!status) {
				// Datenbyte ohne vorherigen Status: die Spur ist kaputt.
				break
			}
		}

		if (status === 0xff) {
			const metaType = reader.byte()
			const length = reader.varLen()
			if (metaType === null || length === null) {
				break
			}
			const data = reader.bytes(length)
			if (metaType === META_END_OF_TRACK) {
				events.push({ tick, type: 'end' })
				break
			}
			events.push({ tick, type: 'meta', metaType, data })
			continue
		}
		if (status === 0xf0 || status === 0xf7) {
			const length = reader.varLen()
			if (length === null) {
				break
			}
			reader.skip(length)
			continue
		}

		runningStatus = status
		const kind = status & 0xf0
		const channel = status & 0x0f
		const dataLength = (kind === 0xc0 || kind === 0xd0) ? 1 : 2
		const data = reader.bytes(dataLength)
		if (data.length < dataLength) {
			break
		}
		if (kind === 0x90) {
			events.push({ tick, type: 'noteOn', channel, pitch: data[0], velocity: data[1] })
		} else if (kind === 0x80) {
			events.push({ tick, type: 'noteOff', channel, pitch: data[0], velocity: data[1] })
		}
	}
	return events
}

/**
 * Tick → Millisekunden ueber die Tempokarte ALLER Spuren. Nach SMF steht sie
 * im Format 1 in der ersten Spur; alle zu lesen kostet nichts und vertraegt
 * auch Dateien, die sich nicht daran halten.
 *
 * @param {number} division Kopfwert: Ticks je Viertel, oder SMPTE
 * @param {Array<Array<object>>} tracks
 * @return {function(number): number}
 */
function createTickConverter(division, tracks) {
	if (division & 0x8000) {
		// SMPTE: feste Zeit je Tick, ohne Tempokarte.
		const framesPerSecond = -((division >> 8) << 24 >> 24)
		const ticksPerFrame = division & 0xff
		const msPerTick = 1000 / (framesPerSecond * ticksPerFrame)
		return (tick) => tick * msPerTick
	}
	const ticksPerQuarter = division || 480

	const changes = []
	for (const events of tracks) {
		for (const event of events) {
			if (event.type === 'meta' && event.metaType === META_TEMPO && event.data.length >= 3) {
				changes.push({ tick: event.tick, usPerQuarter: (event.data[0] << 16) | (event.data[1] << 8) | event.data[2] })
			}
		}
	}
	changes.sort((a, b) => a.tick - b.tick)

	// Abschnitte mit fester Geschwindigkeit, je mit der Startzeit in ms.
	const segments = [{ tick: 0, ms: 0, usPerQuarter: DEFAULT_TEMPO_US_PER_QUARTER }]
	for (const change of changes) {
		const last = segments[segments.length - 1]
		const ms = last.ms + ((change.tick - last.tick) * last.usPerQuarter) / ticksPerQuarter / 1000
		if (change.tick === last.tick) {
			// Mehrere Tempi auf demselben Tick (MuseScore wiederholt das Tempo
			// am Beginn jedes Wiederholungsdurchgangs): das letzte gilt.
			last.usPerQuarter = change.usPerQuarter
		} else {
			segments.push({ tick: change.tick, ms, usPerQuarter: change.usPerQuarter })
		}
	}

	return (tick) => {
		let lo = 0
		let hi = segments.length - 1
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1
			if (segments[mid].tick <= tick) {
				lo = mid
			} else {
				hi = mid - 1
			}
		}
		const segment = segments[lo]
		return segment.ms + ((tick - segment.tick) * segment.usPerQuarter) / ticksPerQuarter / 1000
	}
}

function createReader(bytes, start = 0, end = bytes.length) {
	let pos = start
	return {
		get pos() {
			return pos
		},
		atEnd: () => pos >= end,
		seek(p) {
			pos = p
		},
		skip(n) {
			pos = Math.min(end, pos + Math.max(0, n))
		},
		peek: () => (pos < end ? bytes[pos] : null),
		byte() {
			return pos < end ? bytes[pos++] : null
		},
		bytes(n) {
			const slice = bytes.subarray(pos, Math.min(end, pos + n))
			pos += slice.length
			return slice
		},
		ascii(n) {
			return String.fromCharCode(...this.bytes(n))
		},
		uint16() {
			const [a = 0, b = 0] = this.bytes(2)
			return (a << 8) | b
		},
		uint32() {
			const [a = 0, b = 0, c = 0, d = 0] = this.bytes(4)
			return ((a << 24) >>> 0) + ((b << 16) | (c << 8) | d)
		},
		// Variable Laenge, hoechstens vier Bytes (SMF). null = Datei zu Ende.
		varLen() {
			let value = 0
			for (let i = 0; i < 4; i++) {
				const b = this.byte()
				if (b === null) {
					return null
				}
				value = (value << 7) | (b & 0x7f)
				if (!(b & 0x80)) {
					return value
				}
			}
			return value
		},
	}
}
