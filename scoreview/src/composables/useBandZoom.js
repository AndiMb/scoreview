import { computed, getCurrentScope, onScopeDispose, ref } from 'vue'
import { computePinchZoom } from '../lib/scoreLayout.js'
import { readStored, writeStored } from '../lib/storage.js'
import { BAND_ZOOM_MAX, BAND_ZOOM_MIN } from '../lib/systemBand.js'
import { createPinchPreview } from './pinchPreview.js'
import { createZoomGesture } from './zoomGesture.js'

/** The size that suits a screen belongs to the device, not to the person. */
const STORAGE_KEY = 'scoreview-band-zoom'
const ZOOM_STEP = 1.2

function clamp(value) {
	return Math.min(BAND_ZOOM_MAX, Math.max(BAND_ZOOM_MIN, value))
}

function readZoom() {
	const value = Number(readStored(STORAGE_KEY))
	return Number.isFinite(value) && value > 0 ? clamp(value) : 1
}

function store(value) {
	// The default is not stored, so a later change of it reaches this device.
	writeStored(STORAGE_KEY, value === 1 ? null : String(value))
}

/**
 * The system band's own zoom: a factor on its default size (bandScale in
 * lib/systemBand.js), 1 = "Default size". Kept apart from the page zoom
 * (useZoom), which is a page width tied to the window and means nothing in
 * the band - one shared value would jump on every switch between the two.
 *
 * @param {object} [deps]
 * @param {() => ?Element} [deps.el] the band's scroller, scaled as a preview
 *   while the slider or the wheel moves (zoomGesture.js)
 * @return {object}
 */
export function useBandZoom({ el = () => null } = {}) {
	const zoom = ref(readZoom())
	const percent = computed(() => Math.round(zoom.value * 100))
	let pinching = false
	let pinchStartDistance = 0
	let pinchStartZoom = 1
	let pinchFrame = null
	let pinchZoom = null

	function set(value) {
		zoom.value = clamp(Number(value))
		store(zoom.value)
	}

	function by(factor) {
		set(zoom.value * factor)
	}

	function zoomIn() {
		by(ZOOM_STEP)
	}

	function zoomOut() {
		by(1 / ZOOM_STEP)
	}

	function reset() {
		set(1)
	}

	// Slider and Ctrl+wheel as on the pages (useZoom.js, zoomGesture.js).
	const gesture = createZoomGesture({ target: el, current: () => zoom.value, clamp, commit: set })

	/** @param {number} value from the slider - previewed, set at its end */
	function input(value) {
		gesture.to(value)
	}

	/** @param {WheelEvent} event with Ctrl, already prevented by the caller */
	function wheel(event) {
		gesture.by(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, { x: event.clientX, y: event.clientY })
	}

	function touchDistance(touches) {
		return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
	}

	// While the fingers move, a scale on the compositor; the zoom is set when
	// they let go (pinchPreview.js).
	const preview = createPinchPreview()
	let previewing = false

	// Two fingers zoom the band as they zoom the pages (useZoom.js); the
	// browser's own pinch zoom is off there by touch-action.
	function onTouchStart(event) {
		if (event.touches.length === 2) {
			pinching = true
			pinchStartDistance = touchDistance(event.touches)
			pinchStartZoom = zoom.value
			pinchZoom = null
			previewing = preview.supported(event.currentTarget)
			if (previewing) {
				preview.start(event.currentTarget, event.touches)
			}
		}
	}

	function onTouchMove(event) {
		if (pinching && event.touches.length === 2) {
			pinchZoom = computePinchZoom(pinchStartDistance, touchDistance(event.touches), pinchStartZoom, { min: BAND_ZOOM_MIN, max: BAND_ZOOM_MAX })
			// One change per frame: every change lays the frames out anew -
			// which is why, where it can, the band only shows a preview.
			if (pinchFrame === null) {
				pinchFrame = requestAnimationFrame(() => {
					pinchFrame = null
					if (previewing) {
						preview.show(pinchZoom / pinchStartZoom)
					} else {
						set(pinchZoom)
					}
				})
			}
		}
	}

	function onTouchEnd(event) {
		if (event.touches.length < 2 && pinching) {
			pinching = false
			cancelFrame()
			if (previewing) {
				preview.end()
				previewing = false
				if (pinchZoom !== null) {
					set(pinchZoom)
				}
			}
			pinchZoom = null
		}
	}

	function cancelFrame() {
		if (pinchFrame !== null) {
			cancelAnimationFrame(pinchFrame)
			pinchFrame = null
		}
	}

	function stop() {
		gesture.cancel()
		cancelFrame()
		preview.end()
		previewing = false
		pinching = false
	}

	// A safety net, not the order: the viewer stops this explicitly where
	// the order matters (beforeUnmount/reset), and a forgotten line there
	// must not leave it running. Calling it twice does no harm.
	if (getCurrentScope()) {
		onScopeDispose(stop)
	}

	return {
		zoom,
		percent,
		min: BAND_ZOOM_MIN,
		max: BAND_ZOOM_MAX,
		set,
		by,
		zoomIn,
		zoomOut,
		reset,
		input,
		inputDone: gesture.finish,
		wheel,
		onTouchStart,
		onTouchMove,
		onTouchEnd,
		stop,
	}
}
