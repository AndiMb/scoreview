// The practice log (docs/architecture.md E20): what counts as practising,
// how it is reported, and what the panel shows - pure, without DOM, clock or
// server.
//
// What counts: time while the score sounds or the microphone records for
// the singer (usePracticeLog.js decides "active"). Reading the notes alone
// does not count - a score left open on the stand overnight would otherwise
// practise by itself.

/** Reported at the latest every minute while practising. */
export const REPORT_INTERVAL_MS = 60 * 1000

/** One report never claims more than the server takes (PracticeLogService). */
export const MAX_REPORT_SECONDS = 300

/**
 * A stretch of activity longer than this between two looks at the clock is
 * not believed: the device slept, or the tab was frozen, with "playing"
 * still set. Twice the report interval - a report that is merely late still
 * counts in full.
 */
export const MAX_STRETCH_MS = 2 * REPORT_INTERVAL_MS

/**
 * The local calendar day as `YYYY-MM-DD` - the singer's "today", not the
 * server's (the server accepts a day either side, PracticeLogService).
 *
 * @param {Date} date
 * @return {string}
 */
export function localDay(date) {
	const pad = (n) => String(n).padStart(2, '0')
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * The day `days` before (negative: after) a `YYYY-MM-DD` day. Calendar
 * arithmetic in UTC, so a change to summer time does not skip or repeat one.
 *
 * @param {string} day
 * @param {number} days
 * @return {string}
 */
export function shiftDay(day, days) {
	const [y, m, d] = day.split('-').map(Number)
	const date = new Date(Date.UTC(y, m - 1, d - days))
	const pad = (n) => String(n).padStart(2, '0')
	return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

/**
 * Weekday of a day, 0 = Monday … 6 = Sunday (ISO week, as a choir week runs
 * from Monday rehearsal to Monday rehearsal more often than from Sunday).
 *
 * @param {string} day
 * @return {number}
 */
export function weekdayOf(day) {
	const [y, m, d] = day.split('-').map(Number)
	return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

/**
 * Collects active time and hands it out in whole seconds. The remainder
 * stays for the next report - a minute of short presses of play adds up
 * instead of being rounded away each time.
 *
 * @return {{mark: (nowMs: number, active: boolean) => void, take: (max?: number) => number, pendingMs: () => number}}
 */
export function createPracticeMeter() {
	let since = null
	let collectedMs = 0
	return {
		/**
		 * Tells the meter the state at `nowMs`: what ran since the last mark
		 * while active is added (bounded by MAX_STRETCH_MS).
		 *
		 * @param {number} nowMs
		 * @param {boolean} active
		 */
		mark(nowMs, active) {
			if (since !== null) {
				const stretch = nowMs - since
				if (stretch > 0) {
					collectedMs += Math.min(stretch, MAX_STRETCH_MS)
				}
			}
			since = active ? nowMs : null
		},

		/**
		 * @param {number} [max] at most this many seconds; the rest stays
		 * @return {number} whole seconds, taken out of the meter
		 */
		take(max = MAX_REPORT_SECONDS) {
			const seconds = Math.min(max, Math.floor(collectedMs / 1000))
			collectedMs -= seconds * 1000
			return seconds
		},

		pendingMs() {
			return collectedMs
		},
	}
}

/**
 * What the panel shows for one score.
 *
 * @param {object} input
 * @param {Object<string, number>} input.days day => seconds of this score
 *   (the server's summary, plus what was reported since)
 * @param {string[]} input.activeDays days with practice on any score
 * @param {string} input.today local day
 * @param {?number} input.goalMinutes the leader's weekly goal
 * @return {{week: Array<{day: string, seconds: number, today: boolean, future: boolean}>, weekSeconds: number, lastWeekSeconds: number, streak: number, goalPercent: ?number, goalReached: boolean}}
 */
export function summarize({ days, activeDays, today, goalMinutes }) {
	const monday = shiftDay(today, weekdayOf(today))
	const week = []
	let weekSeconds = 0
	for (let i = 0; i < 7; i++) {
		const day = shiftDay(monday, -i)
		const seconds = days?.[day] ?? 0
		const future = day > today
		week.push({ day, seconds, today: day === today, future })
		if (!future) {
			weekSeconds += seconds
		}
	}
	let lastWeekSeconds = 0
	for (let i = 1; i <= 7; i++) {
		lastWeekSeconds += days?.[shiftDay(monday, i)] ?? 0
	}
	const goalSeconds = goalMinutes > 0 ? goalMinutes * 60 : null
	return {
		week,
		weekSeconds,
		lastWeekSeconds,
		streak: streakOf(activeDays, today),
		goalPercent: goalSeconds === null ? null : Math.min(100, Math.round((weekSeconds / goalSeconds) * 100)),
		goalReached: goalSeconds !== null && weekSeconds >= goalSeconds,
	}
}

/**
 * Days in a row with practice, ending today - or yesterday, when today has
 * not been practised yet: a streak should not read 0 at breakfast.
 *
 * @param {string[]} activeDays
 * @param {string} today
 * @return {number}
 */
export function streakOf(activeDays, today) {
	const set = new Set(activeDays ?? [])
	let day = set.has(today) ? today : shiftDay(today, 1)
	let count = 0
	while (set.has(day)) {
		count++
		day = shiftDay(day, 1)
	}
	return count
}

/**
 * Minutes for display: practice is counted in seconds, read in minutes -
 * and the first half minute should not read "0 min".
 *
 * @param {number} seconds
 * @return {number}
 */
export function minutesOf(seconds) {
	if (seconds <= 0) {
		return 0
	}
	return Math.max(1, Math.round(seconds / 60))
}
