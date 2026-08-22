import ScoreViewer from './components/ScoreViewer.vue'

// Geladen nur auf der Files-Seite (siehe
// Listener\FilesLoadAdditionalScriptsListener) - Öffnen einer .mscz aus
// Files nutzt so die bestehende Files-UI statt eines eigenen
// Navigations-Eintrags (laut Plan ist ausschließlich Viewer-Integration
// vorgesehen).
OCA.Viewer.registerHandler({
	id: 'scoreview',
	mimes: ['application/x-musescore'],
	component: ScoreViewer,
})
