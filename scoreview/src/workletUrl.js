import { generateFilePath } from '@nextcloud/router'
import { withAppVersion } from './assetVersion.js'

// spessasynth_lib's AudioWorklet processor runs in its own
// AudioWorkletGlobalScope and is loaded as a file of its own via
// addModule(url), not bundled - webpack.config.js copies it next to the
// bundles. With the app version, or after an update it would come from the
// browser cache (assetVersion.js).
//
// Its own module rather than part of lib/player.js: the offline page needs
// the address to store it (useOffline.js), and importing it from the
// player would pull spessasynth into every bundle that only wants the URL.
export const WORKLET_URL = withAppVersion(generateFilePath('scoreview', 'js', 'spessasynth_processor.min.js'), SCOREVIEW_APP_VERSION)
