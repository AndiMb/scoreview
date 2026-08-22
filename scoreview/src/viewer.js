import { createApp, h } from 'vue'
import ScoreViewer from './components/ScoreViewer.vue'

// Nextclouds Viewer-App bündelt einen "_plugin-vue2_normalizer"-Chunk
// (apps/viewer/js/) und ruft registrierte Komponenten über deren
// instanzbasierte render()-Methode auf - das ist mit einer per
// SFC-<template> kompilierten Vue-3-Komponente NICHT kompatibel: deren
// kompilierte render(_ctx, _cache)-Funktion bekommt dabei kein _ctx
// übergeben und stürzt beim ersten Property-Zugriff ab ("Cannot read
// properties of undefined (reading 'state')").
//
// Deshalb hier nur ein minimaler, Vue-Version-agnostischer Wrapper
// (reines render(), kein <template>, keine Reaktivität außer props),
// der selbst einen komplett unabhängigen Vue-3-App-Baum (unsere eigene,
// gebündelte Vue-Instanz) in seinen eigenen Root-DOM-Knoten mountet -
// vollständig getrennt von Viewers eigenem Render-/Reaktivitäts-Baum.
// Geladen nur auf der Files-Seite (siehe
// Listener\FilesLoadAdditionalScriptsListener) - Öffnen einer .mscz aus
// Files nutzt so die bestehende Files-UI statt eines eigenen
// Navigations-Eintrags.
const ScoreViewerWrapper = {
	name: 'ScoreViewerWrapper',

	props: {
		fileid: {
			type: [Number, String],
			required: true,
		},
	},

	render() {
		return h('div', { style: 'width:100%;height:100%' })
	},

	mounted() {
		this.mountInner()
	},

	// beforeDestroy (Vue 2) und beforeUnmount (Vue 3) - je nachdem, welche
	// Laufzeit die Komponente tatsächlich instanziiert, greift nur eine der
	// beiden; unbekannte Optionsnamen werden von der jeweils anderen
	// Laufzeit einfach ignoriert.
	beforeDestroy() {
		this.unmountInner()
	},
	beforeUnmount() {
		this.unmountInner()
	},

	watch: {
		fileid() {
			this.unmountInner()
			this.mountInner()
		},
	},

	methods: {
		mountInner() {
			this.innerApp = createApp(ScoreViewer, { fileid: this.fileid })
			this.innerApp.mount(this.$el)
		},
		unmountInner() {
			if (this.innerApp) {
				this.innerApp.unmount()
				this.innerApp = null
			}
		},
	},
}

OCA.Viewer.registerHandler({
	id: 'scoreview',
	mimes: ['application/x-musescore'],
	component: ScoreViewerWrapper,
})
