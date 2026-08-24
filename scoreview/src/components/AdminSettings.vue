<template>
	<div>
		<NcSettingsSection :name="t('ScoreView')" :description="t('Address and shared secret of the MuseScore sidecar container (see sidecar/README.md).')">
			<form @submit.prevent="save">
				<NcTextField
					v-model="form.sidecarUrl"
					class="scoreview-field"
					:label="t('Sidecar URL')"
					placeholder="http://scoreview-sidecar:8765" />

				<!--
					NcPasswordField statt eines nackten type=password: es bringt
					den Sichtbarkeits-Umschalter samt Beschriftung mit, den die
					handgeschriebene Fassung nicht hatte. Der Wert wird nie
					vorbefuellt - der Server liefert bewusst nur, OB eines
					gesetzt ist (siehe Settings\AdminSettings), nie das Secret
					selbst.
				-->
				<NcPasswordField
					v-model="form.sidecarSecret"
					class="scoreview-field"
					:label="t('Shared secret')"
					:placeholder="secretPlaceholder"
					:helperText="initial.sidecarSecretSet ? t('Leave empty to keep the current secret.') : ''" />

				<NcCheckboxRadioSwitch v-model="form.eagerConversion" type="switch" class="scoreview-field">
					{{ t('Convert new/changed scores immediately (instead of on first open)') }}
				</NcCheckboxRadioSwitch>

				<NcTextField
					v-model="form.soundFontUrl"
					class="scoreview-field"
					:label="t('Custom SoundFont URL (SF2/SF3, optional)')"
					placeholder="https://…/MuseScore_General.sf3"
					:helperText="t('Leave empty: playback then uses the SoundFont that the sidecar brings along (MuseScore General Lite, ~40 MB), delivered by the app itself. Only fill in if a different SoundFont should be used - that address must then be reachable via HTTP(S) from the browser and allow CORS.')" />

				<div class="scoreview-actions">
					<NcButton variant="primary" type="submit" :disabled="saving">
						<template #icon>
							<NcLoadingIcon v-if="saving" :size="20" />
							<ContentSave v-else :size="20" />
						</template>
						{{ t('Save') }}
					</NcButton>
				</div>

				<NcNoteCard v-if="saveState === 'ok'" type="success" class="scoreview-field">
					{{ t('Saved') }}
				</NcNoteCard>
				<NcNoteCard v-else-if="saveState === 'error'" type="error" class="scoreview-field">
					{{ t('Error: {message}', { message: saveError }) }}
				</NcNoteCard>
			</form>
		</NcSettingsSection>

		<!--
			Betriebsdiagnose (Phase 21): macht sichtbar, was sonst nur im Log
			oder gar nicht steht - insbesondere ob der Nextcloud-Cron laeuft.
			Ohne ihn bleibt jede Konvertierung stumm auf "pending" stehen.
			Seit Phase 23/Schritt 3 als NcNoteCard je Zeile statt als eingefaerbte
			<div>s: die Karten tragen Symbol UND Rolle, die Aussage kommt damit
			auch ohne Farbwahrnehmung und im Screenreader an.
		-->
		<NcSettingsSection :name="t('Status')">
			<NcLoadingIcon v-if="healthLoading" :size="20" :name="t('Loading…')" />
			<NcNoteCard v-else-if="healthError" type="error">
				{{ t('Error: {message}', { message: healthError }) }}
			</NcNoteCard>
			<template v-else-if="health">
				<NcNoteCard v-for="line in healthLines" :key="line.label" :type="line.ok ? 'success' : 'error'">
					<strong>{{ line.label }}</strong>{{ line.detail ? ` – ${line.detail}` : '' }}
				</NcNoteCard>
			</template>

			<div class="scoreview-actions">
				<NcButton :disabled="healthLoading" @click="loadHealth">
					<template #icon>
						<Refresh :size="20" />
					</template>
					{{ t('Refresh') }}
				</NcButton>
				<NcButton :disabled="selfTestRunning" @click="runSelfTest">
					<template #icon>
						<NcLoadingIcon v-if="selfTestRunning" :size="20" />
						<Stethoscope v-else :size="20" />
					</template>
					{{ t('Run sidecar self-test') }}
				</NcButton>
			</div>

			<NcNoteCard v-if="selfTest" :type="selfTest.ok ? 'success' : 'error'">
				{{ selfTest.text }}
			</NcNoteCard>

			<p class="scoreview-hint">
				{{ t('The self-test converts a small bundled score and checks that MuseScore still returns what the app expects. Run it after changing the MuseScore version in the sidecar image.') }}
			</p>
		</NcSettingsSection>
	</div>
