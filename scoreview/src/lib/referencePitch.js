// The reference pitch a' (one value per user, Service\ViewerPreferences):
// what the tuner, the intonation check and wait mode hear against, and what
// the synthesizer plays at.
//
// **What is heard is converted, not the comparisons.** A frame at a' = 442
// is scaled to the pitch it would have at 440, once, where the frames come
// in (useIntonation.js, for live frames and for a recording). Everything
// behind it - intonation, rhythm, wait mode - keeps comparing against 440
// and needs no reference parameter of its own. The tuner shows the measured
// frequency itself and folds with nearest(hz, a4) instead.
//
// **The playback moves along**: someone singing with the accompaniment at
// 442 would otherwise hear 440 and be judged against 442, 8 cents flat
// without singing wrong. The synthesizer's global fine tune covers ±100
// cents, hence the range (Service\ViewerPreferences::REFERENCE_PITCH_MIN/MAX).

import { A4_HZ } from './intonation.js'

export const REFERENCE_PITCH_MIN = 420
export const REFERENCE_PITCH_MAX = 460

/**
 * Whole Hz within the range, the default without a usable number - as
 * Service\ViewerPreferences::normalizeReferencePitch().
 *
 * @param {unknown} value
 * @return {number}
 */
export function normalizeReferencePitch(value) {
	const hz = typeof value === 'string' && value.trim() === '' ? NaN : Number(value)
	if (value === null || value === undefined || typeof value === 'boolean' || !Number.isFinite(hz)) {
		return A4_HZ
	}
	return Math.max(REFERENCE_PITCH_MIN, Math.min(REFERENCE_PITCH_MAX, Math.round(hz)))
}

/**
 * The synthesizer's fine tune for a reference, in cents against 440.
 *
 * @param {number} a4
 * @return {number}
 */
export function fineTuneCents(a4) {
	return 1200 * Math.log2(normalizeReferencePitch(a4) / A4_HZ)
}

/**
 * Frames as if sung at a' = 440. The same array when nothing changes, so
 * the common case costs nothing.
 *
 * @template {{hz: ?number}} F
 * @param {F[]} frames
 * @param {number} a4
 * @return {F[]}
 */
export function framesAt440(frames, a4) {
	const ref = normalizeReferencePitch(a4)
	if (ref === A4_HZ) {
		return frames
	}
	const factor = A4_HZ / ref
	return frames.map((f) => (f.hz ? { ...f, hz: f.hz * factor } : f))
}
