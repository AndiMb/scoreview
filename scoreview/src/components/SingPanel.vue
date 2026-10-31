<template>
	<!--
		Scored singing (E24): start, level, view, and the result of the last
		run sung through. Only the singer's own numbers - no list of others.
	-->
	<div class="scoreview-sing">
		<NcNoteCard v-if="needPart" type="info">
			{{ t('Choose your part first.') }}
		</NcNoteCard>
		<NcNoteCard v-if="micError" type="warning">
			{{ micError }}
		</NcNoteCard>
		<NcNoteCard v-if="error" type="error">
			{{ error }}
		</NcNoteCard>

		<div class="scoreview-sing-row">
			<NcButton :pressed="active" variant="primary" @click="$emit('toggle')">
				<template #icon>
					<Microphone :size="20" />
				</template>
				{{ active ? t('Stop scoring') : t('Start scoring') }}
			</NcButton>
			<span class="scoreview-sing-unit">{{ unitLabel }}</span>
		</div>
		<p class="scoreview-sing-help">
			{{ active ? t('Press play and sing your part from the start of the piece or the loop.') : t('Your part is scored note by note: pitch, onset and length.') }}
		</p>

		<fieldset class="scoreview-sing-choice">
			<legend>{{ t('Level') }}</legend>
			<NcCheckboxRadioSwitch
				v-for="option in levels"
				:key="option.id"
				:modelValue="level"
				:value="option.id"
				name="scoreview-sing-level"
				type="radio"
				@update:modelValue="$emit('update:level', $event)">
				{{ option.label }}
			</NcCheckboxRadioSwitch>
		</fieldset>

		<fieldset class="scoreview-sing-choice">
			<legend>{{ t('View') }}</legend>
			<NcCheckboxRadioSwitch
				:modelValue="view"
				value="band"
				name="scoreview-sing-view"
				type="radio"
				@update:modelValue="$emit('update:view', $event)">
				{{ t('Lane under the score') }}
			</NcCheckboxRadioSwitch>
			<NcCheckboxRadioSwitch
				:modelValue="view"
				value="stage"
				name="scoreview-sing-view"
				type="radio"
				@update:modelValue="$emit('update:view', $event)">
				{{ t('Singing stage with lyrics') }}
			</NcCheckboxRadioSwitch>
		</fieldset>
		<p class="scoreview-sing-help">
			{{ t('Use headphones: otherwise the accompaniment reaches the microphone and is scored along.') }}
		</p>

		<section v-if="lastRun" class="scoreview-sing-result">
			<div class="scoreview-sing-result-head">
				<h4>{{ t('Result') }}</h4>
				<NcButton :aria-label="t('Hide result')" variant="tertiary" @click="$emit('dismiss')">
					<template #icon>
						<Close :size="20" />
					</template>
				</NcButton>
			</div>
			<p class="scoreview-sing-total">
				<strong>{{ pct(lastRun.summary.totalPct) }}</strong>
				<span v-if="lastRun.isNewBest" class="scoreview-sing-best">{{ t('New best!') }}</span>
				<span v-else-if="lastRun.previousBest !== null" class="scoreview-sing-meta">
					{{ t('Best: {pct}', { pct: pct(lastRun.previousBest) }) }}
				</span>
			</p>
			<p class="scoreview-sing-meta">
				{{ resultMeta }}
			</p>
			<dl class="scoreview-sing-parts">
				<dt>{{ t('Pitch') }}</dt>
				<dd>{{ pct(lastRun.summary.pitchPct) }}</dd>
				<dt>{{ t('Onset') }}</dt>
				<dd>{{ pct(lastRun.summary.onsetPct) }}</dd>
				<dt>{{ t('Length') }}</dt>
				<dd>{{ pct(lastRun.summary.releasePct) }}</dd>
			</dl>
			<p v-if="!lastRun.scored" class="scoreview-sing-meta">
				{{ t('Not scored: the run was not sung from the start, was jumped in, changed tempo or waited.') }}
			</p>
			<p v-else-if="lastRun.saving" class="scoreview-sing-meta">
				{{ t('Saving …') }}
			</p>
			<p v-else-if="!lastRun.saved" class="scoreview-sing-warning">
				{{ t('Not saved.') }}
			</p>

			<template v-if="lastRun.spots.length > 0">
				<h5>{{ t('To practise') }}</h5>
				<ul class="scoreview-sing-spots">
					<li v-for="spot in lastRun.spots" :key="spot.onMs">
						<NcButton variant="tertiary" @click="$emit('jump', spot.onMs)">
							{{ spot.measure !== null ? t('Measure {measure}: {issue}', { measure: spot.measure, issue: spotText(spot) }) : spotText(spot) }}
						</NcButton>
						<NcButton
							v-if="spot.measure !== null"
							:aria-label="t('Loop measure {measure}', { measure: spot.measure })"
							:title="t('Loop measure {measure}', { measure: spot.measure })"
							variant="tertiary"
							@click="$emit('loop', spot.measure)">
							<template #icon>
								<Repeat :size="20" />
							</template>
						</NcButton>
					</li>
				</ul>
			</template>
		</section>

		<section v-if="history.length > 1" class="scoreview-sing-history">
			<h5>{{ t('Your runs') }}</h5>
			<svg
				class="scoreview-sing-chart"
				viewBox="0 0 240 48"
				role="img"
				:aria-label="t('Your last {count} runs, from {first} to {last}', { count: history.length, first: pct(chartRuns[0].totalPct), last: pct(chartRuns[chartRuns.length - 1].totalPct) })">
				<polyline
					:points="chartPoints"
					fill="none"
					stroke="currentColor"
					stroke-width="2" />
			</svg>
		</section>

		<NcButton
			v-if="history.length > 0"
			variant="tertiary"
			class="scoreview-sing-clear"
			@click="$emit('clear')">
			<template #icon>
				<Delete :size="20" />
			</template>
			{{ t('Delete my results for this piece') }}
		</NcButton>
	</div>