</template>

<script>
import axios from '@nextcloud/axios'
import { loadState } from '@nextcloud/initial-state'
import { translate } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import NcLoadingIcon from '@nextcloud/vue/components/NcLoadingIcon'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import NcPasswordField from '@nextcloud/vue/components/NcPasswordField'
import NcSettingsSection from '@nextcloud/vue/components/NcSettingsSection'
import NcTextField from '@nextcloud/vue/components/NcTextField'
import ContentSave from 'vue-material-design-icons/ContentSave.vue'
import Refresh from 'vue-material-design-icons/Refresh.vue'
import Stethoscope from 'vue-material-design-icons/Stethoscope.vue'

/**
 * Admin-Einstellungen (Codereview-Befund C3). Ersetzt 163 Zeilen
 * handgeschriebenes DOM (`getElementById` + `fetch` + das globale
 * `OC`-Objekt) und ein Template mit `style="width: 320px"` an jedem Feld.
 *
 * E5 hatte fuer den Viewer bereits entschieden, dass Tastaturbedienung,
 * Fokusfuehrung, Theming und Dark Mode nicht von Hand nachgebaut werden -
 * die Einstellungsseite wurde damals nur nicht mitgenommen. Alle Bausteine
 * waren also schon da; neu ist nur `@nextcloud/initial-state` fuer den
 * Startzustand.
 *
 * Der Startzustand kommt ueber `IInitialState` (Settings\AdminSettings) statt
 * ueber eine zusaetzliche GET-Route: der Server rendert die Seite ohnehin,
 * eine zweite Runde nur fuer vier Felder waere verschenkt. Das Secret ist
 * dabei bewusst NICHT enthalten - nur die Angabe, ob eines gesetzt ist.
 */
