import axios from '@nextcloud/axios'
import { translate } from '@nextcloud/l10n'
import { listen } from '@nextcloud/notify_push'
import { generateUrl } from '@nextcloud/router'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { initialFollowState, reduce } from '../lib/followState.js'
import { emptyQueue, enqueue, isBusy, recordSend, sendDelay, settle, takeNext } from '../lib/leaderQueue.js'

/**
 * Abfrageabstand ohne laufende Sitzung, im Hintergrund und neben Push
 * (E10): „laeuft eine Sitzung?" - eine Anfrage alle 15 s je offenem
 * Viewer. Nur waehrend einer Sitzung und bei sichtbarer Seite wird im
 * Takt von `pollMs` gefragt; gemessene Kosten: ~50 ms CPU je
 * Geraet und Abfrage).
 */
export const IDLE_POLL_MS = 15000
/**
 * Lebenszeichen der Leitung. Ohne eines gilt eine Sitzung nach 30 min als
 * beendet - 60 s lassen also reichlich Luft fuer ein Funkloch.
 */
export const HEARTBEAT_MS = 60000
/**
 * Laenger wartet eine Abfrage nicht. Ein haengendes Netz soll als „getrennt"
 * sichtbar werden, nicht als eine Anzeige, die still stehen bleibt.
 */
const REQUEST_TIMEOUT_MS = 5000

/** Der Name des Ereignisses, siehe Service\PushNotifier::EVENT. */
const PUSH_EVENT = 'scoreview_follow'

// Push wird EINMAL je Seite eingerichtet: `listen()` aus @nextcloud/notify_push
// kennt kein Abmelden, jede weitere Anmeldung haengte einen weiteren
// Rueckruf an dieselbe Verbindung. Die Viewer-Instanzen melden sich stattdessen
// hier an und ab.
const pushSubscribers = new Set()
let pushListening = null

/**
 * @return {boolean} ob der Server Push anbietet (Capabilities von notify_push)
 */
function ensurePushListener() {
	if (pushListening === null) {
		try {
			pushListening = listen(PUSH_EVENT, (type, body) => {
				for (const subscriber of pushSubscribers) {
					subscriber(body)
				}
			}) === true
		} catch {
			pushListening = false
		}
	}
	return pushListening
}

/**
 * Ob die Push-Verbindung gerade steht. `listen()` sagt nur, ob der Server
 * Push ANBIETET, nicht ob die Verbindung zustande kam - ist der Dienst hinter
 * einem falsch eingerichteten Proxy unerreichbar, meldete es trotzdem true.
 * Die Bibliothek fuehrt ihren Verbindungszustand in globalen Variablen, eine
 * andere Auskunft gibt sie nicht; fehlen die, gilt Push als nicht da, und das
 * Geraet fragt im vollen Takt ab (schaltet selbststaendig um).
 *
 * @return {boolean}
 */
function pushConnected() {
	return typeof window !== 'undefined'
		&& window._notify_push_ready === true
		&& window._notify_push_ws !== null
		&& typeof window._notify_push_ws === 'object'
}

