// Not used by the viewer: with a tapped starting place the online warp
// measured better (91 % against 85 % of bars within one bar). Kept and
// tested because tools/follow/replay.mjs compares both, and without a tap
// this tracker turned fewer wrong pages.
//
// Local following with a tempo model - the alternative to lib/onlineWarp.js
// behind the same interface (anchor, step, tempoRatio, position), chosen by
// scoreFollower's `tracker` option. Pure, no DOM, no AudioContext.
//
// Why: measured on rehearsal recordings, a choir holds its tempo within
// about ±10 % while the score does not change it, but the online warp may
// move at 0 to 2x on every tap; its tempo swung between -0.1 and 1.85. Here
// the place is a cloud of hypotheses (place, tempo, singing or paused) - a
// particle filter, built the way the published followers build theirs
// (claudedocs/research_mitblaettern_verfahren_2026-11-14.md):
//
// - Tempo changes only where the score has an onset (Duan & Pardo 2011,
//   Korzeniowski et al. 2013): between onsets the music says nothing new
//   about timing. It changes in log space, is pulled a little towards the
//   cloud's mean tempo (against the cloud drifting apart) and stays within
//   bounds.
//   Measured with a per-tap drift instead: the cloud slid to the lower bound
//   and lagged behind the singing while still "matching".
// - A pause is a state of its own (Korzeniowski 2013, Nakamura et al. 2013):
//   paused hypotheses stand still with their tempo frozen and are judged
//   against a fixed "no music" level, so speech and given tones make the
//   place stand. Switching is rare - measured with free switching, the
//   back-and-forth moved the place like a random walk and replaced the
//   tempo.
// - Leaving a pause goes on where the singing stopped, or starts again at a
//   plausible entry (bar after a rest, system start, rehearsal mark) a
//   little before or after - "again from bar 5" (Nakamura 2013: a jump is a
//   stop, a pause and a fresh start).

import { similarity } from './chroma.js'
import { nearestOccurrenceMs } from './followRef.js'

/**
 * @param {import('./followRef.js').FollowReference} reference
 * @param {object} [options]
 * @param {number} [options.particles] number of hypotheses (Duan & Pardo: 100 got lost, 1000 rarely)
 * @param {number} [options.tempoSigma] spread of the log tempo change at an onset
 * @param {number} [options.tempoPull] share by which a hypothesis' tempo moves to the mean at an onset
 * @param {number[]} [options.tempoBounds] tempo relative to the score, hard bounds
 * @param {number[]} [options.tempoStart] tempo of a fresh anchor without a known tempo
 * @param {number} [options.placeJitter] spread of the place per sung tap, in frames
 * @param {number} [options.sharpness] likelihood exp(sharpness * (sim - 1))
 * @param {number} [options.pauseLevel] similarity a paused hypothesis is credited with while sound is heard
 * @param {number} [options.stopRate] chance per tap that singing stops
 * @param {number} [options.startRate] chance per tap that a pause ends
 * @param {number} [options.restartShare] share of resuming hypotheses that start at an entry instead
 * @param {number} [options.restartAfterMs] pause a hypothesis must have stood before it may start again elsewhere
 * @param {number} [options.restartBackMs] how far back an entry may lie
 * @param {number} [options.restartAheadMs] how far ahead an entry may lie
 * @param {number} [options.verseBackCost] cost of an entry in an earlier verse relative to a later one
 * @param {number} [options.reseedRate] share of hypotheses scattered afresh per tap
 * @param {number} [options.reseedFrames] how far ahead of the estimate they land at most
 * @param {number} [options.reseedBack] how far behind, as a share of reseedFrames
 * @param {number} [options.onsetWeight] weight of the onset match (0 = chroma only). Off by
 *   default: measured on the rehearsal recordings, weights 1-8 followed worse than chroma alone,
 *   although the onset match itself is sharp at the true place (lib/followRef.js onsetChromaOf)
 * @param {number} [options.onsetAdapt] how fast the typical onset strength is learned
 * @param {number} [options.pauseOnset] onset match a paused hypothesis is credited with
 * @param {number} [options.seed] for the random numbers - replays must repeat
 * @return {object}
 */
