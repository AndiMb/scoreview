import axios from '@nextcloud/axios'
import { generateUrl } from '@nextcloud/router'
import { computed, ref, shallowRef } from 'vue'
import { translate } from '../l10n.js'
import { serverError } from '../lib/serverError.js'
import { firstPlayableIndex, indexOfFile, nextIndex, positionOf, previousIndex } from '../lib/setlistNav.js'

/**
 * Die Setliste im Viewer (E11): welche Liste, welches Stueck,
 * vor und zurueck - und fuer Weg 2 die Listen, die die offene Partitur
 * enthalten.
 *
 * **Das Stueck wechselt IM Viewer**, ueber `setFileId` - nicht dadurch, dass
 * aussen jemand einen neuen Viewer einhaengt. Nur so bleiben
 * Aufführungsmodus, Dunkelmodus und Zoom erhalten, und der SoundFont
 * im Speicher (lib/soundFontCache.js). ScoreViewer.vue haelt dafuer seine
 * eigene `activeFileId`, die hier gesetzt wird.
 *
 * Aufgeloest wird auf dem Server, aus Sicht der Nutzerin
 * (Service\SetlistService); was sie nicht sehen darf, kommt als `missing`
 * und wird beim Blaettern uebersprungen (lib/setlistNav.js).
 *
 * @param {object} deps
 * @param {() => (number|string)} deps.fileId die gerade offene Partitur
 * @param {(fileId: number) => void} deps.setFileId wechselt das Stueck im Viewer
 * @param {() => boolean} deps.standalone eigenstaendige Seite (Mobil)
 * @param {() => (number|string)} [deps.originFileId] die Partitur, mit der die
 *   Seite geoeffnet wurde - auf der eigenstaendigen Seite die Datei ihres
 *   Direct-Editing-Tokens
 * @param {(action: string) => boolean} [deps.can] the interaction policy
 *   (usePerformanceMode.can): paging through the list is `nextPiece` - it
 *   works in performance mode too -, the editor is `settings`
 * @return {object}
 */
