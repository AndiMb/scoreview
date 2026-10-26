import { computed, shallowRef } from 'vue'

// Where popovers and dropdowns attach. NcPopover puts them into <body> and
// NcSelect does the same (appendToBody). In real fullscreen the browser shows
// only the fullscreen element's subtree, so a popover in <body> opened, was
// "shown" - and stayed invisible: on the desktop the bar's groups did not
// open (measured: popper shown, outside document.fullscreenElement). While
// the viewer is fullscreen they go into the viewer instead; otherwise they
// stay in <body>, where they are not clipped by the viewer.
// Fullscreen inside the page (useZoom.js) needs none of this - nothing is
// hidden there, the viewer only lies on top.

const fullscreenElement = shallowRef(typeof document === 'undefined' ? null : document.fullscreenElement)
let listening = false

/**
 * @return {{container: import('vue').ComputedRef<string>, inFullscreen: import('vue').ComputedRef<boolean>}}
 *   container: for NcPopover's `container`; inFullscreen: NcSelect's
 *   `appendToBody` is its negation
 */
export function useFullscreenContainer() {
	if (!listening && typeof document !== 'undefined') {
		// One listener for every popover, for the lifetime of the page.
		document.addEventListener('fullscreenchange', () => {
			fullscreenElement.value = document.fullscreenElement
		})
		listening = true
	}
	const inFullscreen = computed(() => fullscreenElement.value?.classList?.contains('scoreview-viewer') ?? false)
	const container = computed(() => (inFullscreen.value ? '.scoreview-viewer' : 'body'))
	return { container, inFullscreen }
}