/**
 * „Folgt mir" im Viewer (C): Transport, Anzeige und das Weiterreichen der
 * Aktionen an Seek, Loop und Anfangston. WAS bei einem neuen Stand zu tun ist,
 * entscheidet lib/followState.js; hier wird es nur ausgefuehrt.
 *
 * **Transport (E10):**
 * - Ohne Push fragt das Geraet `GET …/follow?since=<version>` - waehrend einer
 *   Sitzung im Takt von `pollMs` (Vorgabe 800 ms), sonst alle 15 s. Die
 *   Antwort ist fast immer ein 204, das der Server aus dem Cache beantwortet.
 * - Mit `notify_push` meldet sich das Geraet an (`/join`) und fragt nur noch
 *   auf ein Ereignis hin, dazu alle 15 s als Netz unter dem Seil.
 * - Auf der eigenstaendigen Seite der Mobil-Apps immer abfragen: Die
 *   Anmeldung bei notify_push verlangt eine Sitzung, die das
 *   Direct-Editing-Token nicht hergibt (gemessen, E8).
 * - Im Hintergrund (Page Visibility) nur alle 15 s - wer die Noten nicht
 *   sieht, braucht keinen Sprung in 800 ms; beim Zurueckkehren wird sofort
 *   gefragt.
 *
 * Mit abgeschalteter Funktion (`feature_follow_session`) fragt der Viewer gar
 * nicht erst; ein 404 vom Server (Schalter inzwischen aus, Zugriff
 * entzogen) beendet das Fragen ebenso.
 *
 * @param {object} deps
 * @param {() => (number|string)} deps.fileId
 * @param {() => boolean} deps.enabled Schalter der Administration
 * @param {() => boolean} deps.standalone eigenstaendige Seite der Mobil-Apps
 * @param {() => boolean} deps.ready ob Notenbild und Zeitquelle stehen
 * @param {(action: string) => boolean} deps.permitted interactionPolicy
 * @param {(measure: number) => ?number} deps.seekToMeasure springt, gibt die Zielzeit zurueck
 * @param {(from: number, to: number) => void} deps.setLoop
 * @param {() => void} deps.clearLoop
 * @param {() => void} deps.playTone Anfangston meiner Stimme (useStartTone.startToneFor)
 * @param {() => ?{measure: number, mark: ?string}} deps.currentPosition fuer die Leitung
 * @param {() => ?{from: number, to: number}} deps.currentLoop fuer die Leitung
 * @return {object}
 */
