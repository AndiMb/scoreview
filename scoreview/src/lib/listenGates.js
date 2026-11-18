// Part of the microphone score follower (automatic page turning, behind the
// switch `feature_score_follower`): the viewer runs the level gate inside
// lib/scoreFollower.js in workers/followerWorker.js. The music gate below
// is measured and tested but not wired into the follower.
//
// Does this frame belong to the music at all? The level part of the answer
// - pure, no DOM, no AudioContext.
//
// The other part - "does it sound like anything near the current place?" -
// sits in the follower (lib/onlineWarp.js, `minMatch`), because only the
// follower knows the place. Measured on synthetic cases: chroma entropy
// does NOT separate speech from singing (median 0.75 against 0.69), the
// best similarity near the place does (singing ≥ 0.86 in 95 % of frames,
// speech 0.67 median, handling noise 0.52-0.62).
//
// Why relative to a recent peak and not to a noise floor: a choir sings for
// minutes without a pause, so a running minimum climbs to the music itself
// and would shut the gate in the middle of a piece. The recent peak stays
// near the music and falls only slowly in silence.
//
// Handling noise is a sudden jump against the previous tap, not "louder
// than the peak": measured, a gate that waited for the follower to confirm
// the peak let its remembered peak sink while the follower was still
// searching, and then rejected all music as spikes (116 of 1017 taps).

/**
 * @param {object} [options]
 * @param {number} [options.dropDb] below the recent peak by more than this = silence
 * @param {number} [options.decayDbPerSec] how fast the remembered peak sinks
 * @param {number} [options.minDb] never music below this level
 * @param {number} [options.spikeDb] a jump by more than this against the previous tap,
 *   above the peak by as much, is handling noise
 * @param {number} [options.spikeHoldMs] reject this long after a spike (the
 *   analysis window of 170 ms still holds it)
 * @return {{accept: (levelDb: number, atMs: number) => boolean, noteMusic: (levelDb: number) => void, peakDb: () => ?number}}
 */
export function createLevelGate({ dropDb = 30, decayDbPerSec = 1.5, minDb = -80, spikeDb = 10, spikeHoldMs = 200 } = {}) {
	let peak = null
	let lastAt = null
	let lastLevel = -Infinity
	let spikeUntil = -Infinity

	/**
	 * @param {number} levelDb from chroma.js::spectrumLevelDb
	 * @param {number} atMs time of the frame
	 * @return {boolean} whether the frame may count as music
	 */
	function accept(levelDb, atMs) {
		if (lastAt !== null && peak !== null) {
			peak -= (decayDbPerSec * Math.max(0, atMs - lastAt)) / 1000
		}
		lastAt = atMs
		const previous = lastLevel
		lastLevel = levelDb
		if (!Number.isFinite(levelDb) || levelDb < minDb) {
			return false
		}
		if (peak === null) {
			// The first sound sets the scale.
			peak = levelDb
			return true
		}
		if (levelDb > peak + spikeDb && levelDb - previous > spikeDb) {
			// A loud entry after silence looks the same for one window -
			// it costs 200 ms; a grip is over by then.
			spikeUntil = atMs + spikeHoldMs
			return false
		}
		if (atMs < spikeUntil) {
			return false
		}
		if (levelDb > peak) {
			peak = levelDb
		}
		return levelDb >= peak - dropDb
	}

	/**
	 * The follower matched this frame: it is music, so its level is the scale.
	 *
	 * @param {number} levelDb
	 */
	function noteMusic(levelDb) {
		if (Number.isFinite(levelDb) && (peak === null || levelDb > peak)) {
			peak = levelDb
		}
	}

	return { accept, noteMusic, peakDb: () => peak }
}

/**
 * Is the choir singing, or is someone talking, giving a tone, waiting?
 * Decided on the level over about a second against the level the music
 * reached recently - not frame by frame: a breath or a consonant inside a
 * phrase must not stop the follower.
 *
 * Measured on rehearsal recordings (device on the singer's stand): over one
 * second, talk sat 11 dB (median) below the loud singing, singing 4 dB;
 * the level told them apart better than any chroma feature (AUC 0.93
 * against 0.77 for the best match near the place). The conductor talks
 * from farther away than the choir sings around the device.
 *
 * @param {object} [options]
 * @param {number} [options.windowMs] length of the level average
 * @param {number} [options.dropDb] below the remembered music level by more than this = not singing
 * @param {number} [options.decayDbPerSec] how fast the remembered music level sinks
 * @param {number} [options.minDb] never music below this level
 * @return {{accept: (levelDb: number, atMs: number) => boolean, levelDb: () => ?number, musicDb: () => ?number}}
 */
export function createMusicGate({ windowMs = 1000, dropDb = 8, decayDbPerSec = 0.3, minDb = -80 } = {}) {
	const recent = []
	let sum = 0
	let music = null
	let lastAt = null
	let smoothed = null

	function accept(levelDb, atMs) {
		const level = Number.isFinite(levelDb) ? Math.max(levelDb, minDb - 20) : minDb - 20
		recent.push({ atMs, level })
		sum += level
		while (recent.length > 1 && recent[0].atMs <= atMs - windowMs) {
			sum -= recent.shift().level
		}
		smoothed = sum / recent.length
		if (lastAt !== null && music !== null) {
			music -= (decayDbPerSec * Math.max(0, atMs - lastAt)) / 1000
		}
		lastAt = atMs
		if (smoothed < minDb) {
			return false
		}
		if (music === null || smoothed > music) {
			music = smoothed
		}
		return smoothed >= music - dropDb
	}

	return { accept, levelDb: () => smoothed, musicDb: () => music }
}
