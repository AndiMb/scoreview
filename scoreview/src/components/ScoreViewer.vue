<template>
	<div class="scoreview-viewer">
		<div v-if="state === 'converting' || state === 'loading'" class="scoreview-status">
			{{ state === 'loading' ? 'Wird geladen…' : 'Wird konvertiert…' }}
		</div>
		<div v-else-if="state === 'error'" class="scoreview-status scoreview-error">
			Fehler: {{ errorMessage }}
		</div>
		<template v-else>
			<audio ref="audioEl" controls class="scoreview-audio" />
			<div ref="osmdContainer" class="scoreview-osmd" />
		</template>
	</div>
</template>

<script>
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay'
import { generateUrl } from '@nextcloud/router'
import axios from '@nextcloud/axios'
import { useScoreSync } from '../composables/useScoreSync.js'

const POLL_INTERVAL_MS = 2000

export default {
	name: 'ScoreViewer',

	props: {
		// Von OCA.Viewer übergeben (siehe registerHandler in src/viewer.js).
		fileid: {
			type: [Number, String],
			required: true,
		},
	},

	data() {
		return {
			// loading | converting | ready | error
			state: 'loading',
			errorMessage: '',
			osmd: null,
			sync: null,
			pollTimer: null,
			autoRetried: false,
		}
	},

	watch: {
		fileid: {
			immediate: true,
			handler() {
				this.reset()
				this.pollStatus()
			},
		},
	},

	beforeUnmount() {
		this.cleanup()
	},

	methods: {
		reset() {
			this.cleanup()
			this.state = 'loading'
			this.errorMessage = ''
			this.autoRetried = false
		},

		cleanup() {
			if (this.pollTimer) {
				clearTimeout(this.pollTimer)
				this.pollTimer = null
			}
			if (this.sync) {
				this.sync.stop()
				this.sync = null
			}
			this.osmd = null
		},

		async pollStatus() {
			let body
			try {
				const res = await axios.get(generateUrl('/apps/scoreview/api/scores/{fileId}/status', { fileId: this.fileid }))
				body = res.data
			} catch (err) {
				this.state = 'error'
				this.errorMessage = err.message
				return
			}

			if (body.status === 'ready') {
				this.state = 'ready'
				await this.$nextTick()
				await this.loadScore(body.files)
			} else if (body.status === 'error') {
				this.state = 'error'
				this.errorMessage = body.error || 'Unbekannter Fehler bei der Konvertierung.'
				// Der Status-Endpunkt stößt bei einem gespeicherten Fehler selbst
				// schon einen erneuten Versuch an (z.B. nach einem Sidecar-
				// Konfigurationsfix). Einmalig automatisch nachschauen, ob der
				// gerade lief und erfolgreich war, statt dass der Nutzer die
				// Datei manuell neu öffnen muss. Begrenzt auf einen Versuch,
				// damit ein dauerhaft kaputtes Setup nicht endlos weiterpollt.
				if (!this.autoRetried) {
					this.autoRetried = true
					this.pollTimer = setTimeout(() => this.pollStatus(), POLL_INTERVAL_MS)
				}
			} else {
				this.state = 'converting'
				this.pollTimer = setTimeout(() => this.pollStatus(), POLL_INTERVAL_MS)
			}
		},

		async loadScore(files) {
			try {
				const [musicXmlText, timingRes] = await Promise.all([
					axios.get(files.musicxml, { responseType: 'text' }).then((r) => r.data),
					axios.get(files.timingJson),
				])

				this.osmd = new OpenSheetMusicDisplay(this.$refs.osmdContainer, {
					autoResize: true,
					followCursor: true,
					drawTitle: true,
				})
				await this.osmd.load(musicXmlText)
				this.osmd.render()

				this.$refs.audioEl.src = files.audio

				this.sync = useScoreSync(this.osmd, this.$refs.audioEl, timingRes.data.events)
			} catch (err) {
				this.state = 'error'
				this.errorMessage = err.message
			}
		},
	},
}
</script>

<style scoped>
.scoreview-viewer {
	width: 100%;
	height: 100%;
	overflow: auto;
	box-sizing: border-box;
	padding: 12px;
	background: var(--color-main-background);
}

.scoreview-status {
	padding: 3rem 1rem;
	text-align: center;
	color: var(--color-text-maxcontrast);
}

.scoreview-error {
	color: var(--color-error);
}

.scoreview-audio {
	width: 100%;
	margin-bottom: 12px;
}
</style>