export function useFollowSession({ fileId, enabled, standalone, ready, permitted, seekToMeasure, setLoop, clearLoop, playTone, currentPosition, currentLoop }) {
	const t = (text) => translate('scoreview', text)

	const local = shallowRef(initialFollowState())
	const connected = ref(true)
	// Der Server hat 404 geantwortet: Funktion aus oder kein Zugriff mehr.
	const disabled = ref(false)
	const error = ref('')
	const busy = ref(false)
	const pollMs = ref(800)
	const visible = ref(typeof document === 'undefined' || document.visibilityState !== 'hidden')
	const pushJoined = ref(false)

	const active = computed(() => local.value.active)
	const mine = computed(() => local.value.active && local.value.mine)
	const following = computed(() => local.value.active && !local.value.mine && local.value.following)
	const leaderName = computed(() => local.value.leaderName)

	let timer = null
	let heartbeatTimer = null
	let inflight = false
	// Jede Antwort der Leitungs-Aktionen zaehlt die Epoche hoch. Eine Abfrage,
	// die davor losging, traegt einen aelteren Stand und wird verworfen -
	// sonst blinkte eine gerade gestartete Sitzung kurz als „beendet".
	let epoch = 0
	// Gehoert zu einer anderen Partitur, sobald die Datei wechselt.
	let generation = 0
	let pendingSeek = null
	let pendingLoop = null

	/**
	 * Die Andockstelle fuer das Mitverfolgen per Mikrofon: Ein Sprung der Leitung ist dort die neue Stelle, an der das
	 * Mitverfolgen fortsetzt - sonst widersprechen sich die beiden Quellen
	 * still. Bis das Mitverfolgen gebaut ist, tut sie nichts; sie steht
	 * trotzdem schon hier, damit der Sprung sie heute schon aufruft und der
	 * Anschluss spaeter keine Aenderung an diesem Ablauf braucht.
	 */
	const follower = {
		// eslint-disable-next-line no-unused-vars
		relocate(timeMs) {},
	}

	const url = (suffix = '') => generateUrl(`/apps/scoreview/api/scores/{fileId}/follow${suffix}`, { fileId: fileId() })

	function interval() {
		if (!visible.value || !local.value.active) {
			return IDLE_POLL_MS
		}
		if (pushJoined.value && pushConnected()) {
			return IDLE_POLL_MS
		}
		return pollMs.value
	}

	function schedule(delay = interval()) {
		clearTimeout(timer)
		timer = null
		if (disabled.value || !enabled()) {
			return
		}
		// Unsichtbar und ohne laufende Sitzung gibt es nichts zu verfolgen -
		// nur zu entdecken, und das erledigt der Abruf beim Zurueckkehren
		// (onVisibilityChange). Mit Sitzung bleibt der langsame Takt, damit
		// ein gesperrter Bildschirm die Stelle nicht ganz verliert.
		if (!visible.value && !local.value.active) {
			return
		}
		timer = setTimeout(poll, delay)
	}

	function takePollMs(value) {
		const n = Number(value)
		if (Number.isFinite(n) && n >= 100) {
			pollMs.value = n
		}
	}

	async function poll() {
		if (inflight || disabled.value || !enabled()) {
			return
		}
		inflight = true
		const gen = generation
		const startedEpoch = epoch
		try {
			const res = await axios.get(url(), {
				params: { since: local.value.version, ...(pushJoined.value ? { push: 1 } : {}) },
				timeout: REQUEST_TIMEOUT_MS,
			})
			if (gen !== generation) {
				return
			}
			connected.value = true
			if (res.status === 204) {
				takePollMs(res.headers?.['x-scoreview-poll-ms'])
			} else if (startedEpoch === epoch) {
				apply(res.data)
			}
		} catch (err) {
			if (gen !== generation) {
				return
			}
			if (err?.response?.status === 404) {
				disabled.value = true
				local.value = initialFollowState()
				return
			}
			connected.value = false
		} finally {
			if (gen === generation) {
				inflight = false
				schedule()
			}
		}
	}

	/**
	 * Eine Antwort des Servers (Abfrage oder eigene Leitungs-Aktion) auf den
	 * lokalen Stand anwenden und die Aktionen ausfuehren.
	 *
	 * @param {object} body Antwort von FollowController
	 */
	function apply(body) {
		if (!body || typeof body !== 'object') {
			return
		}
		takePollMs(body.pollMs)
		const wasActive = local.value.active
		const session = local.value.session
		const result = reduce(local.value, { type: 'state', body })
		local.value = result.local
		execute(result.actions)
		if (local.value.active && (!wasActive || local.value.session !== session)) {
			join()
		}
		if (!local.value.active) {
			pushJoined.value = false
		}
		updateHeartbeat()
	}

	function execute(actions) {
		for (const action of actions) {
			switch (action.type) {
				case 'seek':
				// Die Policy entscheidet, ob ein Sprung der Leitung wirkt - auch
				// im Aufführungsmodus, solange gefolgt wird.
					if (!permitted('followJump')) {
						break
					}
					if (!ready()) {
					// Die Partitur laedt noch (erst waehrend der Sitzung
					// geoeffnet) - der Sprung kommt, sobald sie steht.
						pendingSeek = action
						break
					}
					jump(action)
					break
				case 'setLoop':
				// Der Loop der Leitung ist wie ihr Sprung eine Aenderung von
				// aussen - dieselbe Policy wie beim Sprung, damit ein Geraet,
				// das nicht (mehr) folgt, sich nichts ueberschreiben laesst.
					if (!permitted('followJump')) {
						break
					}
					if (!ready()) {
						pendingLoop = action
						break
					}
					setLoop(action.from, action.to)
					break
				case 'clearLoop':
					pendingLoop = null
					clearLoop()
					break
				case 'tone':
					playTone()
					break
				default:
				// 'ended', 'leaderChanged': Die Anzeige liest den Zustand
				// selbst, hier ist nichts auszufuehren.
					break
			}
		}
	}

	function jump(action) {
		pendingSeek = null
		const timeMs = seekToMeasure(action.measure)
		if (timeMs !== null && timeMs !== undefined) {
			follower.relocate(timeMs)
		}
	}

	/**
	 * Fuer Push anmelden - nur im Browser mit Sitzung und nur, wenn der Server
	 * Push anbietet. Schlaegt es fehl, bleibt es beim Abfragen im vollen Takt.
	 */
	async function join() {
		pushJoined.value = false
		if (standalone() || !ensurePushListener()) {
			return
		}
		const gen = generation
		try {
			const res = await axios.post(url('/join'))
			if (gen === generation) {
				pushJoined.value = res.data?.push === true
			}
		} catch {
			// Ohne Anmeldung eben ohne Push - das Abfragen laeuft ohnehin.
		}
	}

	function onPush(body) {
		if (!body || String(body.fileId) !== String(fileId()) || String(body.version) === local.value.version) {
			return
		}
		schedule(0)
	}

	/**
	 * Eigene Bedienung melden (Seek, Takteingabe, Notenklick, Loop …) - loest
	 * das Folgen, siehe followState.UNFOLLOWING. Blaettern und Zoom melden
	 * ist erlaubt und aendert nichts.
	 *
	 * @param {string} kind
	 */
	function noteNavigation(kind) {
		local.value = reduce(local.value, { type: 'navigate', kind }).local
	}

	/** „Zurueck zur Leitung". */
	function resume() {
		const result = reduce(local.value, { type: 'resume' })
		local.value = result.local
		execute(result.actions)
	}

	// --- Leitung ------------------------------------------------------------

	function message(err, fallback) {
		return err?.response?.data?.error ?? fallback
	}

	// Leitungs-Aktionen laufen streng nacheinander und nach „der letzte Tipp
	// gewinnt" (lib/leaderQueue.js). Knoepfe, die waehrend einer Anfrage
	// gesperrt sind, verloeren den zweiten Tipp binnen einer Antwortzeit -
	// „B, nein C" kaeme dann als B bei allen an.
	let queue = emptyQueue()
	let sentAt = []
	let sendTimer = null

	const FALLBACK = {
		start: () => t('Could not start the session.'),
		end: () => t('Could not end the session.'),
		position: () => t('Could not send the position.'),
		loop: () => t('Could not send the loop.'),
		tone: () => t('Could not send the starting note.'),
	}

	/**
	 * @param {object} action siehe leaderQueue.enqueue
	 * @return {Promise<boolean>} ob der Schritt, der den Tipp trug, ankam
	 */
	function submit(action) {
		return new Promise((resolve) => {
			queue = enqueue(queue, action, resolve)
			busy.value = true
			pump()
		})
	}

	function pump() {
		if (queue.inflight !== null || sendTimer !== null) {
			return
		}
		const delay = sendDelay(sentAt, Date.now())
		if (delay > 0) {
			// Budget erschoepft: warten - und bis dahin weitere Tipps
			// einsammeln, statt am Ratenlimit des Servers abzuprallen.
			sendTimer = setTimeout(() => {
				sendTimer = null
				pump()
			}, delay)
			return
		}
		const next = takeNext(queue)
		queue = next.queue
		busy.value = isBusy(queue)
		if (next.step !== null) {
			sentAt = recordSend(sentAt, Date.now())
			run(next.step)
		}
	}

	async function run(step) {
		error.value = ''
		const gen = generation
		let ok = false
		try {
			const res = await axios({ method: step.kind === 'session' ? step.method : 'patch', url: url(), data: step.data, timeout: REQUEST_TIMEOUT_MS })
			if (gen === generation) {
				epoch++
				connected.value = true
				apply(res.data)
			}
			ok = true
		} catch (err) {
			if (gen === generation) {
				error.value = message(err, FALLBACK[step.last]())
			}
		}
		for (const resolve of step.waiters) {
			resolve(ok)
		}
		if (gen !== generation) {
			return
		}
		// Was waehrenddessen getippt wurde, geht jetzt raus - schon verschmolzen
		// zu einem Schritt, der neueste Stand je Art.
		queue = settle(queue)
		busy.value = isBusy(queue)
		pump()
	}

	/**
	 * Sitzung starten oder uebernehmen. Die eigene Stelle geht
	 * gleich mit - sonst stuenden alle nach dem Start dort, wo jede gerade war.
	 */
	function start() {
		return submit({ type: 'start', data: currentPosition() ?? {} })
	}

	function end() {
		return submit({ type: 'end' })
	}

	/**
	 * Die Stelle wird beim Tipp festgehalten, nicht erst beim Senden: Gemeint
	 * ist die Stelle, auf die die Leitung in diesem Moment zeigt.
	 *
	 * @param {?{measure: number, mark: ?string}} [position] ohne Angabe die eigene Stelle
	 */
	function sendPosition(position = null) {
		const target = position ?? currentPosition()
		if (!target) {
			return Promise.resolve(false)
		}
		return submit({ type: 'position', position: target })
	}

	function sendLoop() {
		return submit({ type: 'loop', loop: currentLoop() ?? null })
	}

	function sendTone() {
		return submit({ type: 'tone' })
	}

	function updateHeartbeat() {
		const wanted = mine.value
		if (wanted && heartbeatTimer === null) {
			heartbeatTimer = setInterval(() => {
				axios.patch(url(), { heartbeat: true }, { timeout: REQUEST_TIMEOUT_MS }).catch(() => {
					// Ein verpasstes Lebenszeichen ist kein Fehler: 30 min Luft.
				})
			}, HEARTBEAT_MS)
		} else if (!wanted && heartbeatTimer !== null) {
			clearInterval(heartbeatTimer)
			heartbeatTimer = null
		}
	}

	// --- Lebenszyklus -------------------------------------------------------

	function onVisibilityChange() {
		visible.value = document.visibilityState !== 'hidden'
		if (visible.value) {
			// Zurueck im Vordergrund: gleich fragen, nicht erst nach 15 s.
			schedule(0)
		}
	}

	function stop() {
		generation++
		clearTimeout(timer)
		timer = null
		inflight = false
		pendingSeek = null
		pendingLoop = null
		// Wartende Leitungs-Tipps gehoeren zur alten Partitur - verwerfen.
		// Wer darauf wartet, erfaehrt „nicht angekommen"; die laufende
		// Anfrage meldet sich selbst, sieht aber die neue Generation.
		for (const step of queue.pending) {
			for (const resolve of step.waiters) {
				resolve(false)
			}
		}
		queue = emptyQueue()
		clearTimeout(sendTimer)
		sendTimer = null
		busy.value = false
		if (heartbeatTimer !== null) {
			clearInterval(heartbeatTimer)
			heartbeatTimer = null
		}
	}

	/** Fuer eine andere Partitur von vorn - aufgerufen beim Dateiwechsel. */
	function restart() {
		stop()
		local.value = initialFollowState()
		connected.value = true
		disabled.value = false
		error.value = ''
		pushJoined.value = false
		if (enabled()) {
			schedule(0)
		}
	}

	watch(ready, (isReady) => {
		if (!isReady) {
			return
		}
		if (pendingSeek && permitted('followJump')) {
			jump(pendingSeek)
		}
		if (pendingLoop) {
			const loop = pendingLoop
			pendingLoop = null
			// Zwischen Eintreffen und fertig geladener Partitur kann das
			// Folgen geendet haben - dann gilt der Loop nicht mehr.
			if (permitted('followJump')) {
				setLoop(loop.from, loop.to)
			}
		}
	})

	pushSubscribers.add(onPush)
	if (typeof document !== 'undefined') {
		document.addEventListener('visibilitychange', onVisibilityChange)
	}

	onBeforeUnmount(() => {
		stop()
		pushSubscribers.delete(onPush)
		document.removeEventListener('visibilitychange', onVisibilityChange)
	})

	return {
		active,
		mine,
		following,
		leaderName,
		connected,
		disabled,
		error,
		busy,
		pushJoined,
		follower,
		noteNavigation,
		resume,
		start,
		end,
		sendPosition,
		sendLoop,
		sendTone,
		restart,
		stop,
	}
}
