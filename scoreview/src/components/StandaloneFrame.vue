<!--
	Der dritte Einstieg in den Viewer - eine Seite, die fuer sich steht.

	Die mobilen Nextcloud-Apps laden keine Skripte der Dateien-Seite und kennen
	Nextclouds Weboberflaeche nicht; weder der regulaere Weg ueber OCA.Viewer
	noch die Dateiaktion aus viewer.js erreicht sie. Ihr einziger Zugang ist
	Nextclouds Direct Editing: Die App oeffnet die Seite des registrierten
	Editors in einer Vollbild-WebView (siehe DirectEditing\ScoreDirectEditor).

	Die Kopfzeile ist dabei keine Kosmetik. In den beiden anderen Einstiegen
	stellt der Wirt das Schliesskreuz - Nextclouds Viewer-App bzw. das NcModal
	mit `closeButtonOutside` -, und ScoreViewer.vue hat dafuer weder Knopf noch
	Ereignis. Ohne eigene Kopfzeile gaebe es hier keinen Weg hinaus.
-->
<template>
	<div class="scoreview-standalone">
		<header class="scoreview-standalone-bar">
			<!-- Der Dateiname: Material aus der Partitur, nicht uebersetzt (E4). -->
			<h1 class="scoreview-standalone-name" :title="name">
				{{ name }}
			</h1>
			<NcButton
				v-if="schliessbar"
				variant="tertiary"
				:aria-label="t('Close')"
				:title="t('Close')"
				@click="schliessen">
				<template #icon>
					<Close :size="20" />
				</template>
			</NcButton>
		</header>

		<div class="scoreview-standalone-body">
			<ScoreViewer :fileid="fileid" @ready="melde" />
		</div>
	</div>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import NcButton from '@nextcloud/vue/components/NcButton'
import Close from 'vue-material-design-icons/Close.vue'
import ScoreViewer from './ScoreViewer.vue'
import { createBridge } from '../lib/mobileBridge.js'

const t = (text, vars) => translate('scoreview', text, vars)

export default {
	name: 'StandaloneFrame',

	components: {
		Close,
		NcButton,
		ScoreViewer,
	},

	props: {
		fileid: {
			type: [Number, String],
			required: true,
		},

		/** Der Dateiname fuer die Kopfzeile. */
		name: {
			type: String,
			default: '',
		},
	},

	setup() {
		return { bruecke: createBridge(window) }
	},

	computed: {
		/**
		 * Ein Kreuz, das nichts tut, ist schlimmer als keins: In der App endet
		 * es die Activity, im Browser geht es in der Historie zurueck - und wo
		 * es weder das eine noch das andere gibt (direkt geoeffneter Link),
		 * bleibt es aus.
		 */
		schliessbar() {
			return this.bruecke.verfuegbar || window.history.length > 1
		},
	},

	mounted() {
		// Die App zeigt ihren eigenen Ladezustand, solange der Viewer noch
		// pollt oder konvertiert.
		this.bruecke.loading()
	},

	methods: {
		t,

		/**
		 * Der Ladebildschirm der App verschwindet erst, wenn hier wirklich
		 * etwas steht - Notenbild oder Fehlermeldung. Vorzeitig gerufen laege er
		 * bei laufender Konvertierung minutenlang ueber einem leeren Viewer,
		 * und nach zehn Sekunden meldete die App zusaetzlich einen Timeout.
		 */
		melde() {
			this.bruecke.loaded()
		},

		schliessen() {
			if (this.bruecke.verfuegbar) {
				this.bruecke.close()
				return
			}
			window.history.back()
		},
	},
}
</script>

<!--
	Nicht scoped, und das ist hier kein Versehen: Diese Seite besteht aus
	nichts als dieser Komponente. Was Nextclouds `base`-Renderer um sie herum
	stellt, gehoert deshalb mit zum Layout - und beides darunter ist an einem
	Telefon nachgemessen (412 x 915), nicht geschaetzt.
-->
<style>
/*
	`#content` ist ein Flex-Container, unser Montageknoten also ein
	Flex-Eintrag - und ein Flex-Eintrag schrumpft nicht unter die natuerliche
	Breite seines Inhalts, solange `min-inline-size` auf `auto` steht. Gemessen
	ohne diese Regel: 924 px Knoten in einem 412 px breiten Bild, die Partitur
	rechts abgeschnitten. Der Viewer misst seine Seitenbreite am Elternknoten
	und skalierte das Notenbild entsprechend auf die falsche Breite.
*/
#scoreview-standalone {
	flex: 1 1 auto;
	min-inline-size: 0;
	inline-size: 100%;
}

/*
	Der Rand, den `base` fuer Nextclouds Kopfleiste freihaelt (50 px oben,
	53 px unten), bleibt auf dieser Seite leer: Es gibt hier keine Kopfleiste,
	nur den Viewer. Auf einem Telefon sind das ueber 100 px Bildschirm fuer
	nichts - und das Notenbild ist genau das, wovon man mehr sehen will.
*/
/*
	Zwei IDs, weil eine nicht reicht: Nextclouds eigene Regel dafuer traegt
	`body.layout-base #content` und schlaegt ein blosses `#content.app-public`
	nach Spezifitaet (nachgemessen: der Fusspolster blieb stehen). Faellt der
	Wirt eines Tages anders aus, greift die Regel nicht mehr - dann steht der
	Streifen wieder da, mehr passiert nicht.
*/
#body-public #content.app-public {
	margin: 0;
	padding: 0;
	block-size: 100%;
}
</style>

<style scoped>
/*
	Feste Hoehe statt einer aus dem Inhalt gewachsenen: ScoreViewer misst seine
	Seitenbreite am Elternknoten und skalierte das Notenbild sonst beim ersten
	Layout auf nichts (derselbe Grund wie in ScoreModal.vue).

	`100%` und nicht `100dvh`: Der Wirt (`#content`) haengt bereits fest am
	sichtbaren Bereich (`position: fixed`), er fuehrt die ein- und
	ausfahrende Adress-/Systemleiste der mobilen Browser also schon nach. Ein
	eigenes `dvh` legte sich daneben und stuende beim Ausfahren um die Hoehe
	der Leiste daneben.
*/
.scoreview-standalone {
	display: flex;
	flex-direction: column;
	block-size: 100%;
	inline-size: 100%;
	overflow: hidden;
	background-color: var(--color-main-background);
}

.scoreview-standalone-bar {
	display: flex;
	align-items: center;
	gap: 8px;
	padding-inline: 12px;
	padding-block: 4px;
	border-block-end: 1px solid var(--color-border);
	flex: 0 0 auto;
}

.scoreview-standalone-name {
	flex: 1 1 auto;
	min-inline-size: 0;
	margin: 0;
	font-size: 1rem;
	font-weight: bold;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.scoreview-standalone-body {
	display: flex;
	flex: 1 1 auto;
	min-block-size: 0;
}

.scoreview-standalone-body > :deep(.scoreview-viewer) {
	flex: 1 1 auto;
	min-inline-size: 0;
}
</style>
