<!--
	Die Offline-Seite (E14, H9): die Liste des Vorgemerkten und, beim Oeffnen,
	derselbe ScoreViewer wie in Files - mit `offline`, damit er weglaesst, was
	den Server braucht.

	Sie ist kein zweiter Einstieg in Partituren: Was hier steht, hat jemand in
	diesem Browser vorgemerkt, und nur die angemeldete Person sieht ihre
	Eintraege (S10).
-->
<template>
	<div class="scoreview-offline">
		<header class="scoreview-offline-bar">
			<NcButton
				v-if="opened"
				variant="tertiary"
				:aria-label="t('Back to the list')"
				:title="t('Back to the list')"
				@click="opened = null">
				<template #icon>
					<ArrowLeft :size="20" />
				</template>
			</NcButton>
			<h1 class="scoreview-offline-title">
				<!-- Ein Titel aus der Partitur: Material, nicht uebersetzt (E4). -->
				{{ opened ? opened.title : t('Saved for offline use') }}
			</h1>
			<span v-if="!online" class="scoreview-offline-badge">{{ t('Offline') }}</span>
		</header>

		<div v-if="opened" class="scoreview-offline-body">
			<ScoreViewer
				:key="`${opened.type}-${opened.id}`"
				:fileid="opened.first ?? opened.id"
				:setlistId="opened.type === 'setlist' ? opened.id : null"
				offline />
		</div>

		<main v-else class="scoreview-offline-list">
			<NcNoteCard v-if="!supported" type="warning">
				{{ t('This browser cannot keep scores for offline use.') }}
			</NcNoteCard>
			<template v-else>
				<p v-if="loading" class="scoreview-offline-hint">
					{{ t('Loading…') }}
				</p>
				<NcEmptyContent
					v-else-if="entries.length === 0"
					:name="t('Nothing saved for offline use yet')"
					:description="t('Open a score or setlist in Files and choose “Save for offline use” in the View group.')" />
				<ul v-else>
					<li v-for="entry in entries" :key="`${entry.type}-${entry.id}`" class="scoreview-offline-entry">
						<div class="scoreview-offline-entry-text">
							<strong>{{ entry.title }}</strong>
							<span class="scoreview-offline-hint">
								{{ entry.type === 'setlist' ? t('Setlist with {count} pieces', { count: entry.members?.length ?? 0 }) : t('Score') }}
								· {{ megabytes(entry.bytes) }}
								· {{ stateLabel(entry) }}
							</span>
						</div>
						<NcButton
							:disabled="entry.missing > 0"
							variant="primary"
							@click="opened = entry">
							{{ t('Open') }}
						</NcButton>
						<NcButton
							variant="tertiary"
							:aria-label="t('Remove')"
							:title="t('Remove')"
							@click="removeEntry(entry)">
							<template #icon>
								<Delete :size="20" />
							</template>
						</NcButton>
					</li>
				</ul>
				<p v-if="entries.length > 0" class="scoreview-offline-hint">
					{{ t('{size} used in total.', { size: megabytes(totalBytes) }) }}
				</p>
				<NcNoteCard v-if="persisted === false && entries.length > 0" type="info">
					{{ t('The browser may delete these files when space runs low. Check again before a concert.') }}
				</NcNoteCard>
			</template>
		</main>
	</div>
</template>

<script>
import { loadState } from '@nextcloud/initial-state'
import { translate } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcEmptyContent from '@nextcloud/vue/components/NcEmptyContent'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import ArrowLeft from 'vue-material-design-icons/ArrowLeft.vue'
import Delete from 'vue-material-design-icons/Delete.vue'
import ScoreViewer from './ScoreViewer.vue'
import { offlineSupported, useOffline } from '../composables/useOffline.js'
import { withAppVersion } from '../lib/assetVersion.js'

const t = (text, vars) => translate('scoreview', text, vars)

const page = (() => {
	try {
		return loadState('scoreview', 'offline')
	} catch {
		return {}
	}
})()

