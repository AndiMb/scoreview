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
		:name="name"
		closeButtonOutside
		@close="$emit('close')">
		<div class="scoreview-modal">
			<ScoreViewer :fileid="fileid" />
		</div>
	</NcModal>
</template>

<script>
import NcModal from '@nextcloud/vue/components/NcModal'
import ScoreViewer from './ScoreViewer.vue'

export default {
	name: 'ScoreModal',

	components: {
		NcModal,
		ScoreViewer,
	},

	props: {
		fileid: {
			type: [Number, String],
			required: true,
		},

		/** Der Dateiname als Überschrift - Material aus der Partitur, nicht übersetzt. */
		name: {
			type: String,
			default: '',
		},
	},

	emits: ['close'],
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

.scoreview-modal > :deep(.scoreview-viewer) {
	flex: 1 1 auto;
	min-width: 0;
}
</style>
