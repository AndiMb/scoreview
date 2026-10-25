import { computed, ref } from 'vue'
import { computePinchZoom } from '../lib/scoreLayout.js'
import { BAND_ZOOM_MAX, BAND_ZOOM_MIN } from '../lib/systemBand.js'

/** The size that suits a screen belongs to the device, not to the person. */
const STORAGE_KEY = 'scoreview-band-zoom'
const ZOOM_STEP = 1.2

function clamp(value) {
	return Math.min(BAND_ZOOM_MAX, Math.max(BAND_ZOOM_MIN, value))
}

function readStored() {
	try {
		const value = Number(window.localStorage.getItem(STORAGE_KEY))
		return Number.isFinite(value) && value > 0 ? clamp(value) : 1
	} catch {
		return 1
	}
}

function store(value) {
	try {
		if (value === 1) {
			window.localStorage.removeItem(STORAGE_KEY)
		} else {
			window.localStorage.setItem(STORAGE_KEY, String(value))
		}
	} catch {
		// Private mode or full storage: the zoom works, it is just not kept.
	}
}

/**
 * The system band's own zoom: a factor on its default size (bandScale in
 * lib/systemBand.js), 1 = "Default size". Kept apart from the page zoom
 * (useZoom), which is a page width tied to the window and means nothing in
 * the band - one shared value would jump on every switch between the two.
 *
 * @return {object}
 */
export function useBandZoom() {
	const zoom = ref(readStored())
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

	function touchDistance(touches) {
		return Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY)
	}

	// Two fingers zoom the band as they zoom the pages (useZoom.js); the
	// browser's own pinch zoom is off there by touch-action.
	function onTouchStart(event) {
		if (event.touches.length === 2) {
			pinching = true
			pinchStartDistance = touchDistance(event.touches)
			pinchStartZoom = zoom.value
		}
	}

	function onTouchMove(event) {
		if (pinching && event.touches.length === 2) {
			pinchZoom = computePinchZoom(pinchStartDistance, touchDistance(event.touches), pinchStartZoom, { min: BAND_ZOOM_MIN, max: BAND_ZOOM_MAX })
			// One change per frame: every change lays the frames out anew.
			if (pinchFrame === null) {
				pinchFrame = requestAnimationFrame(() => {
					pinchFrame = null
					set(pinchZoom)
				})
			}
		}
	}

	function onTouchEnd(event) {
		if (event.touches.length < 2) {
			pinching = false
		}
	}

	function stop() {
		if (pinchFrame !== null) {
			cancelAnimationFrame(pinchFrame)
			pinchFrame = null
		}
		pinching = false
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
		onTouchStart,
		onTouchMove,
		onTouchEnd,
		stop,
	}
}
