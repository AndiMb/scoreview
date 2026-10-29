// Shows a pinch on the compositor while the fingers move, and leaves the
// real zoom to the end of the gesture (useZoom.js, useBandZoom.js).
//
// Setting the zoom per frame re-laid out every page or band frame and
// re-rastered the notation in each one - measured ~16 ms per change at the
// desktop (docs/limits.md), several times that on a phone, so the pinch
// lagged behind the fingers. A scale transform on the container costs a
// composite. It goes through the Web Animations API, not the `style`
// attribute: an attribute change anywhere in the viewer lets one of
// Nextcloud's :has() rules restyle the whole viewer (scorePageFrame.js),
// an animation changes no attribute.
//
// Where element.animate() is missing the preview is off, and the caller
// keeps zooming per frame as before.

/**
 * @return {{supported: (el: ?Element) => boolean, start: (el: Element, touches: TouchList) => void, show: (scale: number) => void, end: () => void}}
 */
export function createPinchPreview() {
	let el = null
	let origin = '50% 50%'
	let animation = null

	return {
		supported(target) {
			return typeof target?.animate === 'function'
		},

		/**
		 * Remembers the container and the point between the fingers, the
		 * point the preview scales around. One layout read per gesture.
		 *
		 * @param {Element} target
		 * @param {TouchList} touches
		 */
		start(target, touches) {
			el = target
			const box = target.getBoundingClientRect()
			const x = (touches[0].clientX + touches[1].clientX) / 2 - box.left
			const y = (touches[0].clientY + touches[1].clientY) / 2 - box.top
			origin = `${x}px ${y}px`
		},

		/** @param {number} scale relative to the zoom at the gesture's start */
		show(scale) {
			if (!el) {
				return
			}
			const keyframes = [{ transform: `scale(${scale})`, transformOrigin: origin }]
			if (animation) {
				animation.effect.setKeyframes(keyframes)
			} else {
				animation = el.animate(keyframes, { duration: 0, fill: 'forwards' })
			}
		},

		/** Takes the preview away - right before the real zoom is set. */
		end() {
			animation?.cancel()
			animation = null
			el = null
		},
	}
}