</template>

<script>
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import Close from 'vue-material-design-icons/Close.vue'
import Delete from 'vue-material-design-icons/Delete.vue'
import Microphone from 'vue-material-design-icons/Microphone.vue'
import Repeat from 'vue-material-design-icons/Repeat.vue'
import { translate } from '../l10n.js'
import { labelText } from '../lib/singLane.js'

export default {
	name: 'SingPanel',

	components: { Close, Delete, Microphone, NcButton, NcCheckboxRadioSwitch, NcNoteCard, Repeat },

	props: {
		active: { type: Boolean, default: false },
		level: { type: String, default: 'choir' },
		view: { type: String, default: 'band' },
		unitLabel: { type: String, default: '' },
		needPart: { type: Boolean, default: false },
		micError: { type: String, default: '' },
		error: { type: String, default: '' },
		lastRun: { type: Object, default: null },
		/** Newest first, as the server sends them. */
		history: { type: Array, default: () => [] },
	},

	emits: ['toggle', 'update:level', 'update:view', 'jump', 'loop', 'clear', 'dismiss'],

	computed: {
		levels() {
			return [
				{ id: 'easy', label: this.t('Beginner') },
				{ id: 'choir', label: this.t('Choir') },
				{ id: 'strict', label: this.t('Strict') },
			]
		},

		resultMeta() {
			const r = this.lastRun
			const level = this.levels.find((l) => l.id === r.level)?.label ?? r.level
			return this.t('{level} · tempo {tempo} % · {notes} notes', { level, tempo: r.tempoPct, notes: r.summary.notesScored })
		},

		chartRuns() {
			return [...this.history].reverse()
		},

		chartPoints() {
			const runs = this.chartRuns
			const step = runs.length > 1 ? 236 / (runs.length - 1) : 0
			return runs.map((r, i) => `${(2 + i * step).toFixed(1)},${(46 - (r.totalPct / 100) * 44).toFixed(1)}`).join(' ')
		},
	},

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		pct(value) {
			return value === null || value === undefined ? '–' : `${value} %`
		},

		spotText(spot) {
			return labelText(spot.label, this.t)
		},
	},
}
</script>

<style scoped>
.scoreview-sing {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.scoreview-sing-row {
	display: flex;
	align-items: center;
	gap: 12px;
	flex-wrap: wrap;
}

.scoreview-sing-unit,
.scoreview-sing-meta {
	color: var(--color-text-maxcontrast);
}

.scoreview-sing-help {
	margin: 0;
	color: var(--color-text-maxcontrast);
	font-size: 0.9em;
}

.scoreview-sing-choice {
	display: flex;
	flex-wrap: wrap;
	gap: 0 12px;
	border: none;
	margin: 0;
	padding: 0;
}

.scoreview-sing-choice legend {
	font-weight: bold;
	padding: 0;
}

.scoreview-sing-result {
	border-top: 1px solid var(--color-border);
	padding-top: 8px;
}

.scoreview-sing-result-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
}

.scoreview-sing-result h4,
.scoreview-sing-result h5,
.scoreview-sing-history h5 {
	margin: 0;
}

.scoreview-sing-total {
	display: flex;
	align-items: baseline;
	gap: 12px;
	margin: 4px 0;
}

.scoreview-sing-total strong {
	font-size: 2em;
	font-variant-numeric: tabular-nums;
}

.scoreview-sing-best {
	color: var(--color-success-text, var(--color-success));
	font-weight: bold;
}

.scoreview-sing-warning {
	color: var(--color-warning-text, var(--color-warning));
}

.scoreview-sing-parts {
	display: grid;
	grid-template-columns: max-content max-content;
	gap: 2px 16px;
	margin: 4px 0;
}

.scoreview-sing-parts dd {
	margin: 0;
	font-variant-numeric: tabular-nums;
}

.scoreview-sing-spots {
	list-style: none;
	margin: 0;
	padding: 0;
}

.scoreview-sing-spots li {
	display: flex;
	align-items: center;
}

.scoreview-sing-chart {
	width: 100%;
	max-width: 240px;
	height: 48px;
	color: var(--color-primary-element);
}

.scoreview-sing-clear {
	align-self: flex-start;
}
</style>
