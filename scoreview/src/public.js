// Entry for the public link page `/s/{token}` (PublicShareScriptsListener).
//
// That page keeps Nextcloud's own CSP, which forbids WebAssembly, so the
// viewer cannot run in it. It runs on the app's own page instead
// (/apps/scoreview/public/{token}/{fileId}, which carries ViewerPolicy), and
// this script only frames that page: it hands Nextcloud's Viewer a handler
// whose component is an iframe. Therefore nothing of the viewer UI is imported
// here - the bundle stays small enough to load on every share page.
import { getSharingToken } from '@nextcloud/sharing/public'
import { translate } from './l10n.js'
import { publicFrameUrl } from './lib/publicFrame.js'
import { registerScoreFileAction, registerScoreHandler } from './lib/scoreHandler.js'

import './publicPath.js'

// Single-argument wrapper, the call pattern tools/l10n.mjs looks for.
const t = (text, vars) => translate('scoreview', text, vars)

// `allow` hands the page below the microphone (recording, intonation, follow):
// a frame may only use what its parent page allows (AddFeaturePolicyListener)
// and what the iframe attribute passes on. `fullscreen` and `autoplay` are
// for the viewer's fullscreen mode and for starting playback.
const FRAME_ALLOW = 'microphone; fullscreen; autoplay'
const FRAME_STYLE = 'width:100%;height:100%;border:0'

/**
 * @param {number|string} fileId The score's file id
 * @param {string} [title] Name for assistive technology (the app name is not
 *   translated)
 * @return {HTMLIFrameElement}
 */
function createFrame(fileId, title = 'ScoreView') {
	const frame = document.createElement('iframe')
	frame.src = publicFrameUrl(getSharingToken(), fileId)
	frame.allow = FRAME_ALLOW
	frame.allowFullscreen = true
	frame.title = title
	frame.style.cssText = FRAME_STYLE
	return frame
}

// A plain-object component without a template, like ScoreViewerWrapper in
// viewer.js: Viewer bundles its own copy of Vue, which cannot render a
// template compiled against ours.
//
// render() returns null - a comment placeholder - and the iframe is inserted
// next to it from plain DOM. That is also what viewer.js does for its inner
// app, and it avoids importing Vue just for h(): this bundle loads on every
// share page and a second Vue runtime would be most of it.
const ScoreFrameWrapper = {
	name: 'ScoreFrameWrapper',

	props: {
		fileid: {
			type: [Number, String],
			required: true,
		},
		// Passed by Viewer as :loaded.sync; without update:loaded its spinner
		// would stay on top of the frame for good.
		loaded: {
			type: Boolean,
			default: false,
		},
	},

	emits: ['update:loaded'],

	render() {
		return null
	},

	mounted() {
		this.mountFrame()
		// At once: the framed page shows its own conversion and error states,
		// so Viewer's generic spinner would only cover them.
		this.$emit('update:loaded', true)
	},

	// beforeDestroy (Vue 2) and beforeUnmount (Vue 3): only the one of the
	// running Vue exists for it; the other name is ignored.
	beforeDestroy() {
		this.unmountFrame()
	},
	beforeUnmount() {
		this.unmountFrame()
	},

	watch: {
		fileid() {
			this.unmountFrame()
			this.mountFrame()
		},
	},

	methods: {
		mountFrame() {
			// Next to the placeholder, in its real parent: this.$el is a comment
			// node and cannot take children, and its own parent belongs to
			// Viewer's Vue, which never sees a node it did not create.
			const parent = this.$el?.parentNode
			if (!parent) {
				return
			}
			this.frame = createFrame(this.fileid)
			parent.insertBefore(this.frame, this.$el.nextSibling)
		},
		unmountFrame() {
			this.frame?.remove()
			this.frame = null
		},
	},
}

registerScoreHandler(ScoreFrameWrapper)

// ---------------------------------------------------------------------------
// The file action on the extension (E6)
// ---------------------------------------------------------------------------
// For a `.mscz` that Viewer does not open because its mimetype is not
// registered: the same frame, in a modal of our own made of plain DOM (no Vue
// app to mount, so nothing of the viewer bundle is needed for it).

let modalEl = null
let modalKeydown = null

function closeModal() {
	if (modalKeydown) {
		document.removeEventListener('keydown', modalKeydown, true)
		modalKeydown = null
	}
	modalEl?.remove()
	modalEl = null
}

function openModal(node) {
	// A second modal on top of the first would be a state without a way out.
	closeModal()

	const frame = createFrame(node.fileid, node.basename ?? 'ScoreView')
	frame.style.flex = '1'

	const close = document.createElement('button')
	close.type = 'button'
	close.textContent = t('Close')
	close.style.cssText = 'align-self:flex-end;margin:4px;padding:6px 14px;cursor:pointer'
	close.addEventListener('click', closeModal)

	modalEl = document.createElement('div')
	modalEl.setAttribute('role', 'dialog')
	modalEl.setAttribute('aria-modal', 'true')
	modalEl.setAttribute('aria-label', frame.title)
	modalEl.style.cssText = 'position:fixed;inset:0;z-index:10000;display:flex;flex-direction:column;'
		+ 'background:var(--color-main-background,#fff)'
	modalEl.append(close, frame)
	document.body.appendChild(modalEl)
	close.focus()

	modalKeydown = (event) => {
		if (event.key === 'Escape') {
			event.stopPropagation()
			closeModal()
		}
	}
	document.addEventListener('keydown', modalKeydown, true)
}

registerScoreFileAction(() => t('Open in ScoreView'), openModal)