export default {
	name: 'AdminSettings',

	components: {
		NcButton,
		NcCheckboxRadioSwitch,
		NcLoadingIcon,
		NcNoteCard,
		NcPasswordField,
		NcSettingsSection,
		NcTextField,
		ContentSave,
		Refresh,
		Stethoscope,
	},

	data() {
		const initial = loadState('scoreview', 'admin-settings')
		return {
			initial,
			form: {
				sidecarUrl: initial.sidecarUrl,
				// Immer leer: leer heisst beim Speichern "unveraendert lassen",
				// nicht "loeschen" (siehe SettingsController::update()).
				sidecarSecret: '',
				eagerConversion: initial.eagerConversion,
				soundFontUrl: initial.soundFontUrl,
			},

			saving: false,
			// '' | 'ok' | 'error'
			saveState: '',
			saveError: '',
			health: null,
			healthLoading: false,
			healthError: '',
			selfTestRunning: false,
			selfTest: null,
		}
	},

	computed: {
		secretPlaceholder() {
			return this.initial.sidecarSecretSet
				? t('••••••• (set, leave empty = unchanged)')
				: t('not set yet')
		},

		/**
		 * Die vier Diagnosezeilen. Bewusst als computed und nicht beim Abruf
		 * zusammengebaut, damit die Beschriftungen bei einem Sprachwechsel
		 * mitgehen und die Abruffunktion nur Daten holt.
		 *
		 * @return {Array<{label: string, detail: string, ok: boolean}>}
		 */
		healthLines() {
			const h = this.health
			if (!h) {
				return []
			}
			const c = h.conversions
			const stuck = (c.pending || 0) + (c.processing || 0)
			return [
				{
					label: t('Conversion service'),
					ok: h.sidecar.reachable,
					detail: h.sidecar.reachable ? h.sidecar.url : (h.sidecar.error || t('not configured')),
				},
				{
					label: t('SoundFont'),
					...this.soundFontLine(h.soundFont),
				},
				{
					label: t('Background jobs (cron)'),
					ok: h.cron.healthy,
					detail: h.cron.healthy
						? t('mode {mode}, last run {age}', { mode: h.cron.mode, age: this.humanAge(h.cron.ageSeconds) })
						: t('no run in the last 15 minutes ({age}) – conversions will stay pending', { age: this.humanAge(h.cron.ageSeconds) }),
				},
				{
					label: t('Conversions'),
					// Nur dann ein Problem, wenn etwas haengt UND der Cron tot
					// ist - ausstehende Konvertierungen bei laufendem Cron sind
					// schlicht Arbeit in der Warteschlange.
					ok: !(stuck > 0 && !h.cron.healthy),
					detail: t('{ready} ready, {pending} pending, {failed} failed', {
						ready: c.ready || 0,
						pending: stuck,
						failed: c.error || 0,
					}),
				},
			]
		},
	},

	mounted() {
		this.loadHealth()
	},

	methods: {
		t,

		/**
		 * Wiedergabe ist auch dann moeglich, wenn der Sidecar gerade nicht
		 * erreichbar ist - solange eine Kopie im Cache liegt. Frueher stand
		 * hier bei unerreichbarem Sidecar ein ✓ neben der rohen
		 * cURL-Fehlermeldung, eine Zeile, die sich selbst widersprach.
		 *
		 * @param {object} sf h.soundFont aus dem Health-Endpunkt
		 * @return {{ok: boolean, detail: string}}
		 */
		soundFontLine(sf) {
			const ok = !!(sf.cached || sf.availableInSidecar || sf.overrideUrl)
			if (sf.overrideUrl) {
				return { ok, detail: t('custom URL configured') }
			}
			if (sf.availableInSidecar) {
				return { ok, detail: sf.name || '' }
			}
			if (sf.cached) {
				return { ok, detail: t('cached copy in use (conversion service currently unreachable)') }
			}
			return { ok, detail: sf.error || t('no SoundFont available') }
		},

		/**
		 * @param {?number} seconds Alter in Sekunden, null wenn nie gelaufen
		 * @return {string}
		 */
		humanAge(seconds) {
			if (seconds === null || seconds === undefined) {
				return t('never')
			}
			if (seconds < 60) {
				return t('{n} s ago', { n: seconds })
			}
			return t('{n} min ago', { n: Math.floor(seconds / 60) })
		},

		async save() {
			this.saving = true
			this.saveState = ''
			try {
				await axios.post(generateUrl('/apps/scoreview/api/settings'), this.form)
				this.saveState = 'ok'
				if (this.form.sidecarSecret !== '') {
					this.initial.sidecarSecretSet = true
					this.form.sidecarSecret = ''
				}
				// Die Einstellungen aendern genau das, was die Diagnose misst -
				// sie gleich mit nachziehen, statt den Admin auf "Aktualisieren"
				// zu schicken.
				this.loadHealth()
			} catch (err) {
				this.saveState = 'error'
				this.saveError = err.response?.data?.error || err.message
			} finally {
				this.saving = false
			}
		},

		async loadHealth() {
			this.healthLoading = true
			this.healthError = ''
			try {
				const res = await axios.get(generateUrl('/apps/scoreview/api/health'))
				this.health = res.data
			} catch (err) {
				this.healthError = err.response?.data?.error || err.message
			} finally {
				this.healthLoading = false
			}
		},

		async runSelfTest() {
			// Dauert eine echte Konvertierung lang (~8s gemessen) - deshalb ein
			// sichtbarer Zwischenstand statt eines scheinbar toten Knopfes.
			this.selfTestRunning = true
			this.selfTest = null
			try {
				const res = await axios.post(generateUrl('/apps/scoreview/api/selftest'))
				const r = res.data
				const d = r.details || {}
				this.selfTest = {
					ok: r.ok,
					text: r.ok
						? t('MuseScore {version} works as expected ({pages} page(s), {events} events, {seconds} s)', {
								version: d.musescoreVersion || '?',
								pages: d.pages,
								events: d.events,
								seconds: d.seconds,
							})
						: (r.error || t('Self-test failed.')),
				}
			} catch (err) {
				this.selfTest = { ok: false, text: t('Error: {message}', { message: err.response?.data?.error || err.message }) }
			} finally {
				this.selfTestRunning = false
			}
		},
	},
}

// Einzelargument-Wrapper um @nextcloud/l10n translate(), wie in den anderen
// Komponenten - haelt das Extraktionsmuster von tools/l10n.mjs gueltig.
function t(text, vars) {
	return translate('scoreview', text, vars)
}
</script>

<style scoped>
/* NcSettingsSection setzt die Breite und Abstaende der Sektion; hier bleibt
   nur der Rhythmus INNERHALB des Formulars. Die feste `width: 320px` an
   jedem Feld aus der handgeschriebenen Fassung ist damit weg - die Felder
   folgen jetzt der Sektionsbreite. */
.scoreview-field {
	margin-block-end: 12px;
	max-width: 480px;
}

.scoreview-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-block: 12px;
}

.scoreview-hint {
	color: var(--color-text-maxcontrast);
	max-width: 60em;
}
</style>
