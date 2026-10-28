import axios from '@nextcloud/axios'
import { translate } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import { computed, getCurrentScope, onScopeDispose, ref, watch } from 'vue'
import { createPracticeMeter, localDay, MAX_REPORT_SECONDS, REPORT_INTERVAL_MS, summarize } from '../lib/practiceLog.js'

const t = (text, vars) => translate('scoreview', text, vars)

/**
 * The practice log (docs/architecture.md E20): measures practice time,
 * reports it, and holds what the panel shows.
 *
 * **Measuring** runs on transitions, not on a clock that ticks during
 * playback: `active()` is watched, and while it holds, one timer per
 * REPORT_INTERVAL_MS reports the minute. Nothing runs while the score is
 * silent - the viewer's frame loop sleeps then, and so does this.
 *
 * **Reporting** goes to the score the time was spent on: a setlist can
 * change the piece mid-minute, and the minute belongs to the old one. On
 * leaving the page the rest is sent with `keepalive`, which outlives the
 * page; before that, hiding the page (switching apps, locking the phone)
 * already reports through the normal way. What can be lost is at most the
 * time between hiding and closing.
 *
 * @param {object} deps
 * @param {() => number|string|null} deps.fileId
 * @param {() => boolean} deps.enabled switch `feature_practice_log`, and online
 * @param {() => boolean} deps.active the score sounds, or the microphone
 *   records for the singer
 * @param {() => Date} [deps.now]
 * @return {object}
 */
export function usePracticeLog({ fileId, enabled, active, now = () => new Date() }) {
	const days = ref({})
	const activeDays = ref([])
	const goal = ref(null)
	const loaded = ref(false)
	const error = ref('')
	const savingGoal = ref(false)

	const meter = createPracticeMeter()
	// The score the meter is collecting for - fixed when collecting starts.
	let meterFile = null
	let timer = null
	let generation = 0

	const url = (id, suffix = 'practice-log') => generateUrl(`/apps/scoreview/api/scores/{fileId}/${suffix}`, { fileId: id })

	const summary = computed(() => summarize({
		days: days.value,
		activeDays: activeDays.value,
		today: localDay(now()),
		goalMinutes: goal.value?.minutesPerWeek ?? null,
	}))

	async function load() {
		const mine = ++generation
		const id = fileId()
		if (!enabled() || id === null || id === undefined) {
			return
		}
		try {
			const res = await axios.get(url(id))
			if (mine !== generation) {
				return
			}
			// PHP sends an empty map as a list.
			days.value = Array.isArray(res.data.days) ? {} : { ...res.data.days }
			activeDays.value = res.data.activeDays ?? []
			goal.value = res.data.goal ?? null
			loaded.value = true
		} catch (err) {
			// A side feature: its failure must not touch the score.
			// eslint-disable-next-line no-console
			console.error('ScoreView: could not load the practice log.', err)
		}
	}

	/**
	 * Sends what the meter holds.
	 *
	 * @param {{leaving?: boolean}} [options] leaving: the page goes away -
	 *   `keepalive`, and no answer is waited for
	 */
	async function flush({ leaving = false } = {}) {
		meter.mark(Date.now(), active() && enabled())
		const target = meterFile
		const day = localDay(now())
		let seconds = meter.take(MAX_REPORT_SECONDS)
		while (seconds > 0 && target !== null) {
			// The local copy first: the panel shows the minute at once, and a
			// failed report is not shown as practised twice later.
			if (String(target) === String(fileId())) {
				days.value = { ...days.value, [day]: (days.value[day] ?? 0) + seconds }
				if (!activeDays.value.includes(day)) {
					activeDays.value = [...activeDays.value, day]
				}
			}
			const body = { day, seconds }
			if (leaving) {
				sendKeepalive(url(target), body)
			} else {
				try {
					await axios.post(url(target), body)
				} catch (err) {
					// eslint-disable-next-line no-console
					console.warn('ScoreView: a practice report was lost.', err)
				}
			}
			seconds = meter.take(MAX_REPORT_SECONDS)
		}
	}

	function startTimer() {
		if (timer === null) {
			timer = setInterval(() => flush(), REPORT_INTERVAL_MS)
		}
	}

	function stopTimer() {
		if (timer !== null) {
			clearInterval(timer)
			timer = null
		}
	}

	watch(() => active() && enabled(), (on) => {
		if (on) {
			meterFile = fileId()
			meter.mark(Date.now(), true)
			startTimer()
		} else {
			stopTimer()
			flush()
		}
	}, { immediate: true })

	// A new piece: report the old one's time to the old one, then start over.
	watch(fileId, (next, previous) => {
		if (previous !== null && previous !== undefined) {
			flush()
		}
		reset()
		meterFile = active() && enabled() ? next : null
		meter.mark(Date.now(), active() && enabled())
		load()
	}, { immediate: true })

	/**
	 * Leaders set the weekly goal; the server checks the role (E9).
	 *
	 * @param {number} minutesPerWeek 0 removes it
	 */
	async function setGoal(minutesPerWeek) {
		const id = fileId()
		error.value = ''
		savingGoal.value = true
		try {
			const res = await axios.put(url(id, 'practice-goal'), { minutesPerWeek })
			if (String(id) === String(fileId())) {
				goal.value = res.data.minutesPerWeek === null
					? null
					: { minutesPerWeek: res.data.minutesPerWeek, setBy: goal.value?.setBy ?? null }
				// The name of the one who set it comes with the next load.
				load()
			}
		} catch (err) {
			error.value = err?.response?.data?.error || t('The practice goal could not be saved.')
		} finally {
			savingGoal.value = false
		}
	}

	const onPageHide = () => flush({ leaving: true })
	const onVisibility = () => {
		if (document.visibilityState === 'hidden') {
			flush()
		}
	}
	if (typeof window !== 'undefined') {
		window.addEventListener('pagehide', onPageHide)
		document.addEventListener('visibilitychange', onVisibility)
	}

	function reset() {
		generation++
		days.value = {}
		activeDays.value = []
		goal.value = null
		loaded.value = false
		error.value = ''
	}

	function destroy() {
		stopTimer()
		flush({ leaving: true })
		if (typeof window !== 'undefined') {
			window.removeEventListener('pagehide', onPageHide)
			document.removeEventListener('visibilitychange', onVisibility)
		}
	}

	if (getCurrentScope()) {
		onScopeDispose(destroy)
	}

	return { days, activeDays, goal, loaded, error, savingGoal, summary, load, flush, setGoal, reset, destroy }
}

/**
 * A report that outlives the page. `fetch` with `keepalive` rather than
 * `sendBeacon`: the route wants the request token in a header, and a beacon
 * cannot set one.
 *
 * @param {string} target
 * @param {object} body
 */
function sendKeepalive(target, body) {
	try {
		fetch(target, {
			method: 'POST',
			keepalive: true,
			credentials: 'same-origin',
			headers: {
				'Content-Type': 'application/json',
				// Nextcloud puts the token on <head> for every page with a
				// session. The mobile apps' token pages have none - their
				// last report is lost on closing, the earlier ones are not
				// (they go out on `visibilitychange` through axios).
				requesttoken: document.head?.dataset?.requesttoken ?? '',
			},
			body: JSON.stringify(body),
		}).catch(() => {})
	} catch {
		// Leaving the page - nothing to tell anyone.
	}
}
