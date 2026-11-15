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
import { scoreFrameWrapper } from './lib/scoreFrameWrapper.js'
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

// In a group of its own: Viewer then lists the scores of a shared folder and
// steps through them with its arrows - without a group it shows the one file
// only. Only the shown file gets a frame (lib/scoreFrameWrapper.js).
registerScoreHandler(scoreFrameWrapper(createFrame), { group: 'scoreview' })

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
