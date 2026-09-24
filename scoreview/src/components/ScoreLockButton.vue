<template>
	<button
		type="button"
		class="scoreview-lock"
		:class="{ 'scoreview-lock--active': active }"
		:aria-pressed="active"
		:aria-label="label"
		:title="label"
		@pointerdown="onPointerDown"
		@pointerup="$emit('cancel')"
		@pointercancel="$emit('cancel')"
		@lostpointercapture="$emit('cancel')"
		@keydown="$emit('lockKeydown', $event)"
		@keyup="$emit('lockKeyup', $event)"
		@contextmenu.prevent>
		<!--
			Der Fortschrittsring zeigt, dass das Halten wirkt - ohne ihn hielte
			man eine Sekunde lang einen scheinbar toten Knopf und liesse los,
			kurz bevor es geklappt haette.
		-->
		<svg
			v-if="active"
			class="scoreview-lock-ring"
			viewBox="0 0 36 36"
			aria-hidden="true">
			<circle
				cx="18"
				cy="18"
				r="16"
				:stroke-dasharray="circumference"
				:stroke-dashoffset="circumference * (1 - progress)" />
		</svg>
		<Lock v-if="active" :size="20" />
		<LockOpenVariantOutline v-else :size="20" />
	</button>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import Lock from 'vue-material-design-icons/Lock.vue'
import LockOpenVariantOutline from 'vue-material-design-icons/LockOpenVariantOutline.vue'

const RADIUS = 16

/**
 * Das Schloss des Aufführungsmodus: ein Tipp schaltet ein, verlassen
 * nur durch eine Sekunde Halten. Die Zeitmessung steht in
 * usePerformanceMode.js, hier nur die Geste und der Ring.
 */
export default {
	name: 'ScoreLockButton',

	components: { Lock, LockOpenVariantOutline },

	props: {
		active: {
			type: Boolean,
			default: false,
		},

		// 0..1, wie weit das Halten zum Verlassen ist.
		progress: {
			type: Number,
			default: 0,
		},
	},

	emits: ['down', 'cancel', 'lockKeydown', 'lockKeyup'],

	computed: {
		circumference() {
			return 2 * Math.PI * RADIUS
		},

		label() {
			return this.active
				? this.t('Performance mode is on – hold for one second to leave')
				: this.t('Performance mode: only page turning and zoom stay active')
		},
	},

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		onPointerDown(event) {
			if (event.button !== undefined && event.button !== 0) {
				return
			}
			// Das Loslassen muss ankommen, auch wenn der Finger dabei vom Knopf
			// rutscht - sonst liefe der Ring weiter und schaltete doch aus.
			event.currentTarget.setPointerCapture?.(event.pointerId)
			this.$emit('down')
		},
	},
}
</script>

<style scoped>
.scoreview-lock {
	position: relative;
	flex: 0 0 auto;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	inline-size: var(--default-clickable-area, 34px);
	block-size: var(--default-clickable-area, 34px);
	margin: 0;
	padding: 0;
	border: none;
	border-radius: 50%;
	background: transparent;
	color: var(--color-main-text);
	cursor: pointer;
	user-select: none;
	-webkit-user-select: none;
	touch-action: none;
}

.scoreview-lock:hover {
	background: var(--color-background-hover);
}

.scoreview-lock--active {
	background: var(--color-primary-element);
	color: var(--color-primary-element-text);
}

.scoreview-lock--active:hover {
	background: var(--color-primary-element-hover);
}

.scoreview-lock-ring {
	position: absolute;
	inset: 0;
	inline-size: 100%;
	block-size: 100%;
	transform: rotate(-90deg);
	pointer-events: none;
}

.scoreview-lock-ring circle {
	fill: none;
	stroke: var(--color-primary-element-text);
	stroke-width: 3;
}
</style>