export default {
	name: 'OfflineApp',

	components: {
		ArrowLeft,
		Delete,
		NcButton,
		NcEmptyContent,
		NcNoteCard,
		ScoreViewer,
	},

	setup() {
		return { store: useOffline({ uid: () => page.uid ?? '' }) }
	},

	data() {
		return {
			supported: offlineSupported(),
			loading: true,
			entries: [],
			// Schluessel `${type}-${id}` -> 'checking' | 'current' | 'updated' | 'offline'
			states: {},
			opened: null,
			online: navigator.onLine,
			persisted: null,
		}
	},

	computed: {
		/** Das geteilte SoundFont einmal, nicht je Eintrag (useOffline.js). */
		totalBytes() {
			const own = this.entries.reduce((sum, e) => sum + (e.bytes ?? 0), 0)
			return own + Math.max(0, ...this.entries.map((e) => e.sharedBytes ?? 0))
		},
	},

	async mounted() {
		window.addEventListener('online', this.onOnline)
		window.addEventListener('offline', this.onOffline)
		if (!this.supported) {
			this.loading = false
			return
		}
		this.registerWorker()
		this.persisted = await navigator.storage?.persisted?.().catch(() => null) ?? null
		await this.load()
		if (this.online) {
			await this.refreshAll()
		}
	},

	beforeUnmount() {
		window.removeEventListener('online', this.onOnline)
		window.removeEventListener('offline', this.onOffline)
	},

	methods: {
		t,

		async registerWorker() {
			try {
				await navigator.serviceWorker.register(withAppVersion(page.serviceWorker, SCOREVIEW_APP_VERSION), { scope: page.scope })
				await navigator.serviceWorker.ready
				// Beim ersten Besuch hat die Seite ihre Skripte schon geladen,
				// bevor der Worker sie sah - die Liste geht deshalb ausdruecklich
				// an ihn, sobald er steuert (V8).
				const send = () => navigator.serviceWorker.controller?.postMessage({
					type: 'precache',
					urls: [window.location.href, ...performance.getEntriesByType('resource').map((e) => e.name)],
				})
				if (navigator.serviceWorker.controller) {
					send()
				} else {
					navigator.serviceWorker.addEventListener('controllerchange', send, { once: true })
				}
			} catch {
				// Ohne Worker bleibt die Liste nutzbar, solange Netz da ist.
			}
		},

		async load() {
			try {
				this.entries = await this.store.ownEntries()
			} catch {
				this.entries = []
			}
			this.loading = false
		},

		/** Beim Oeffnen online: jeden Eintrag auf den neuesten Stand bringen (D15). */
		async refreshAll() {
			for (const entry of this.entries) {
				const key = `${entry.type}-${entry.id}`
				this.states = { ...this.states, [key]: 'checking' }
				const state = await this.store.refresh(entry)
				this.states = { ...this.states, [key]: state }
				// `navigator.onLine` meldet nur, ob ein Netz da ist, nicht ob der
				// Server erreichbar ist (Captive Portal, VPN weg) - eine
				// gescheiterte Pruefung sagt das verlaesslicher.
				if (state === 'offline') {
					this.online = false
				}
			}
			await this.load()
		},

		async removeEntry(entry) {
			await this.store.remove(entry.type, entry.id)
			await this.load()
		},

		stateLabel(entry) {
			if (entry.missing > 0) {
				return t('Removed by the browser – save it again')
			}
			switch (this.states[`${entry.type}-${entry.id}`]) {
				case 'checking':
					return t('Checking…')
				case 'updated':
					return t('Updated')
				case 'current':
					return t('Up to date')
				default:
					return t('May be outdated')
			}
		},

		megabytes(bytes) {
			return t('{size} MB', { size: ((bytes ?? 0) / 1e6).toFixed(1) })
		},

		onOnline() {
			this.online = true
			this.refreshAll()
		},

		onOffline() {
			this.online = false
		},
	},
}
</script>

<style>
/* Wie die eigenstaendige Seite (StandaloneFrame.vue): ein Flex-Eintrag, der
   nicht unter seinen Inhalt schrumpfen darf, und ohne den Rand fuer die
   Kopfleiste, die es hier nicht gibt. */
#scoreview-offline {
	flex: 1 1 auto;
	min-inline-size: 0;
	inline-size: 100%;
}

#body-public #content.app-public {
	margin: 0;
	padding: 0;
	block-size: 100%;
}
</style>

<style scoped>
.scoreview-offline {
	display: flex;
	flex-direction: column;
	block-size: 100%;
	inline-size: 100%;
	overflow: hidden;
	background-color: var(--color-main-background);
}

.scoreview-offline-bar {
	display: flex;
	align-items: center;
	gap: 8px;
	padding-inline: 12px;
	padding-block: 4px;
	min-block-size: 44px;
	border-block-end: 1px solid var(--color-border);
	flex: 0 0 auto;
}

.scoreview-offline-title {
	flex: 1 1 auto;
	min-inline-size: 0;
	margin: 0;
	font-size: 1rem;
	font-weight: bold;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.scoreview-offline-badge {
	padding-inline: 8px;
	border-radius: var(--border-radius-pill);
	background-color: var(--color-warning);
	color: var(--color-primary-element-text);
}

.scoreview-offline-body {
	display: flex;
	flex: 1 1 auto;
	min-block-size: 0;
}

.scoreview-offline-body > :deep(.scoreview-viewer) {
	flex: 1 1 auto;
	min-inline-size: 0;
}

.scoreview-offline-list {
	overflow-y: auto;
	padding: 12px;
	max-inline-size: 720px;
	inline-size: 100%;
	margin-inline: auto;
}

.scoreview-offline-entry {
	display: flex;
	align-items: center;
	gap: 8px;
	padding-block: 8px;
	border-block-end: 1px solid var(--color-border);
}

.scoreview-offline-entry-text {
	display: flex;
	flex: 1 1 auto;
	flex-direction: column;
	min-inline-size: 0;
}

.scoreview-offline-hint {
	color: var(--color-text-maxcontrast);
}
</style>
