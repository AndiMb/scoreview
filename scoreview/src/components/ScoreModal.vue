<!--
	Der zweite Einstieg in den Viewer - ohne Nextclouds Viewer-App.

	Der reguläre Weg läuft über OCA.Viewer und damit über den Mimetype
	`application/x-musescore`. Den trägt die App zwar selbst ein
	(lib/Service/MimetypeRegistration.php), aber nicht lückenlos: Eine frisch
	hochgeladene Partitur erkennt Nextcloud weiterhin als
	application/octet-stream und wird erst vom Background-Job berichtigt, und wo
	dieser Weg gar nicht lief - Update noch nicht eingespielt, kein Cron, ein
	Fehler im Log - bleibt es dabei. Ohne diesen zweiten Weg wäre die Partitur
	dann unerreichbar.

	Deshalb hier dieselbe Komponente in einem eigenen Vollbild-Modal, geöffnet
	über eine Dateiaktion auf der Dateiendung (siehe viewer.js).

	Derselbe Rahmen öffnet auch eine Setliste (Weg 1, E11): dann mit
	`setlistId`, und das Stück wechselt im Viewer selbst. Hat die Liste (noch)
	kein spielbares Stück, gibt es nichts zu zeigen außer dem Editor - wer
	eine frisch angelegte, leere Liste anklickt, soll sie füllen können.
-->
<template>
	<!--
		`closeButtonOutside` ist hier kein Geschmack, sondern die Reparatur einer
		Überdeckung: Ohne das Attribut setzt NcModal sein Schließkreuz absolut in
		die rechte obere Ecke des INHALTS – und genau dort steht der letzte Knopf
		der Bedienleiste (gemessen: beide auf demselben Fleck, Kreuz und
		Vollbildzeichen übereinandergezeichnet). Draußen sitzt es in der
		Kopfzeile neben dem Dateinamen, also dort, wo Nextclouds Viewer-App es
		auf dem regulären Weg ohnehin hat – beide Einstiege sehen damit gleich
		aus.
	-->
	<NcModal
		size="full"
		:name="heading"
		closeButtonOutside
		@close="$emit('close')">
		<div v-if="currentFileId !== null" class="scoreview-modal">
			<ScoreViewer
				:fileid="currentFileId"
				:setlistId="setlistId"
				:setlistData="currentSetlist"
				@pieceChange="piece = $event" />
		</div>
		<div v-else class="scoreview-modal scoreview-modal--editor">
			<NcNoteCard type="info">
				{{ t('This setlist has no score you can open yet. Add scores and save.') }}
			</NcNoteCard>
			<SetlistEditor
				mode="edit"
				:setlist="currentSetlist"
				@saved="onSaved"
				@cancel="$emit('close')" />
		</div>
	</NcModal>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import NcModal from '@nextcloud/vue/components/NcModal'
import NcNoteCard from '@nextcloud/vue/components/NcNoteCard'
import ScoreViewer from './ScoreViewer.vue'
import SetlistEditor from './SetlistEditor.vue'
import { firstPlayableIndex } from '../lib/setlistNav.js'

export default {
	name: 'ScoreModal',

	components: {
		NcModal,
		NcNoteCard,
		ScoreViewer,
		SetlistEditor,
	},

	props: {
		// null nur mit einer Setliste ohne spielbares Stueck (siehe oben).
		fileid: {
			type: [Number, String],
			default: null,
		},

		/** Der Dateiname als Überschrift - Material aus der Partitur, nicht übersetzt. */
		name: {
			type: String,
			default: '',
		},

		setlistId: {
			type: [Number, String],
			default: null,
		},

		/** Die schon gelesene Liste (GET /api/setlists/{id}), siehe viewer.js. */
		setlistData: {
			type: Object,
			default: null,
		},
	},

	emits: ['close'],

	data() {
		return {
			currentFileId: this.fileid,
			currentSetlist: this.setlistData,
			// Das offene Stueck der Setliste, gemeldet vom Viewer.
			piece: null,
		}
	},

	computed: {
		/**
		 * Mit Setliste „Konzert Herbst – Ave verum": Der Dateiname der Liste
		 * sagte beim Blaettern nichts darueber, welches Stueck offen ist.
		 * Beides ist Material aus Liste und Datei, nicht uebersetzt.
		 *
		 * @return {string}
		 */
		heading() {
			return this.piece ? `${this.piece.setlistTitle} – ${this.piece.label}` : this.name
		},
	},

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		/**
		 * Die leere Liste wurde gefuellt: jetzt mit dem ersten spielbaren
		 * Stueck in den Viewer.
		 *
		 * @param {object} data Antwort von PUT /api/setlists/{id}
		 */
		onSaved(data) {
			this.currentSetlist = data
			const first = firstPlayableIndex(data.entries)
			if (first !== null) {
				this.currentFileId = data.entries[first].fileId
			}
		},
	},
}
</script>

<style scoped>
/*
	Der Viewer misst seine Seitenbreite an seinem Elternknoten (ScorePage.vue)
	und braucht deshalb eine echte Höhe, keine aus dem Inhalt gewachsene -
	sonst hat er beim ersten Layout 0 Pixel und skaliert das Notenbild auf
	nichts.
*/
.scoreview-modal {
	display: flex;
	width: 100%;
	height: 100%;
	min-height: 0;
}

.scoreview-modal--editor {
	flex-direction: column;
	gap: 8px;
	max-width: 640px;
	margin: 0 auto;
	padding: 16px;
	overflow-y: auto;
}

.scoreview-modal > :deep(.scoreview-viewer) {
	flex: 1 1 auto;
	min-width: 0;
}
</style>
