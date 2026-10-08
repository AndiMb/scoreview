import { showInfo } from '@nextcloud/dialogs'
import { translate } from '@nextcloud/l10n'
import { watch } from 'vue'

const t = (text, vars) => translate('scoreview', text, vars)

/** Ob der Hinweis zum gesperrten Bildschirm auf diesem Geraet schon kam. */
const LOCK_HINT_KEY = 'scoreview.lockHintShown'

/**
 * Sperrbildschirm und Medientasten (H5).
 *
 * Gemessen (M-A, Galaxy S23): Die Wiedergabe laeuft bei gesperrtem
 * Bildschirm weiter - in Chrome und in der Nextcloud-App. Eine Steuerung auf
 * dem Sperrbildschirm erscheint fuer Web Audio aber NICHT, auch nicht ueber
 * ein `<audio>` mit MediaStream, und die Kopfhoerertaste wirkt nicht. Die
 * Metadaten und Handler werden trotzdem gesetzt: Am Desktop greifen die
 * Medientasten, und ein Browser, der es kuenftig kann, zeigt es ohne
 * Aenderung hier.
 *
 * Wer am Handy waehrend der Wiedergabe sperrt, bekommt EINMAL je Geraet
 * den Hinweis auf den Uebe-Track: Der laeuft als Datei in jedem Player -
 * mit Steuerung auf dem Sperrbildschirm (D11).
 *
 * @param {object} deps
 * @param {() => boolean} deps.isPlaying
 * @param {() => {title: string, artist: string, album: string}} deps.metadata
 * @param {() => boolean} [deps.exportAvailable] ob es den Export gibt - sonst
 *   ergaebe der Hinweis keinen Sinn
 * @return {{setHandlers: (handlers: {play: () => void, pause: () => void, previous: () => void, next: () => void}) => void, dispose: () => void}}
 */
export function useMediaSession({ isPlaying, metadata, exportAvailable = () => false }) {
	const session = typeof navigator !== 'undefined' ? navigator.mediaSession : undefined
	let handlers = null
	let hiddenWhilePlaying = false

	function setHandlers(next) {
		handlers = next
		if (!session) {
			return
		}
		const map = {
			play: () => handlers?.play(),
			pause: () => handlers?.pause(),
			previoustrack: () => handlers?.previous(),
			nexttrack: () => handlers?.next(),
		}
		for (const [action, fn] of Object.entries(map)) {
			try {
				session.setActionHandler(action, fn)
			} catch {
				// Ein Browser, der eine Aktion nicht kennt, wirft - die
				// uebrigen sollen trotzdem gelten.
			}
		}
	}

	watch(isPlaying, (playing) => {
		if (!session) {
			return
		}
		if (playing && typeof MediaMetadata !== 'undefined') {
			const m = metadata()
			session.metadata = new MediaMetadata({ title: m.title, artist: m.artist, album: m.album })
		}
		session.playbackState = playing ? 'playing' : 'paused'
	})

	function onVisibility() {
		if (document.visibilityState === 'hidden') {
			hiddenWhilePlaying = isPlaying() && isCoarsePointer()
			return
		}
		if (!hiddenWhilePlaying || !exportAvailable()) {
			return
		}
		hiddenWhilePlaying = false
		try {
			if (window.localStorage.getItem(LOCK_HINT_KEY) === '1') {
				return
			}
			window.localStorage.setItem(LOCK_HINT_KEY, '1')
		} catch {
			// Ohne Speicher (privater Modus) lieber einmal je Sitzung zu oft.
		}
		showInfo(t('Playback continues while the screen is locked. For controls on the lock screen, save a practice track (Practice → Save as audio file).'), { timeout: 12000 })
	}

	if (typeof document !== 'undefined') {
		document.addEventListener('visibilitychange', onVisibility)
	}

	function dispose() {
		if (typeof document !== 'undefined') {
			document.removeEventListener('visibilitychange', onVisibility)
		}
		if (session) {
			session.metadata = null
			session.playbackState = 'none'
		}
	}

	return { setHandlers, dispose }
}

/**
 * @return {boolean} ein Geraet mit Finger statt Maus - dort wird gesperrt
 */
function isCoarsePointer() {
	return typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)')?.matches === true
}
