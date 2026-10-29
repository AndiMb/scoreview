// The document a page's notation lives in (ScorePage.vue): a source-less
// iframe, so the SVG's thousands of nodes sit outside the Files page's style
// tree.
//
// Why a separate document and not a shadow root: style invalidation crosses
// a shadow boundary. On a narrow viewport Nextcloud 34
// ships `.header-end:has(.local-unified-search--open) > :not(...)` (unified
// search, core/src/components/UnifiedSearch/UnifiedSearchLocalSearchBar.vue);
// with it, any state change of a button in the viewer - a menu opening,
// Play turning into Pause, a step of the seek slider - made Chrome recompute
// every element on the page, the shadow trees included. Measured with four
// pages at 4x CPU throttling on a phone viewport: 17,300 elements and
// 170-240 ms per change, menus taking 330-620 ms to open; with the notation
// in iframes 700 elements. A document of its own has its own style engine,
// whatever rule the host page carries next.
//
// What stays the same: the SVG nodes are ordinary DOM nodes, so the segment
// and notehead indexes (lib/svgIndex.js), the highlight classes and getBBox()
// work as before. What the iframe changes:
// - Events: `pointer-events: none` on the frame, so every click, tap, pinch
//   and wheel lands on the page element behind it.
// - Custom properties do not inherit into another document. The notation's
//   colours (lib/noteTheme.js, lib/highlightStyle.js) are copied onto the
//   frame's root with setVars().
// - getBoundingClientRect() inside the frame is relative to the frame. The
//   page only uses it there to order noteheads from top to bottom, which the
//   offset does not change.
// - Moving an iframe in the DOM reloads it with an empty document. The
//   viewer never moves a page (native fullscreen enlarges in place), but if
//   it happens, `onReset` rebuilds the content instead of leaving a blank
//   page.

import { SCORE_SVG_STYLE } from './scorePageSvgStyle.js'

// The frame's own document: no margin, transparent, so the page colour, the
// cursor and the own-part band behind it show through. `color-scheme` must match the frame element's (set in
// ScorePage.vue) - with a mismatch Chrome paints an opaque backdrop.
const FRAME_BASE_STYLE = `
html, body {
	margin: 0;
	padding: 0;
	overflow: hidden;
	background: transparent;
	color-scheme: normal;
}
`

/**
 * Creates the frame inside `host` and returns the element to put the SVG in.
 *
 * @param {HTMLElement} host the page's notation slot (ScorePage.vue)
 * @param {object} options
 * @param {string} options.title accessible name of the frame
 * @param {() => void} options.onReset called after the frame lost its
 *   document (see above); `root` already points at the new element
 * @return {{root: HTMLElement, setVars: (vars: object) => void, destroy: () => void}}
 */
export function createScoreFrame(host, { title, onReset }) {
	const frame = document.createElement('iframe')
	frame.className = 'score-page-frame'
	frame.title = title
	frame.tabIndex = -1
	host.append(frame)

	let vars = {}
	const handle = {
		root: null,
		setVars(next) {
			vars = next ?? {}
			const style = frame.contentDocument?.documentElement?.style
			if (!style) {
				return
			}
			for (const name of [...style]) {
				if (name.startsWith('--') && !(name in vars)) {
					style.removeProperty(name)
				}
			}
			for (const [name, value] of Object.entries(vars)) {
				style.setProperty(name, value)
			}
		},
		destroy() {
			frame.onload = null
			frame.remove()
			handle.root = null
		},
	}

	const build = () => {
		const doc = frame.contentDocument
		// open/write/close gives a settled document synchronously in every
		// browser; appending to the initial about:blank document can be
		// replaced by a second, asynchronous about:blank in older Firefox.
		doc.open()
		doc.write('<!DOCTYPE html><html><head></head><body></body></html>')
		doc.close()
		const style = doc.createElement('style')
		style.textContent = FRAME_BASE_STYLE + SCORE_SVG_STYLE
		doc.head.append(style)
		handle.root = doc.createElement('div')
		doc.body.append(handle.root)
		handle.setVars(vars)
	}

	const onLoad = () => {
		if (handle.root && handle.root.ownerDocument === frame.contentDocument && handle.root.isConnected) {
			return
		}
		build()
		onReset()
	}

	build()
	frame.onload = onLoad
	return handle
}
