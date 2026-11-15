import { DefaultType, registerFileAction } from '@nextcloud/files'
import { generateUrl } from '@nextcloud/router'
import { createApp, h, nextTick } from 'vue'
import { translate } from './l10n.js'
import { isSetlistFile } from './lib/scoreFile.js'
import { registerScoreFileAction, registerScoreHandler } from './lib/scoreHandler.js'
import { firstPlayableIndex } from './lib/setlistNav.js'

import './publicPath.js'

// Einzelargument-Wrapper um translate(), wie in jeder Komponente - das
// Extraktionswerkzeug sucht nach genau diesem Aufrufmuster
// (siehe tools/l10n.mjs).
const t = (text, vars) => translate('scoreview', text, vars)

/**
 * The viewer, loaded on first use (viewerUi.js). One promise for the page:
 * opening a second score does not load it again.
 *
 * @type {?Promise<{ScoreModal: object, ScoreViewer: object}>}
 */
let viewerUi = null
function loadViewerUi() {
	viewerUi ??= import(/* webpackChunkName: "viewer-ui" */ './viewerUi.js').catch((err) => {
		// A failed load (network) may succeed on the next click.
		viewerUi = null
		throw err
	})
	return viewerUi
}

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
		async mountInner() {
			// Unmounting or a file change while the chunk loads makes this
			// mount obsolete.
			const token = this.mountToken = (this.mountToken ?? 0) + 1
			let ScoreViewer
			try {
				({ ScoreViewer } = await loadViewerUi())
			} catch (err) {
				// eslint-disable-next-line no-console
				console.error('ScoreView: could not load the viewer.', err)
				return
			}
			if (token !== this.mountToken || !this.$el?.parentNode) {
				return
			}
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
			this.mountToken = (this.mountToken ?? 0) + 1
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

// Abgesichert (siehe lib/scoreHandler.js): Fehlt `OCA.Viewer`, soll der
// TypeError nicht das ganze Modul mitreissen, und mit ihm den zweiten Einstieg
// (E6), der genau fuer solche Instanzen da ist.
registerScoreHandler(ScoreViewerWrapper)

// ---------------------------------------------------------------------------
// Zweiter Einstieg: eine Dateiaktion auf der Endung
// ---------------------------------------------------------------------------
// Der Handler oben greift nur, wenn die Datei MSCZ_MIME traegt. Dafuer
// sorgt die App selbst (lib/Service/MimetypeRegistration.php), aber mit
// zwei Luecken: Eine frisch hochgeladene Partitur wird von Nextcloud
// weiterhin als application/octet-stream erkannt und erst vom
// Background-Job berichtigt, und wo dieser Weg gar nicht lief - Update noch
// nicht eingespielt, kein Cron, ein Fehler im Log - bleibt es dabei.
//
// Die Aktion schaltet sich deshalb genau dort ein, wo Viewer die Datei
// NICHT aufmacht: Endung `.mscz`, aber ein anderer Mimetype. Wo die
// Registrierung sitzt, aendert sich nichts - kein zweiter Menueintrag,
// kein zweiter Standard, keine Doppelbehandlung.

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

/**
 * @param {?(number|string)} fileid die Partitur; null nur mit einer Setliste ohne spielbares Stueck
 * @param {string} name Ueberschrift
 * @param {{setlistId?: number, setlistData?: object}} [setlist] Weg 1
 */
let modalToken = 0

async function openModal(fileid, name, setlist = {}) {
	// Ein zweites Modal ueber dem ersten waere ein Zustand ohne Ausweg.
	closeModal()
	const token = ++modalToken
	let ScoreModal
	try {
		({ ScoreModal } = await loadViewerUi())
	} catch (err) {
		// eslint-disable-next-line no-console
		console.error('ScoreView: could not load the viewer.', err)
		return
	}
	// A second click while loading: the later one wins.
	if (token !== modalToken) {
		return
	}

	modalEl = document.createElement('div')
	document.body.appendChild(modalEl)

	modalApp = createApp(ScoreModal, {
		fileid,
		name,
		setlistId: setlist.setlistId ?? null,
		setlistData: setlist.setlistData ?? null,
		// Erst nach dem laufenden Ereignis abbauen: NcModal loest `close`
		// aus seinem eigenen Klick-/Tastenhandler aus, und ein Unmount
		// mitten darin zoege dem Handler (samt Fokusfalle) den Baum unter
		// den Fuessen weg.
		onClose: () => nextTick(closeModal),
	})
	modalApp.mount(modalEl)
}

// Die Aktion selbst und ihre doppelte Eintragung (alte und neue
// @nextcloud/files-Staende) stehen in lib/scoreHandler.js, damit der Einstieg
// der oeffentlichen Link-Seite (public.js) dieselbe Bedingung teilt.
registerScoreFileAction(() => t('Open in ScoreView'), (node) => openModal(node.fileid, node.basename))

// ---------------------------------------------------------------------------
// Dritter Einstieg: die Setliste (E6, E11)
// ---------------------------------------------------------------------------
// Eine `*.setlist.md` ist Markdown, und Markdown oeffnet in Files die
// Viewer-Aktion `view` (Text). Ein Klick soll aber das erste Stueck zeigen.
// Gemessen: Files sortiert die Aktionen nach `order` und nimmt
// die erste mit gesetztem `default` - mit `order: -10` gewinnt diese Aktion
// den Klick vor `view` (order 0), und Text bleibt ueber das Menue
// („Ansicht") erreichbar. `order: 0` entschiede die Ladereihenfolge. Das
// Verhalten gehoert zur internen Umsetzung von Files und hat deshalb einen
// Browser-Test in der Abnahme.
//
// DEFAULT statt HIDDEN: HIDDEN gewoenne den Klick ebenso, stuende aber nicht
// im Menue - „Als Setliste oeffnen" soll auffindbar sein.

// MDI `playlist-music` (Apache-2.0).
const SETLIST_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M15,6H3V8H15V6M15,10H3V12H15V10M3,16H11V14H3V16M17,6V14.18C16.69,14.07 16.35,14 16,14A3,3 0 0,0 13,17A3,3 0 0,0 16,20A3,3 0 0,0 19,17V8H22V6H17Z" /></svg>'

const SETLIST_AKTION = {
	id: 'scoreview-open-setlist',
	displayName: () => t('Open as setlist'),
	iconSvgInline: () => SETLIST_ICON,
	default: DefaultType.DEFAULT,
	order: -10,
}

/**
 * Liest die Liste vorab, um das erste spielbare Stueck zu kennen - der
 * Viewer braucht eine Partitur zum Oeffnen. Dieselbe Antwort geht an ihn
 * weiter, damit er sie nicht noch einmal holt; die Vorab-Konvertierung
 * hat der Server dabei schon angestossen.
 *
 * @param {object} node
 * @return {Promise<?boolean>}
 */
async function setlistAusfuehren(node) {
	if (!node?.fileid) {
		return false
	}
	let data
	try {
		// Loaded on demand: this file is the Files entry and runs on every
		// Files page, and the setlist action is the only part of it that
		// talks to the server - axios cost about a fifth of the entry.
		const { default: axios } = await import(/* webpackChunkName: "viewer-ui" */ '@nextcloud/axios')
		data = (await axios.get(generateUrl('/apps/scoreview/api/setlists/{id}', { id: node.fileid }))).data
	} catch (err) {
		// eslint-disable-next-line no-console
		console.error('ScoreView: could not read the setlist.', err)
		return false
	}
	const first = firstPlayableIndex(data.entries)
	openModal(first === null ? null : data.entries[first].fileId, node.basename, {
		setlistId: node.fileid,
		setlistData: data,
	})
	return null
}

registerFileAction({
	...SETLIST_AKTION,
	enabled: ({ nodes }) => nodes.length === 1 && isSetlistFile(nodes[0]),
	exec: ({ nodes }) => setlistAusfuehren(nodes[0]),
})

// Dieselbe doppelte Eintragung wie in lib/scoreHandler.js, aus demselben Grund.
window._nc_fileactions.push({
	...SETLIST_AKTION,
	enabled: (nodes) => nodes.length === 1 && isSetlistFile(nodes[0]),
	exec: (node) => setlistAusfuehren(node),
})
