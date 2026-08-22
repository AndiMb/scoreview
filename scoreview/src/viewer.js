import { createApp, h } from 'vue'
import ScoreViewer from './components/ScoreViewer.vue'

// Nextclouds Viewer-App bündelt ihre eigene, separate Kopie von Vue 3
// (jede NC-App bündelt ihre eigene Vue-Instanz, siehe
// @nextcloud/webpack-vue-config - "vue" wird bewusst nicht als externals
// geteilt). Ein direkt bei OCA.Viewer.registerHandler registriertes
// SFC-<template> stürzte dadurch schon beim ersten Rendern ab (Viewers
// Vue-Instanz instanziiert/rendert die Komponente, aber deren kompilierte
// render(_ctx, _cache)-Funktion wurde gegen UNSERE Vue-Instanz kompiliert -
// zwei getrennte Vue-3-Kopien im selben Baum sind nicht kompatibel).
//
// Deshalb hier nur ein minimaler, framework-neutraler Wrapper (reines
// render(), kein <template>, keine Reaktivität außer props), der selbst
// einen komplett unabhängigen Vue-3-App-Baum (unsere eigene Vue-Instanz)
// mountet - und zwar NICHT auf seinem eigenen Root-Element (this.$el),
// das gehört weiterhin Viewers Vue-Instanz und darf nicht von einer
// zweiten Instanz mitverwaltet werden (führte zu
// "HierarchyRequestError: Failed to execute 'insertBefore' on 'Node'",
// weil beide Instanzen dieselbe DOM-Node eigenständig zu patchen
// versuchten). Stattdessen ein selbst erzeugter Kind-Knoten, von Viewers
// Vue-Baum nie gesehen (reine, von Vue unabhängige DOM-Manipulation).
//
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
			this.mountEl = document.createElement('div')
			this.mountEl.style.width = '100%'
			this.mountEl.style.height = '100%'
			this.$el.appendChild(this.mountEl)

			this.innerApp = createApp(ScoreViewer, { fileid: this.fileid })
			this.innerApp.mount(this.mountEl)
		},
		unmountInner() {
			if (this.innerApp) {
				this.innerApp.unmount()
				this.innerApp = null
			}
			if (this.mountEl?.parentNode) {
				this.mountEl.parentNode.removeChild(this.mountEl)
			}
			this.mountEl = null
		},
	},
}

OCA.Viewer.registerHandler({
	id: 'scoreview',
	mimes: ['application/x-musescore'],
	component: ScoreViewerWrapper,
})
