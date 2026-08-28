import { DefaultType, registerFileAction } from '@nextcloud/files'
import { translate } from '@nextcloud/l10n'
import { createApp, h, nextTick } from 'vue'
import ScoreModal from './components/ScoreModal.vue'
import ScoreViewer from './components/ScoreViewer.vue'
import { MSCZ_MIME, needsOwnFileAction } from './lib/scoreFile.js'

// Einzelargument-Wrapper um translate(), wie in jeder Komponente - das
// Extraktionswerkzeug sucht nach genau diesem Aufrufmuster
// (siehe tools/l10n.mjs).
const t = (text, vars) => translate('scoreview', text, vars)

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
		// Von Viewer per :loaded.sync übergeben (siehe Viewer.vue). Solange
		// wir dafür nie ein update:loaded auslösen, bleibt Viewers eigener
		// Lade-Spinner dauerhaft über dem Inhalt liegen - selbst wenn unser
		// eigener Inhalt (inkl. unserer eigenen "Wird konvertiert…"/
		// Fehler-Anzeige) längst sichtbar sein könnte.
		loaded: {
			type: Boolean,
			default: false,
		},
	},

	emits: ['update:loaded'],

	render() {
		return h('div', { style: 'width:100%;height:100%' })
	},

	mounted() {
		this.mountInner()
		// Sofort, nicht erst nach Abschluss der Konvertierung: unsere eigene
		// Komponente zeigt ihren eigenen "Wird konvertiert…"/Fehler-Zustand
		// bereits an - Viewers generischer Spinner soll dem Platz machen,
		// statt ihn zu verdecken.
		this.$emit('update:loaded', true)
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
			// this.$el kann - je nachdem, wie Viewers (separate) Vue-Instanz
			// unser Wrapper-VNode tatsächlich interpretiert - ein reiner
			// Kommentar-Platzhalterknoten statt eines echten <div> sein und
			// dann kein appendChild unterstützen ("HierarchyRequestError").
			// Direkt daneben in den echten Elternknoten einfügen umgeht das,
			// unabhängig vom genauen Knotentyp von this.$el selbst - jeder
			// bereits gemountete Knoten hat einen gültigen parentNode.
			this.$el.parentNode.insertBefore(this.mountEl, this.$el.nextSibling)

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
	mimes: [MSCZ_MIME],
	component: ScoreViewerWrapper,
})

// ---------------------------------------------------------------------------
// Zweiter Einstieg: eine Dateiaktion auf der Endung
// ---------------------------------------------------------------------------
// Der Handler oben greift nur, wenn `.mscz` server-weit als MSCZ_MIME
// registriert ist. Diese Registrierung laesst sich nicht aus einer App
// heraus vornehmen - Nextcloud liest mimetypemapping.json ausschliesslich
// aus config/ - und sie braucht anschliessend `occ`. Auf verwaltetem
// Hosting ist beides nicht verfuegbar, und selbst auf einer eigenen
// Instanz bleiben bereits hochgeladene Dateien bis zu einem
// `occ files:scan` auf application/octet-stream stehen.
//
// Die Aktion schaltet sich deshalb genau dort ein, wo Viewer die Datei
// NICHT aufmacht: Endung `.mscz`, aber ein anderer Mimetype. Wo die
// Registrierung sitzt, aendert sich nichts - kein zweiter Menueintrag,
// kein zweiter Standard, keine Doppelbehandlung.

// MDI `music-clef-treble` (Apache-2.0), als Zeichenkette statt als
// Vue-Komponente: registerFileAction verlangt fertiges SVG.
const CLEF_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M13 11V7.5L15.2 5.29C16 4.5 16.15 3.24 15.59 2.26C15.14 1.47 14.32 1 13.45 1C13.24 1 13 1.03 12.81 1.09C11.73 1.38 11 2.38 11 3.5V6.74L7.86 9.91C6.2 11.6 5.7 14.13 6.61 16.34C7.38 18.24 9.06 19.55 11 19.89V20.5C11 20.76 10.77 21 10.5 21H9V23H10.5C11.85 23 13 21.89 13 20.5V20C15.03 20 17.16 18.08 17.16 15.25C17.16 12.95 15.24 11 13 11M13 3.5C13 3.27 13.11 3.09 13.32 3.03C13.54 2.97 13.77 3.06 13.88 3.26C14 3.46 13.96 3.71 13.8 3.87L13 4.73V3.5M11 11.5C10.03 12.14 9.3 13.24 9.04 14.26L11 14.78V17.83C9.87 17.53 8.9 16.71 8.43 15.57C7.84 14.11 8.16 12.45 9.26 11.33L11 9.5V11.5M13 18V12.94C14.17 12.94 15.18 14.04 15.18 15.25C15.18 17 13.91 18 13 18Z" /></svg>'

let modalApp = null
let modalEl = null

function closeModal() {
	if (modalApp) {
		modalApp.unmount()
		modalApp = null
	}
	modalEl?.remove()
	modalEl = null
}

function openModal(fileid, name) {
	// Ein zweites Modal ueber dem ersten waere ein Zustand ohne Ausweg.
	closeModal()

	modalEl = document.createElement('div')
	document.body.appendChild(modalEl)

	modalApp = createApp(ScoreModal, {
		fileid,
		name,
		// Erst nach dem laufenden Ereignis abbauen: NcModal loest `close`
		// aus seinem eigenen Klick-/Tastenhandler aus, und ein Unmount
		// mitten darin zoege dem Handler (samt Fokusfalle) den Baum unter
		// den Fuessen weg.
		onClose: () => nextTick(closeModal),
	})
	modalApp.mount(modalEl)
}

// Die Aktion selbst - einmal fuer beide Staende von @nextcloud/files
// beschrieben, damit sich die Bedingung nicht doppelt.
const AKTION = {
	id: 'scoreview-open',
	displayName: () => t('Open in ScoreView'),
	iconSvgInline: () => CLEF_ICON,
	// Ein Klick auf die Datei soll sie oeffnen, nicht die Details aufklappen.
	default: DefaultType.DEFAULT,
	order: -10,
}

async function aktionAusfuehren(node) {
	if (!node?.fileid) {
		return false
	}
	openModal(node.fileid, node.basename)
	// null = die Aktion meldet nichts zurueck; ein `true` liesse Files eine
	// Erfolgsmeldung einblenden, obwohl gerade nur ein Fenster aufgegangen ist.
	return null
}

registerFileAction({
	...AKTION,
	enabled: ({ nodes }) => nodes.length === 1 && needsOwnFileAction(nodes[0]),
	exec: ({ nodes }) => aktionAusfuehren(nodes[0]),
})

// Aeltere Staende fuehren dieselbe Liste als globales Array `_nc_fileactions`
// und rufen die Rueckrufe mit `(nodes, view)` statt mit einem Kontextobjekt
// auf - dieselbe Aktion, andere Form. Gemessen an Nextcloud 34: dort gibt es
// `_nc_files_scope.v4_0`, und das Array liest niemand mehr. Fehlt der neue
// Ort, ist es umgekehrt, und ohne diesen Zweig bliebe die Aktion dort
// unsichtbar (kein Fehler, keine Meldung - sie taete einfach nichts).
if (!window._nc_files_scope?.v4_0) {
	window._nc_fileactions = window._nc_fileactions || []
	window._nc_fileactions.push({
		...AKTION,
		enabled: (nodes) => nodes.length === 1 && needsOwnFileAction(nodes[0]),
		exec: (node) => aktionAusfuehren(node),
	})
}