export function useSetlist({ fileId, setFileId, standalone, originFileId = fileId, can = () => true }) {
	const t = (text) => translate('scoreview', text)

	// Die geladene Liste, wie GET /api/setlists/{id} sie liefert.
	const setlist = shallowRef(null)
	const index = ref(null)
	const error = ref('')
	// Weg 2: Listen im Ordner der Partitur, die sie enthalten, und ob dort
	// eine neue angelegt werden darf.
	const offers = ref([])
	const offerDismissed = ref(false)
	const folderFileId = ref(null)
	const canCreate = ref(false)
	// The editor card: 'edit' | 'new' | null (closed).
	const editorMode = ref(null)

	// Antworten, die nach einem Stueck- oder Listenwechsel eintreffen, sind
	// veraltet - wie in useLeaders.
	let generation = 0
	let offerGeneration = 0

	const active = computed(() => setlist.value !== null)
	const entries = computed(() => setlist.value?.entries ?? [])
	const position = computed(() => positionOf(entries.value, index.value))
	const current = computed(() => (index.value === null ? null : entries.value[index.value] ?? null))

	/**
	 * Oeffnet eine Liste. Ohne `at` beginnt sie beim ersten spielbaren Stueck
	 * (Weg 1); mit `at` bleibt die offene Partitur, und die Liste setzt
	 * an ihrer Stelle an (Weg 2).
	 *
	 * @param {number|string} setlistId
	 * @param {{at?: number|string, position?: number, data?: object}} [options]
	 *   `data`: schon geladene Liste (der Einstieg aus Files hat sie gelesen,
	 *   um das erste Stueck zu kennen)
	 * @return {Promise<boolean>} ob es ein Stueck zum Zeigen gibt
	 */
	async function open(setlistId, { at = null, position: preferred = null, data = null } = {}) {
		const mine = ++generation
		error.value = ''
		let loaded = data
		if (!loaded) {
			try {
				loaded = (await axios.get(generateUrl('/apps/scoreview/api/setlists/{id}', { id: setlistId }))).data
			} catch (err) {
				if (mine === generation) {
					error.value = serverError(err, t('The setlist could not be loaded.'))
				}
				return false
			}
		}
		if (mine !== generation) {
			return false
		}
		setlist.value = loaded
		const start = at !== null
			? indexOfFile(loaded.entries, at, preferred)
			: firstPlayableIndex(loaded.entries)
		index.value = start
		if (start === null) {
			return false
		}
		show(start)
		return true
	}

	function show(i) {
		index.value = i
		const target = entries.value[i]?.fileId
		if (target !== undefined && target !== null && String(target) !== String(fileId())) {
			setFileId(target)
		}
	}

	/** Naechstes Stueck; fehlende werden uebersprungen. */
	function next() {
		const i = nextIndex(entries.value, index.value ?? -1)
		if (i !== null && can('nextPiece')) {
			show(i)
		}
	}

	function previous() {
		const i = previousIndex(entries.value, index.value ?? -1)
		if (i !== null && can('nextPiece')) {
			show(i)
		}
	}

	/** @param {number} i direkt zu einem Eintrag - nur, wenn er spielbar ist */
	function goTo(i) {
		if (can('nextPiece')) {
			showEntry(i)
		}
	}

	/**
	 * To an entry without asking the policy - for the leader's move to a
	 * piece of the list (H7), which is not an own action of this device.
	 *
	 * @param {number} i
	 */
	function showEntry(i) {
		const entry = entries.value[i]
		if (entry && entry.status === 'ok' && entry.fileId !== null) {
			show(i)
		}
	}

	function close() {
		generation++
		setlist.value = null
		index.value = null
	}

	/**
	 * Opens the editor, or closes it when it is open in this mode already.
	 *
	 * @param {'edit'|'new'} mode
	 */
	function toggleEditor(mode) {
		if (!can('settings')) {
			return
		}
		editorMode.value = editorMode.value === mode ? null : mode
	}

	function closeEditor() {
		editorMode.value = null
	}

	/**
	 * Nach dem Speichern im Editor: die neue Fassung uebernehmen und die
	 * Stelle halten - das offene Stueck bleibt offen, auch wenn es jetzt
	 * woanders in der Liste steht. Gespeichert oder angelegt, die Liste
	 * gilt ab jetzt, auch eine neue - wer eine Setliste anlegt, will sie
	 * gleich benutzen; the editor closes.
	 *
	 * @param {object} data Antwort von PUT/POST
	 */
	function applySaved(data) {
		editorMode.value = null
		generation++
		setlist.value = data
		const here = indexOfFile(data.entries, fileId(), index.value)
		index.value = here ?? firstPlayableIndex(data.entries)
		if (here === null && index.value !== null) {
			show(index.value)
		}
	}

	/**
	 * Weg 2: Welche Listen im Ordner enthalten diese Partitur? Laeuft bei
	 * jedem Stueck, weil dieselbe Antwort sagt, wo „Neue Setliste" anlegt.
	 *
	 * Auf der eigenstaendigen Seite (Mobil) nur fuer die Partitur, mit der
	 * sie geoeffnet wurde: Weitere Stuecke erreicht sie ueber Begleit-Token,
	 * und die gelten bewusst nicht fuer diese Suche (S1).
	 * Neue Listen entstehen dort ohnehin im Ordner dieser Partitur - die
	 * Angaben dazu bleiben also beim Blaettern gueltig.
	 */
	async function loadOffers() {
		const mine = ++offerGeneration
		const id = fileId()
		if (standalone() && String(id) !== String(originFileId())) {
			offers.value = []
			return
		}
		try {
			const res = await axios.get(generateUrl('/apps/scoreview/api/scores/{fileId}/setlists', { fileId: id }))
			if (mine !== offerGeneration) {
				return
			}
			offers.value = res.data.setlists ?? []
			folderFileId.value = res.data.folderFileId ?? null
			canCreate.value = res.data.canCreate === true
		} catch (err) {
			if (mine === offerGeneration) {
				offers.value = []
				canCreate.value = false
			}
			// Nur ein Angebot - die Partitur geht auch ohne.
			// eslint-disable-next-line no-console
			console.error('ScoreView: could not load the setlists for the score.', err)
		}
	}

	/**
	 * Ein Angebot aus Weg 2 annehmen: die Liste an der Stelle der offenen
	 * Partitur oeffnen.
	 *
	 * @param {{id: number, positions?: Array<number>}} offer
	 */
	function acceptOffer(offer) {
		open(offer.id, { at: fileId(), position: offer.positions?.[0] ?? null })
	}

	return {
		setlist,
		index,
		error,
		active,
		entries,
		position,
		current,
		offers,
		offerDismissed,
		folderFileId,
		canCreate,
		editorMode,
		open,
		next,
		previous,
		goTo,
		showEntry,
		close,
		toggleEditor,
		closeEditor,
		applySaved,
		loadOffers,
		acceptOffer,
	}
}