export function createTempoTracker(reference, options = {}) {
	const {
		particles: count = 1000,
		tempoSigma = 0.05,
		tempoPull = 0.1,
		tempoBounds = [0.5, 2],
		tempoStart = [0.8, 1.25],
		placeJitter = 0.1,
		sharpness = 6,
		pauseLevel = 0.5,
		stopRate = 0.005,
		startRate = 0.05,
		restartShare = 0.3,
		restartAfterMs = 1500,
		restartBackMs = 60000,
		restartAheadMs = 5000,
		verseBackCost = 0.5,
		reseedRate = 0.005,
		reseedFrames = 40,
		reseedBack = 0.1,
		onsetWeight = 0,
		onsetAdapt = 0.02,
		pauseOnset = 0.15,
		seed = 1,
	} = options
	const n = reference.frames
	const frameMs = reference.frameMs
	const ensembles = reference.ensembles
	const scoreOnset = reference.onset ?? new Uint8Array(n).fill(1)
	const entries = entryFrames(reference)
	const random = mulberry32(seed)
	const restartAfter = restartAfterMs / frameMs
	let place = new Float64Array(count)
	let tempo = new Float64Array(count)
	let singing = new Uint8Array(count)
	// Taps each paused hypothesis has stood.
	let paused = new Float64Array(count)
	let weight = new Float64Array(count).fill(1 / count)
	let anchored = false
	let estimate = null
	let meanTempo = 1
	// Whether the last tap was taken as singing.
	let wasSinging = false
	const fit = new Float64Array(ensembles.length)
	let active = 0
	const sims = new Map()
	const onsetSims = new Map()
	const onsetChroma = reference.onsetChroma ?? null
	// Running typical onset strength: only taps above it carry an onset.
	let typicalStrength = null
	const pauseHeard = Math.exp(sharpness * (pauseLevel - 1))
	// Silence: a paused hypothesis explains it well, a singing one only in a
	// rest of the score (or a breath, which is rare).
	const pauseSilent = Math.exp(sharpness * (0.9 - 1))
	const breath = Math.exp(sharpness * (0.3 - 1))

	function anchor(frame, spread = 10) {
		const known = anchored ? meanTempo : null
		for (let i = 0; i < count; i++) {
			place[i] = clamp(frame + spread * gaussian(random) / 2, 0, n - 1)
			tempo[i] = known !== null
				? clamp(known * Math.exp(tempoSigma * gaussian(random)), tempoBounds[0], tempoBounds[1])
				: tempoStart[0] * Math.pow(tempoStart[1] / tempoStart[0], random())
			singing[i] = 1
			paused[i] = 0
		}
		weight.fill(1 / count)
		anchored = true
		estimate = Math.round(frame)
		wasSinging = true
		meanTempo = known ?? Math.sqrt(tempoStart[0] * tempoStart[1])
		fit.fill(0)
		active = 0
	}

	/**
	 * Best similarity over the ensembles at a frame; -1 where all rest.
	 *
	 * @param chroma
	 * @param j
	 */
	function simAt(chroma, j) {
		let s = sims.get(j)
		if (s === undefined) {
			s = -1
			for (const e of ensembles) {
				if (!e.silent[j]) {
					s = Math.max(s, similarity(chroma, e.chroma.subarray(j * 12, j * 12 + 12)))
				}
			}
			sims.set(j, s)
		}
		return s
	}

	/**
	 * How well the sound's rise matches the notes beginning at j (±1 frame:
	 * the onset may fall into the neighbouring tap).
	 *
	 * @param {Float32Array} flux
	 * @param {number} j
	 * @return {number}
	 */
	function onsetSimAt(flux, j) {
		let s = onsetSims.get(j)
		if (s === undefined) {
			s = 0
			for (let k = Math.max(0, j - 1); k <= Math.min(n - 1, j + 1); k++) {
				s = Math.max(s, similarity(flux, onsetChroma.subarray(k * 12, k * 12 + 12)))
			}
			onsetSims.set(j, s)
		}
		return s
	}

	/**
	 * @param {?Float32Array} chroma null: the gates heard no music
	 * @param {?{flux: Float32Array, strength: number}} [onset] the sound's rise (lib/chroma.js onsetFlux)
	 * @return {{position: ?number, matched: boolean, similarity: number, ensemble: ?string}}
	 */
	function step(chroma, onset = null) {
		if (!anchored) {
			return { position: null, matched: false, similarity: 0, ensemble: null }
		}
		sims.clear()
		onsetSims.clear()
		let flux = null
		if (onset && onsetChroma && onsetWeight > 0) {
			typicalStrength = typicalStrength === null ? onset.strength : typicalStrength + onsetAdapt * (onset.strength - typicalStrength)
			if (onset.strength > typicalStrength) {
				flux = onset.flux
			}
		}
		const rests = ensembles[active].silent
		let total = 0
		for (let i = 0; i < count; i++) {
			// A few hypotheses scattered afresh keep the true place reachable
			// once the cloud has lost it - but almost only ahead: measured,
			// scattered evenly, the ones landing behind on a held chord fitted
			// as well as the true place, and the place crept backwards
			// (isolated tracker 41 % within a bar, 69 % with reseedBack 0.1,
			// 25 % without any scattering). Only while singing is heard: in
			// a pause they would carry the place on through the talking.
			if (wasSinging && random() < reseedRate) {
				place[i] = clamp(estimate + reseedFrames * ((1 + reseedBack) * random() - reseedBack), 0, n - 1)
				tempo[i] = clamp(meanTempo * Math.exp(2 * tempoSigma * gaussian(random)), tempoBounds[0], tempoBounds[1])
				singing[i] = 1
			} else if (singing[i]) {
				if (random() < stopRate) {
					singing[i] = 0
				}
			} else if (random() < startRate) {
				singing[i] = 1
				// Only after a real pause: measured, hypotheses that "paused"
				// for a few taps inside a strophic song started again at
				// the same notes one verse earlier and pulled the place 45 s
				// back.
				if (paused[i] >= restartAfter && random() < restartShare) {
					restart(i)
				}
			}
			if (singing[i]) {
				paused[i] = 0
			} else {
				paused[i]++
			}
			let likelihood
			if (singing[i]) {
				move(i)
				const j = frameOf(place[i])
				likelihood = chroma ? Math.exp(sharpness * (simAt(chroma, j) - 1)) : rests[j] ? 1 : breath
				if (flux) {
					likelihood *= Math.exp(onsetWeight * (onsetSimAt(flux, j) - 1))
				}
			} else {
				likelihood = chroma ? pauseHeard : pauseSilent
				if (flux) {
					// A rise in the sound while paused: credited like a weak
					// onset match (measured: 0.12-0.15 half a second off the
					// true place, 0.19-0.30 on it).
					likelihood *= Math.exp(onsetWeight * (pauseOnset - 1))
				}
			}
			weight[i] *= likelihood
			total += weight[i]
		}
		if (total > 0 && Number.isFinite(total)) {
			for (let i = 0; i < count; i++) {
				weight[i] /= total
			}
		} else {
			weight.fill(1 / count)
		}
		let singShare = 0
		let meanSim = 0
		let tempoSum = 0
		for (let i = 0; i < count; i++) {
			if (singing[i]) {
				singShare += weight[i]
				tempoSum += weight[i] * tempo[i]
				if (chroma) {
					meanSim += weight[i] * Math.max(0, simAt(chroma, frameOf(place[i])))
				}
			}
		}
		if (singShare > 0) {
			meanTempo = tempoSum / singShare
			meanSim /= singShare
		}
		const matched = !!chroma && singShare >= 0.5
		wasSinging = matched
		estimate = weightedMedian(place)
		if (matched) {
			updateFit(chroma, frameOf(estimate))
		}
		resampleIfNeeded()
		return {
			position: Math.round(estimate),
			matched,
			similarity: matched ? meanSim : 0,
			ensemble: ensembles[active].id,
		}
	}

	/**
	 * One sung tap: move at the tempo; at an onset, the tempo may change.
	 *
	 * @param i
	 */
	function move(i) {
		const from = frameOf(place[i])
		place[i] = clamp(place[i] + tempo[i] + placeJitter * gaussian(random), 0, n - 1)
		const to = frameOf(place[i])
		for (let j = from + 1; j <= to; j++) {
			if (scoreOnset[j]) {
				// Its own tempo, pulled a little towards the cloud's mean.
				// Measured with the mean alone (every hypothesis forgetting
				// its tempo at each onset): the position no longer selected
				// for tempo, and even on the score's own sound at 1.15x the
				// cloud settled at 0.8x and fell behind.
				const own = Math.log(tempo[i])
				const pulled = own + tempoPull * (Math.log(meanTempo) - own)
				tempo[i] = clamp(Math.exp(pulled + tempoSigma * gaussian(random)), tempoBounds[0], tempoBounds[1])
				break
			}
		}
	}

	/**
	 * Leave a pause at an entry near the place: a bar after a rest, a system, a mark.
	 *
	 * @param i
	 */
	function restart(i) {
		const lo = place[i] - restartBackMs / frameMs
		const hi = place[i] + restartAheadMs / frameMs
		let a = lowerBound(entries.frames, lo)
		const b = lowerBound(entries.frames, hi)
		if (b <= a) {
			return
		}
		let sum = 0
		for (let k = a; k < b; k++) {
			sum += entries.weight[k]
		}
		let u = random() * sum
		for (; a < b - 1; a++) {
			u -= entries.weight[a]
			if (u <= 0) {
				break
			}
		}
		// An entry in another verse is the same bar on paper: start in the
		// verse that is being rehearsed.
		place[i] = nearestOccurrenceMs(reference, entries.frames[a] * frameMs, place[i] * frameMs, { backCost: verseBackCost }) / frameMs
	}

	function resampleIfNeeded() {
		let sumSq = 0
		for (let i = 0; i < count; i++) {
			sumSq += weight[i] * weight[i]
		}
		if (1 / sumSq >= count / 2) {
			return
		}
		// Systematic resampling.
		const newPlace = new Float64Array(count)
		const newTempo = new Float64Array(count)
		const newSinging = new Uint8Array(count)
		const newPaused = new Float64Array(count)
		const u0 = random() / count
		let c = weight[0]
		let k = 0
		for (let i = 0; i < count; i++) {
			const u = u0 + i / count
			while (u > c && k < count - 1) {
				k++
				c += weight[k]
			}
			newPlace[i] = place[k]
			newTempo[i] = tempo[k]
			newSinging[i] = singing[k]
			newPaused[i] = paused[k]
		}
		place = newPlace
		tempo = newTempo
		singing = newSinging
		paused = newPaused
		weight = new Float64Array(count).fill(1 / count)
	}

	function updateFit(chroma, j) {
		for (let e = 0; e < ensembles.length; e++) {
			if (!ensembles[e].silent[j]) {
				fit[e] += 0.05 * (similarity(chroma, ensembles[e].chroma.subarray(j * 12, j * 12 + 12)) - fit[e])
			}
		}
		for (let e = 0; e < ensembles.length; e++) {
			if (fit[e] > fit[active]) {
				active = e
			}
		}
	}

	// The median, not the mean: with the cloud split between "paused here"
	// and "started again there", the mean lies where nobody sings.
	function weightedMedian(values) {
		const order = Array.from(values.keys()).sort((a, b) => values[a] - values[b])
		let acc = 0
		for (const i of order) {
			acc += weight[i]
			if (acc >= 0.5) {
				return values[i]
			}
		}
		return values[order[order.length - 1]]
	}

	function frameOf(x) {
		return clamp(Math.round(x), 0, n - 1)
	}

	/**
	 * Tempo of the performance relative to the score: the singing hypotheses' mean.
	 *
	 * @return {number}
	 */
	function tempoRatio() {
		return anchored ? meanTempo : 1
	}

	/** Copies of the hypotheses, for the measuring rig. */
	function snapshot() {
		return { place: place.slice(), tempo: tempo.slice(), singing: singing.slice(), paused: paused.slice(), weight: weight.slice() }
	}

	return { anchor, step, tempoRatio, snapshot, position: () => (estimate === null ? null : Math.round(estimate)) }
}

