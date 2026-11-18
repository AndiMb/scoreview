<template>
	<!--
		Several roots, no wrapper: each card is a direct child of the scrolling
		element, where the band layout keeps it at its own height
		(ScoreStage.vue, .scoreview-scroll--band > .scoreview-hint).
	-->
	<NcNoteCard v-if="playback.soundFontLoading" type="info" class="scoreview-hint">
		{{ t('Loading sound ({percent}%)…', { percent: playback.soundFontLoadPercent }) }}
		<NcButton @click="playback.skipSoundFontLoad">
			{{ t('Continue without sound') }}
		</NcButton>
	</NcNoteCard>
	<NcNoteCard v-else-if="!playback.hasRealPlayer" type="warning" class="scoreview-hint">
		{{ t('No sound: {reason}', { reason: playback.playbackError || t('Playback is not available.') }) }}
		{{ t('The score cursor keeps running independently of this.') }}
	</NcNoteCard>
	<NcNoteCard v-if="variant.status === 'loading'" type="info" class="scoreview-hint">
		{{ t('Engraving the chosen part or page format …') }}
	</NcNoteCard>
	<NcNoteCard v-else-if="variant.status === 'error'" type="warning" class="scoreview-hint">
		{{ variant.errorText }}
		<div class="scoreview-hint-actions">
			<NcButton @click="variant.retry()">
				{{ t('Try again') }}
			</NcButton>
			<NcButton @click="variant.dismissError()">
				{{ t('Dismiss') }}
			</NcButton>
		</div>
	</NcNoteCard>
	<NcNoteCard v-if="variant.offerPhonePages" type="info" class="scoreview-hint">
		{{ t('This score can be engraved on pages the size of a phone screen, with larger notes.') }}
		<div class="scoreview-hint-actions">
			<NcButton variant="primary" @click="variant.answerPhoneOffer(true)">
				{{ t('Use phone pages') }}
			</NcButton>
			<NcButton @click="variant.answerPhoneOffer(false)">
				{{ t('No, thanks') }}
			</NcButton>
		</div>
	</NcNoteCard>
	<!--
		Angebot auf Handybreite (D9): einmal, die Antwort wird
		gemerkt (bandOffered).
	-->
	<NcNoteCard v-if="offerBand" type="info" class="scoreview-hint">
		{{ t('On a phone, the system band shows the staves side by side in landscape.') }}
		<div class="scoreview-hint-actions">
			<NcButton variant="primary" @click="answerBandOffer(true)">
				{{ t('Try the system band') }}
			</NcButton>
			<NcButton @click="answerBandOffer(false)">
				{{ t('No, thanks') }}
			</NcButton>
		</div>
	</NcNoteCard>
	<!-- Die gewaehlte Darstellung geht nicht (N3): sagen, warum. -->
	<NcNoteCard v-if="prefs.layout !== display.activeLayout" type="info" class="scoreview-hint">
		{{ t('Lyrics view is not available: {reason} Showing the pages instead.', { reason: display.lyricsUnavailable }) }}
	</NcNoteCard>
</template>

<script>
import NcButton from '@nextcloud/vue/components/NcButton'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import { translate } from '../l10n.js'
import { VIEWER_CONTEXT } from './viewerContext.js'

/**
 * The cards above the score (#67, from ScoreViewer.vue): the sound loading
 * or missing, the display variant being engraved or failing, and the
 * offers of phone pages and the system band. Each reads the viewer's
 * composables (viewerContext.js); the only state of its own is how wide
 * the viewer was when it opened.
 */
export default {
	name: 'ViewerHints',

	components: {
		NcButton,
		NcNoteCard,
	},

	inject: {
		ctx: { from: VIEWER_CONTEXT },
	},

	props: {
		// Window width when the viewer opened - for the one-time offer of
		// the system band at phone width (D9).
		viewerWidth: {
			type: Number,
			default: 0,
		},
	},

	computed: {
		playback() {
			return this.ctx.playback
		},

		variant() {
			return this.ctx.variant
		},

		prefs() {
			return this.ctx.prefs
		},

		display() {
			return this.ctx.display
		},

		/**
		 * Auf Handybreite einmal das Systemband anbieten (D9) - und ebenso,
		 * wenn der Platz in der Hoehe knapp ist: Ein Telefon quer ist breiter
		 * als 600 px, zeigt in der Seitenansicht mit „Breite einpassen" aber
		 * nur einen Teil eines Systems (issue #15).
		 */
		offerBand() {
			return !this.prefs.bandOffered && this.prefs.layout === 'pages' && ((this.viewerWidth > 0 && this.viewerWidth < 600) || this.ctx.bar.tight)
		},
	},

	methods: {
		// Single-argument wrapper, the call pattern tools/l10n.mjs looks for.
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		/** @param {boolean} accepted */
		answerBandOffer(accepted) {
			this.prefs.bandOffered = true
			if (accepted) {
				this.prefs.layout = 'band'
			}
		},
	},
}
</script>

<style scoped>
.scoreview-hint {
	margin-bottom: 8px;
}
</style>
