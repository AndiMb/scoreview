import { onBeforeUnmount, watch } from 'vue'

/**
 * Den Bildschirm wachhalten, solange `wanted()` gilt: waehrend der
 * Wiedergabe, im Aufführungsmodus oder beim Folgen einer Leitung.
 *
 * "Ein Display, das mitten im Satz ausgeht, macht die ganze uebrige Arbeit
 * wertlos." Im Aufführungsmodus erst recht: Dort laeuft oft gar keine
 * Wiedergabe, gesungen wird trotzdem. Deshalb haengt das nicht mehr an
 * `isPlaying` allein, sondern an EINER Bedingung, die der Viewer zusammensetzt.
 *
 * Die API ist nicht ueberall verfuegbar (Firefox ohne Flag, manche
 * iOS-Versionen), deshalb durchweg defensiv: ohne sie bleibt die App exakt so
 * nutzbar wie vorher, nur ohne Wachhalte-Effekt.
 *
 * @param {object} deps
 * @param {() => boolean} deps.wanted
 * @return {{release: () => void}}
 */
export function useWakeLock({ wanted }) {
	let sentinel = null
	// Eine laufende Anforderung - ohne das kaemen bei schnellem Umschalten
	// zwei Sentinels zurueck, und eines davon wuerde nie freigegeben.
	let pending = null
	// Der Viewer ist zu. `wanted()` kann danach noch true liefern (es liest
	// Zustand, der mit der Komponente nicht verschwindet) - ein Sentinel, das
	// erst nach dem Schliessen eintrifft, hielte den Bildschirm sonst ohne
	// sichtbaren Viewer wach, und niemand gaebe es mehr frei.
	let closed = false

	async function request() {
		if (closed || !navigator.wakeLock || sentinel || pending) {
			return
		}
		try {
			pending = navigator.wakeLock.request('screen')
			const erhalten = await pending
			pending = null
			if (closed || !wanted()) {
				// Waehrend des Wartens hat sich die Lage geaendert.
				erhalten.release?.()
				return
			}
			sentinel = erhalten
			// Das Sentinel wird vom Browser selbst geloest, wenn der Tab in den
			// Hintergrund wechselt - beim Zurueckkehren erneut anfordern, sonst
			// bliebe der Bildschirm nach einem Tab-Wechsel ungeschuetzt, obwohl
			// die Bedingung weiter gilt.
			sentinel.addEventListener?.('release', () => {
				sentinel = null
			})
		} catch (err) {
			pending = null
			// z.B. Permissions-Policy verbietet Wake Lock im umgebenden iframe.
			// eslint-disable-next-line no-console
			console.error('ScoreView: Bildschirm konnte nicht wachgehalten werden.', err)
		}
	}

	function release() {
		sentinel?.release?.()
		sentinel = null
	}

	function onVisibilityChange() {
		if (!closed && document.visibilityState === 'visible' && wanted()) {
			request()
		}
	}

	watch(wanted, (neu) => {
		if (neu) {
			request()
		} else {
			release()
		}
	}, { immediate: true })

	document.addEventListener('visibilitychange', onVisibilityChange)

	// Beim Schliessen des Viewers: freigeben und nicht mehr zuhoeren. Der
	// Watcher oben endet mit der Komponente von selbst, der Listener nicht.
	onBeforeUnmount(() => {
		closed = true
		document.removeEventListener('visibilitychange', onVisibilityChange)
		release()
	})

	return { release }
}
