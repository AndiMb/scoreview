<template>
	<!--
		Eine Karte ueber dem Notenbild (Mixer, Notizen, Probe, …): Rahmen,
		Ueberschrift und Schliessen-Knopf an EINER Stelle. Der Inhalt bleibt
		als Slot im Template des Viewers - er ist dort verdrahtet, und seine
		scoped Styles greifen weiter (Slotinhalt traegt die Scope-ID des
		Elternteils).
	-->
	<!-- Named by its heading, so that a screen reader lists it as a region
		of its own; without a title it is a plain group. -->
	<!-- tabindex -1: focus can be put here when the card has nothing to focus. -->
	<section
		class="scoreview-panel"
		tabindex="-1"
		:aria-labelledby="title ? headingId : undefined"
		@keydown.esc="onEscape">
		<div v-if="title" class="scoreview-panel-head">
			<h3 :id="headingId">
				{{ title }}
			</h3>
			<NcButton :aria-label="t('Close')" :title="t('Close')" @click="$emit('close')">
				<template #icon>
					<Close :size="20" />
				</template>
			</NcButton>
		</div>
		<slot />
	</section>
</template>

<script>
import NcButton from '@nextcloud/vue/components/NcButton'
import Close from 'vue-material-design-icons/Close.vue'
import { translate } from '../l10n.js'

let panelCount = 0

// How long after opening a focus taken away by a closing popover is taken back.
const RECLAIM_MS = 1000

// What can take the focus inside a card, in document order.
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export default {
	name: 'ScorePanel',

	components: {
		Close,
		NcButton,
	},

	props: {
		// Ohne Ueberschrift auch ohne Kopfzeile - fuer einen reinen Hinweis
		// wie den wartenden Stempel, der seinen eigenen Abbrechen-Knopf hat.
		title: {
			type: String,
			default: '',
		},
	},

	emits: ['close'],

	data() {
		return { headingId: `scoreview-panel-${++panelCount}` }
	},

	/*
	 * A card opens from the bar or from another card. Keyboard and screen
	 * reader users land in it - otherwise they would have to find it by
	 * tabbing through the whole bar - and go back to where they were when
	 * it closes. Not a modal: the score stays usable beside it, so there is
	 * no focus trap.
	 */
	mounted() {
		this.returnFocusTo = document.activeElement
		this.focusInside()
		// A card opened from a bar group: the group's popover closes in the
		// same click and its focus trap hands the focus back to the group's
		// button - after this card has mounted (measured: the card lost the
		// focus at once). For a moment, a focus that leaves without the user
		// doing anything is taken back, and the element it went to becomes
		// the place to return to - the group button, which stays.
		const reclaim = (event) => {
			if (!this.$el.contains(event.target)) {
				this.returnFocusTo = event.target
				this.focusInside()
			}
		}
		const stop = () => {
			clearTimeout(this.reclaimTimer)
			document.removeEventListener('focusin', reclaim, true)
			document.removeEventListener('pointerdown', stop, true)
			document.removeEventListener('keydown', stop, true)
			this.stopReclaim = null
		}
		document.addEventListener('focusin', reclaim, true)
		document.addEventListener('pointerdown', stop, true)
		document.addEventListener('keydown', stop, true)
		this.reclaimTimer = setTimeout(stop, RECLAIM_MS)
		this.stopReclaim = stop
	},

	beforeUnmount() {
		this.stopReclaim?.()
		const back = this.returnFocusTo
		this.returnFocusTo = null
		// Only if the focus is still ours: a user who has moved on elsewhere
		// keeps their place. The opener may be gone (a menu that closed).
		const active = document.activeElement
		const ours = active === null || active === document.body || this.$el.contains(active)
		if (ours && back?.isConnected && typeof back.focus === 'function') {
			back.focus({ preventScroll: true })
		}
	},

	methods: {
		focusInside() {
			const target = this.$el.querySelector(FOCUSABLE) ?? this.$el
			target.focus({ preventScroll: true })
		},

		/**
		 * Escape closes a card that can be closed - and goes no further:
		 * Nextcloud's Viewer would close the whole score on the same key.
		 * Left alone where a control inside still uses it (an open select).
		 *
		 * @param {KeyboardEvent} event
		 */
		onEscape(event) {
			if (!this.title || event.defaultPrevented || event.target?.closest?.('[aria-expanded="true"]')) {
				return
			}
			event.stopPropagation()
			this.$emit('close')
		},

		t(text, vars) {
			return translate('scoreview', text, vars)
		},
	},
}
</script>

<style scoped>
.scoreview-panel {
	pointer-events: auto;
	/* Focused only to land the keyboard here (mounted()), not a control. */
	outline: none;
	box-sizing: border-box;
	background: var(--color-main-background);
	border: 1px solid var(--color-border);
	border-radius: var(--border-radius-element, 8px);
	box-shadow: 0 2px 12px var(--color-box-shadow, rgba(0, 0, 0, 0.2));
	padding: 8px 12px 12px 12px;
	max-height: 100%;
	overflow-y: auto;
}

.scoreview-panel-head {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
}

.scoreview-panel-head h3 {
	margin: 0;
	font-size: 1.1em;
}
</style>
