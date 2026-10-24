// A generated test piece for the microphone follower: SATB with piano,
// deterministic from a seed. The committable test scores (repeat-test,
// lyrics-test, …) last 5-14 s and have one or two parts - too short and too
// thin for following, jumping and partial ensembles. Real choir scores may
// not go into the repository (CLAUDE.md, "Nie committen").
//
// Shape (bars of 4/4):
//   1-2   piano alone (intro)          → "accompaniment only"
//   3-10  A: choir and piano
//   11-14 B
//   15-16 piano alone (interlude)
//   17-24 A again, note for note       → ambiguous on purpose (F10)
//   25-32 C, ending
// Rehearsal marks at bars 3 (A), 11 (B), 17 (A'), 25 (C).

const VOICES = [
	{ id: '1', name: 'Soprano', channel: 0, range: [60, 79] },
	{ id: '2', name: 'Alto', channel: 1, range: [55, 72] },
	{ id: '3', name: 'Tenor', channel: 2, range: [48, 67] },
	{ id: '4', name: 'Bass', channel: 3, range: [40, 60] },
]
const PIANO = { id: '5', name: 'Piano', channel: 4 }

/** Diatonic triads of C major as pitch classes, by degree. */
const TRIADS = {
	I: [0, 4, 7],
	ii: [2, 5, 9],
	iii: [4, 7, 11],
	IV: [5, 9, 0],
	V: [7, 11, 2],
	vi: [9, 0, 4],
}
const NEXT = {
	I: ['IV', 'V', 'vi', 'ii'],
	ii: ['V', 'IV'],
	iii: ['vi', 'IV'],
	IV: ['V', 'I', 'ii'],
	V: ['I', 'vi'],
	vi: ['ii', 'IV', 'V'],
}

/**
 * @param {object} [options]
 * @param {number} [options.seed]
 * @param {number} [options.bpm]
 * @return {{notes: object[], parts: object[], metaParts: object[], measureStartsMs: number[], markersMs: number[], slices: object[], durationMs: number, barMs: number}}
 */
export function generatePiece({ seed = 7, bpm = 96 } = {}) {
	const random = mulberry32(seed)
	const beatMs = 60000 / bpm
	const barMs = 4 * beatMs
	const chordsFor = (bars, start) => {
		const list = []
		let degree = start
		for (let i = 0; i < bars * 2; i++) {
			list.push(degree)
			const options = NEXT[degree]
			degree = options[Math.floor(random() * options.length)]
		}
		// Cadence at the end of each section.
		list[list.length - 2] = 'V'
		list[list.length - 1] = 'I'
		return list
	}
	const sectionA = chordsFor(8, 'I')
	const sectionB = chordsFor(4, 'vi')
	const sectionC = chordsFor(8, 'IV')
	const intro = ['I', 'V', 'I', 'V']
	const interlude = ['IV', 'V', 'IV', 'V']
	// Two chords per bar, in order of the bars.
	const halves = [...intro, ...sectionA, ...sectionB, ...interlude, ...sectionA, ...sectionC]
	const choirSilentBars = new Set([0, 1, 14, 15])

	const notes = []
	let previous = VOICES.map((v) => Math.round((v.range[0] + v.range[1]) / 2))
	halves.forEach((degree, half) => {
		const bar = Math.floor(half / 2)
		const startMs = half * 2 * beatMs
		const triad = TRIADS[degree]
		// Piano: left hand root on beats, right hand triad on each beat.
		for (let beat = 0; beat < 2; beat++) {
			const on = startMs + beat * beatMs
			notes.push(note(on, beatMs * 0.9, 36 + triad[0], PIANO.channel))
			for (const pc of triad) {
				notes.push(note(on, beatMs * 0.9, 60 + pc, PIANO.channel))
			}
		}
		if (choirSilentBars.has(bar)) {
			return
		}
		const voicing = VOICES.map((voice, i) => {
			// The bass takes the root, the others the nearest chord tone.
			const classes = i === 3 ? [triad[0]] : triad
			return nearest(previous[i], classes, voice.range)
		})
		previous = voicing
		VOICES.forEach((voice, i) => {
			// The soprano moves in quarters on every second chord, so the
			// melody is not only held notes.
			if (i === 0 && half % 2 === 1) {
				notes.push(note(startMs, beatMs * 0.95, voicing[0], voice.channel))
				const other = nearest(voicing[0] + 2, triad, voice.range)
				notes.push(note(startMs + beatMs, beatMs * 0.95, other, voice.channel))
			} else {
				notes.push(note(startMs, 2 * beatMs * 0.95, voicing[i], voice.channel))
			}
		})
	})
	const bars = halves.length / 2
	const measureStartsMs = Array.from({ length: bars }, (_, i) => i * barMs)
	// Systems of four bars - what a phone shows as one row.
	const slices = []
	for (let b = 0; b < bars; b += 4) {
		slices.push({ fromMs: b * barMs, toMs: Math.min(bars, b + 4) * barMs })
	}
	const metaParts = [
		...VOICES.map((v) => ({ id: v.id, name: v.name, instrumentId: v.name.toLowerCase(), program: 52, lyricCount: 0 })),
		{ id: PIANO.id, name: PIANO.name, instrumentId: 'grand-piano', program: 0, lyricCount: 0 },
	]
	const parts = [
		...VOICES.map((v) => ({ id: v.id, label: v.name, channels: [v.channel], vocal: true })),
		{ id: PIANO.id, label: PIANO.name, channels: [PIANO.channel], vocal: false },
	]
	return {
		notes,
		parts,
		metaParts,
		measureStartsMs,
		markersMs: [2, 10, 16, 24].map((b) => b * barMs),
		slices,
		durationMs: bars * barMs,
		barMs,
		channels: { soprano: 0, alto: 1, tenor: 2, bass: 3, piano: 4 },
	}
}

function note(onMs, lengthMs, pitch, channel) {
	return { onMs, offMs: onMs + lengthMs, pitch, channel, track: channel, velocity: 80 }
}

function nearest(from, classes, [low, high]) {
	let best = null
	for (let p = low; p <= high; p++) {
		if (classes.includes(((p % 12) + 12) % 12) && (best === null || Math.abs(p - from) < Math.abs(best - from))) {
			best = p
		}
	}
	return best
}

/**
 * Small seeded PRNG - test cases must be the same on every run.
 *
 * @param {number} seed
 * @return {() => number}
 */
export function mulberry32(seed) {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6D2B79F5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}
