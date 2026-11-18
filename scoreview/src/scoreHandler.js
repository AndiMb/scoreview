// The pieces of the Files entry (viewer.js) and the public-share entry
// (public.js) that must not drift apart: how a handler gets registered with
// Nextcloud's Viewer, and the file action on the extension (E6). What each
// entry opens - the in-page viewer or a frame - is passed in.
//
// Next to the entries, not in lib/: it talks to Nextcloud (@nextcloud/files,
// OCA.Viewer), and lib/ stays free of Nextcloud and the DOM.
import { DefaultType, registerFileAction } from '@nextcloud/files'
import { MSCZ_MIME, needsOwnFileAction } from './lib/scoreFile.js'

/**
 * Guarded because `OCA.Viewer` may be missing: Viewer app disabled, or its
 * script loaded after ours. The line runs in the module body, so a TypeError
 * would take the whole entry down with it - including the file action, which
 * exists precisely for instances where the handler does not open the file.
 *
 * @param {object} component A plain render() component - Viewer bundles its own
 *   Vue, so an SFC template compiled against ours would crash there
 * @param {object} [options]
 * @param {string} [options.group] Viewer's handler group: navigation through
 *   the folder, with hidden neighbours mounted for preloading
 */
export function registerScoreHandler(component, { group } = {}) {
	if (typeof OCA !== 'undefined' && OCA?.Viewer?.registerHandler) {
		OCA.Viewer.registerHandler({
			id: 'scoreview',
			mimes: [MSCZ_MIME],
			component,
			// Viewer steps through a folder only for a grouped handler - and
			// then also mounts the neighbours hidden, which a component has to
			// be built for (lib/scoreFrameWrapper.js). The Files entry keeps
			// none: its component is the whole viewer.
			...(group ? { group } : {}),
		})
	}
}

// MDI `music-clef-treble` (Apache-2.0), as a string: registerFileAction wants
// finished SVG, not a Vue component.
export const CLEF_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M13 11V7.5L15.2 5.29C16 4.5 16.15 3.24 15.59 2.26C15.14 1.47 14.32 1 13.45 1C13.24 1 13 1.03 12.81 1.09C11.73 1.38 11 2.38 11 3.5V6.74L7.86 9.91C6.2 11.6 5.7 14.13 6.61 16.34C7.38 18.24 9.06 19.55 11 19.89V20.5C11 20.76 10.77 21 10.5 21H9V23H10.5C11.85 23 13 21.89 13 20.5V20C15.03 20 17.16 18.08 17.16 15.25C17.16 12.95 15.24 11 13 11M13 3.5C13 3.27 13.11 3.09 13.32 3.03C13.54 2.97 13.77 3.06 13.88 3.26C14 3.46 13.96 3.71 13.8 3.87L13 4.73V3.5M11 11.5C10.03 12.14 9.3 13.24 9.04 14.26L11 14.78V17.83C9.87 17.53 8.9 16.71 8.43 15.57C7.84 14.11 8.16 12.45 9.26 11.33L11 9.5V11.5M13 18V12.94C14.17 12.94 15.18 14.04 15.18 15.25C15.18 17 13.91 18 13 18Z" /></svg>'

/**
 * Registers the "open in ScoreView" action for a `.mscz` that Viewer does not
 * open (extension fits, mimetype does not).
 *
 * Both lists are filled unconditionally: which of them the server's Files app
 * reads cannot be told from here (`window._nc_files_scope.v4_0` exists as soon
 * as @nextcloud/files v4 is imported, whether or not Files ever looks at it).
 * No version reads both, so there is still one menu entry (measured on
 * Nextcloud 34: only `_nc_files_scope.v4_0` is read; the array is not).
 *
 * @param {() => string} displayName Label, as a function so it is translated when shown
 * @param {(node: object) => ?Promise<?boolean>} open Opens the score of a node
 */
export function registerScoreFileAction(displayName, open) {
	const action = {
		id: 'scoreview-open',
		displayName,
		iconSvgInline: () => CLEF_ICON,
		// A click on the file should open it, not unfold the details.
		default: DefaultType.DEFAULT,
		order: -10,
	}
	const run = async (node) => {
		if (!node?.fileid) {
			return false
		}
		open(node)
		// null = no result to report; `true` would make Files show a success
		// toast although only a window has opened.
		return null
	}

	registerFileAction({
		...action,
		enabled: ({ nodes }) => nodes.length === 1 && needsOwnFileAction(nodes[0]),
		exec: ({ nodes }) => run(nodes[0]),
	})
	// Older versions: global array, callbacks called with (nodes, view).
	window._nc_fileactions = window._nc_fileactions || []
	window._nc_fileactions.push({
		...action,
		enabled: (nodes) => nodes.length === 1 && needsOwnFileAction(nodes[0]),
		exec: (node) => run(node),
	})
}
