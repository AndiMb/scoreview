// Zoom from the slider and from Ctrl+wheel, batched (useZoom.js,
// useBandZoom.js).
//
// Both fire far more often than a zoom can be laid out: a trackpad sends
// about 60 wheel events a second, a dragged slider one per pixel, and every
// zoom change re-lays out all pages or band frames (measured ~16 ms per
// change at the desktop, several times that on a phone). So, as for the
// pinch (pinchPreview.js): while the gesture lasts the container is only
// scaled on the compositor, and the zoom itself is set once at its end -
// on the slider's `change`, or after IDLE_MS without a further event, which
// is the only end a wheel has. Where no preview is possible (no
// element.animate(), or no container on screen, as in the lyrics view) the
// zoom is set at most once per frame instead.
import { createPinchPreview } from './pinchPreview.js'

/** Quiet time that ends a wheel gesture. */
export const IDLE_MS = 150

/**
 * @param {object} deps
 * @param {() => ?Element} deps.target the container the preview scales
 * @param {() => number} deps.current the zoom as set now
 * @param {(value: number) => number} deps.clamp into the zoom's range
 * @param {(value: number) => void} deps.commit sets the zoom for real
 * @param {object} [deps.preview] createPinchPreview() - for tests
 * @return {{to: (value: number, point?: ?{x: number, y: number}) => void, by: (factor: number, point?: ?{x: number, y: number}) => void, finish: () => void, cancel: () => void, pending: () => ?number}}
 */
export function createZoomGesture({ target, current, clamp, commit, preview = createPinchPreview() }) {
	// The zoom when the gesture began; null outside a gesture.
	let base = null
	// The zoom the gesture asks for now, not yet set.
	let wanted = null
	let previewing = false
	let frame = null
	let idle = null

	/** @param {?{x: number, y: number}} point client coordinates to scale around */
	function begin(point) {
		if (base !== null) {
			return
		}
		base = current()
		const el = target()
		previewing = preview.supported(el)
		if (previewing) {
			// The slider has no point of its own: the middle of what is seen.
			const at = point ?? centreOf(el)
			preview.startAt(el, at.x, at.y)
		}
	}

	function schedule() {
		if (frame === null) {
			frame = requestAnimationFrame(() => {
				frame = null
				if (wanted === null) {
					return
				}
				if (previewing) {
					preview.show(wanted / base)
				} else {
					commit(wanted)
				}
			})
		}
		clearTimeout(idle)
		idle = setTimeout(finish, IDLE_MS)
	}

	/**
	 * @param {number} value the zoom asked for
	 * @param {?{x: number, y: number}} [point]
	 */
	function to(value, point = null) {
		begin(point)
		wanted = clamp(value)
		schedule()
	}

	/**
	 * @param {number} factor on the zoom asked for so far
	 * @param {?{x: number, y: number}} [point]
	 */
	function by(factor, point = null) {
		to((wanted ?? current()) * factor, point)
	}

	/** The end of the gesture: the one real zoom change. */
	function finish() {
		const value = wanted
		cancel()
		if (value !== null && value !== current()) {
			commit(value)
		}
	}

	/** Drops the gesture without setting anything - on reset and unmount. */
	function cancel() {
		if (frame !== null) {
			cancelAnimationFrame(frame)
			frame = null
		}
		clearTimeout(idle)
		idle = null
		if (previewing) {
			preview.end()
			previewing = false
		}
		base = null
		wanted = null
	}

	return { to, by, finish, cancel, pending: () => wanted }
}

/**
 * The middle of the part of `el` on screen, in client coordinates - a
 * container taller than the screen would otherwise scale around a point
 * far below it.
 *
 * @param {Element} el
 * @return {{x: number, y: number}}
 */
function centreOf(el) {
	const box = el.getBoundingClientRect()
	const height = globalThis.innerHeight ?? box.bottom
	const width = globalThis.innerWidth ?? box.right
	const top = Math.max(box.top, 0)
	const bottom = Math.min(box.bottom, height)
	const left = Math.max(box.left, 0)
	const right = Math.min(box.right, width)
	return { x: (left + right) / 2, y: (top + bottom) / 2 }
}