/**
 * Entry points in reference frames, from the reference's entry prior.
 *
 * @param {import('./followRef.js').FollowReference} reference
 * @return {{frames: Float64Array, weight: Float64Array}}
 */
function entryFrames(reference) {
	const prior = reference.entryPrior ?? new Float32Array(0)
	const scale = (reference.censMs ?? reference.frameMs) / reference.frameMs
	const frames = []
	const weight = []
	for (let k = 0; k < prior.length; k++) {
		if (prior[k] > 0) {
			frames.push(Math.min(reference.frames - 1, k * scale))
			weight.push(prior[k])
		}
	}
	return { frames: Float64Array.from(frames), weight: Float64Array.from(weight) }
}

function lowerBound(sorted, value) {
	let lo = 0
	let hi = sorted.length
	while (lo < hi) {
		const mid = (lo + hi) >> 1
		if (sorted[mid] < value) {
			lo = mid + 1
		} else {
			hi = mid
		}
	}
	return lo
}

function clamp(v, min, max) {
	return Math.min(max, Math.max(min, v))
}

/**
 * Small seeded generator; Math.random would make every replay differ.
 *
 * @param seed
 */
function mulberry32(seed) {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6D2B79F5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

function gaussian(random) {
	const u = 1 - random()
	const v = random()
	return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}
