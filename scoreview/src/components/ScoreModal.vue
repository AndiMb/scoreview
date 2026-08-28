<!--
	Der zweite Einstieg in den Viewer - ohne Nextclouds Viewer-App.

	Der reguläre Weg läuft über OCA.Viewer und damit über den registrierten
	Mimetype `application/x-musescore`. Dessen Registrierung ist server-weit
	(config/mimetypemapping.json + occ maintenance:mimetype:update-db) und auf
	verwaltetem Hosting schlicht nicht durchführbar; dazu kommt, dass sie für
	bereits hochgeladene Dateien erst nach einem occ files:scan greift. In
	beiden Fällen bliebe die Partitur ohne diesen Weg unerreichbar.

	Deshalb hier dieselbe Komponente in einem eigenen Vollbild-Modal, geöffnet
	über eine Dateiaktion auf der Dateiendung (siehe viewer.js).
-->
<template>
	<NcModal
		size="full"
		:name="name"
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
