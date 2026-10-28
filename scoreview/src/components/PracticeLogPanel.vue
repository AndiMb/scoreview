<!--
	The practice log (E20): this week's minutes on this score, a bar per
	day, days in a row, and the leader's weekly goal. Only the singer sees
	it - the panel says so, because "practice statistics" in a choir app
	makes people wonder who is watching.

	No ranking and no badges: in a self-hosted choir tool a leaderboard
	would compare people who never agreed to be compared.
-->
<template>
	<div class="scoreview-plog">
		<p class="scoreview-plog-week">
			<strong>{{ t('{minutes} min this week', { minutes: minutesOf(summary.weekSeconds) }) }}</strong>
			<span class="scoreview-plog-hint">
				{{ t('Last week: {minutes} min', { minutes: minutesOf(summary.lastWeekSeconds) }) }}
			</span>
		</p>

		<div class="scoreview-plog-bars" role="img" :aria-label="barsLabel">
			<div
				v-for="d in summary.week"
				:key="d.day"
				class="scoreview-plog-day"
				:class="{ 'scoreview-plog-day--today': d.today, 'scoreview-plog-day--future': d.future }"
				:title="t('{day}: {minutes} min', { day: dayName(d.day), minutes: minutesOf(d.seconds) })">
				<span class="scoreview-plog-bar-box">
					<span class="scoreview-plog-bar" :style="{ height: barHeight(d.seconds) + '%' }" />
				</span>
				<span class="scoreview-plog-label" aria-hidden="true">{{ dayLetter(d.day) }}</span>
			</div>
		</div>

		<p v-if="summary.streak > 1" class="scoreview-plog-streak">
			<!-- Only from two days on, so no plural form is needed - the
				extraction (tools/l10n) knows only t(). -->
			{{ t('{days} days in a row', { days: summary.streak }) }}
		</p>

		<section class="scoreview-plog-goal">
			<template v-if="goal">
				<p class="scoreview-plog-goal-text">
					{{ goal.setBy
						? t('Goal: {minutes} min per week, set by {name}', { minutes: goal.minutesPerWeek, name: goal.setBy })
						: t('Goal: {minutes} min per week', { minutes: goal.minutesPerWeek }) }}
				</p>
				<progress
					class="scoreview-plog-progress"
					max="100"
					:value="summary.goalPercent"
					:aria-label="t('{percent} % of the weekly goal', { percent: summary.goalPercent })" />
				<p class="scoreview-plog-hint">
					{{ summary.goalReached ? t('Goal reached this week.') : t('{percent} % of the weekly goal', { percent: summary.goalPercent }) }}
				</p>
			</template>
			<p v-else-if="!isLeader" class="scoreview-plog-hint">
				{{ t('No practice goal for this piece.') }}
			</p>

			<form v-if="isLeader" class="scoreview-plog-goal-form" @submit.prevent="saveGoal">
				<NcTextField
					v-model="goalInput"
					type="number"
					min="0"
					:label="t('Weekly goal for everyone (minutes)')"
					:helperText="t('0 removes the goal. Nobody sees anyone else\'s time - not even leaders.')" />
				<NcButton type="submit" :disabled="savingGoal">
					{{ t('Set goal') }}
				</NcButton>
			</form>
			<p v-if="error" class="scoreview-plog-error">
				{{ error }}
			</p>
		</section>

		<p class="scoreview-plog-hint scoreview-plog-hint--small">
			{{ t('Counted while the score plays or you record. Only you see your practice time.') }}
		</p>
	</div>
</template>

<script>
import { getLanguage, translate } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import { minutesOf } from '../lib/practiceLog.js'

export default {
	name: 'PracticeLogPanel',

	components: { NcButton, NcTextField },

	props: {
		// usePracticeLog().summary
		summary: {
			type: Object,
			required: true,
		},

		// {minutesPerWeek, setBy} or null
		goal: {
			type: Object,
			default: null,
		},

		isLeader: {
			type: Boolean,
			default: false,
		},

		savingGoal: {
			type: Boolean,
			default: false,
		},

		error: {
			type: String,
			default: '',
		},
	},

	emits: ['setGoal'],

	data() {
		return {
			goalInput: String(this.goal?.minutesPerWeek ?? ''),
		}
	},

	computed: {
		maxSeconds() {
			return Math.max(...this.summary.week.map((d) => d.seconds), 1)
		},

		barsLabel() {
			return this.summary.week
				.filter((d) => !d.future)
				.map((d) => this.t('{day}: {minutes} min', { day: this.dayName(d.day), minutes: minutesOf(d.seconds) }))
				.join(', ')
		},
	},

	watch: {
		goal(goal) {
			this.goalInput = String(goal?.minutesPerWeek ?? '')
		},
	},

	methods: {
		minutesOf,

		barHeight(seconds) {
			// A day with a little practice still shows a stub - "something"
			// is not "nothing".
			return seconds > 0 ? Math.max(6, Math.round((seconds / this.maxSeconds) * 100)) : 0
		},

		dateOf(day) {
			const [y, m, d] = day.split('-').map(Number)
			return new Date(y, m - 1, d)
		},

		dayName(day) {
			return this.dateOf(day).toLocaleDateString(getLanguage(), { weekday: 'long' })
		},

		dayLetter(day) {
			return this.dateOf(day).toLocaleDateString(getLanguage(), { weekday: 'narrow' })
		},

		saveGoal() {
			const minutes = Number(this.goalInput)
			this.$emit('setGoal', Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0)
		},

		t(text, vars) {
			return translate('scoreview', text, vars)
		},
	},
}
</script>

<style scoped>
.scoreview-plog {
	display: flex;
	flex-direction: column;
	gap: 8px;
	min-inline-size: 260px;
}

.scoreview-plog-week {
	display: flex;
	flex-direction: column;
	margin: 0;
}

.scoreview-plog-bars {
	display: flex;
	gap: 6px;
	align-items: flex-end;
	block-size: 90px;
}

.scoreview-plog-day {
	display: flex;
	flex: 1;
	flex-direction: column;
	align-items: center;
	block-size: 100%;
}

.scoreview-plog-bar-box {
	display: flex;
	flex: 1;
	align-items: flex-end;
	inline-size: 100%;
	border-block-end: 1px solid var(--color-border);
}

.scoreview-plog-bar {
	inline-size: 100%;
	border-radius: 3px 3px 0 0;
	background: var(--color-primary-element);
}

.scoreview-plog-day--today .scoreview-plog-label {
	font-weight: bold;
}

.scoreview-plog-day--future {
	opacity: 0.4;
}

.scoreview-plog-label {
	font-size: 0.85em;
}

.scoreview-plog-streak {
	margin: 0;
	font-weight: bold;
}

.scoreview-plog-goal {
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.scoreview-plog-goal-text {
	margin: 0;
}

.scoreview-plog-progress {
	inline-size: 100%;
	accent-color: var(--color-primary-element);
}

/* The button goes under the field where the panel is narrow - cut to
   "Set …" it would not say what it does. */
.scoreview-plog-goal-form {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	align-items: flex-start;
}

.scoreview-plog-goal-form > :first-child {
	flex: 1 1 180px;
}

.scoreview-plog-goal-form > :last-child {
	flex: none;
}

.scoreview-plog-hint {
	margin: 0;
	color: var(--color-text-maxcontrast);
}

.scoreview-plog-hint--small {
	font-size: 0.9em;
}

.scoreview-plog-error {
	margin: 0;
	color: var(--color-error-text, var(--color-error));
}
</style>
