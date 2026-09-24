import axios from '@nextcloud/axios'
import { generateUrl } from '@nextcloud/router'
import { computed, ref } from 'vue'
import { classify, DIM, HIDE, resolveTargets, targetNames } from '../lib/annotationFilter.js'
import { measurePositionToTimeMs } from '../lib/scoreLayout.js'
import { anchorFromTap } from '../lib/stampLayout.js'

/**
 * Notizen zu einer Partitur: Laden, Anlegen, Ändern, Löschen, Anspringen -
 * und die Koordinaten für die Marker im Notenbild.
 *
 * Erstes von mehreren Composables aus der Zerlegung von `ScoreViewer.vue`.
 * Die Komponente hatte rund 60
 * Datenfelder und 50 Methoden; `reset()` setzte fünfunddreißig davon von
 * Hand zurück - jedes neue Feld war eine Stelle zum Vergessen. Hier gehört
 * der Zustand jetzt zu der Funktion, die ihn braucht, und `reset()` ist Teil
 * davon.
 *
 * Bewusst **kein** Wissen über Wiedergabe: zum Anspringen bekommt das
 * Composable eine `seek`-Funktion und die Taktzeitachse durchgereicht,
 * statt sich einen Player zu greifen. Damit bleibt es ohne Audio testbar und
 * die Abhängigkeitsrichtung eindeutig.
 *
 * @param {object} deps
 * @param {() => (number|string)} deps.fileId aktuelle fileId (Funktion, weil
 *   der Viewer die Datei wechseln kann)
 * @param {() => object|null} deps.timeline `timing.json` (Note-Ebene)
 * @param {() => object|null} deps.measuresTimeline `measures.json` (Takt-Ebene)
 * @param {() => string|null} deps.currentEtag etag der laufenden Konvertierung
 * @param {() => number} deps.durationMs Gesamtdauer für den letzten Takt
 * @param {(timeMs: number) => void} deps.seek springt die Wiedergabe an
 * @param {() => Array} [deps.parts] meta.parts - fuer Stimmnotizen
 * @param {() => ?string} [deps.myPartId] „Meine Stimme"
 * @param {() => boolean} [deps.isLeader] Anzeigehilfe; durchgesetzt wird
 *   die Rolle serverseitig
 */
export function useAnnotations({ fileId, timeline, measuresTimeline, currentEtag, durationMs, seek, parts = () => [], myPartId = () => null, isLeader = () => false }) {
	const annotations = ref([])
	const error = ref('')
	const visible = ref(false)
	// Der Stempel, der auf den naechsten Tipp ins Notenbild wartet (Palette,
	// Symbol, Tipp) - {stamp, visibility, targetParts} oder null.
	const armedStamp = ref(null)

	/**
	 * Jede Notiz mit ihrer Darstellung fuer diese Person (lib/annotationFilter.js):
	 * `display` show/dim/hide, `voices` die Namen der Zielstimmen. Einmal
	 * hier statt je Anzeigeort, damit Liste, Marker und Stempel dieselbe
	 * Antwort geben.
	 */
	const classified = computed(() => {
		const scoreParts = parts() ?? []
		const mine = myPartId()
		const leader = isLeader()
		return annotations.value.map((a) => ({
			...a,
			display: classify(a, mine, scoreParts, leader),
			voices: a.visibility === 'parts' ? targetNames(a, scoreParts) : [],
		}))
	})

	/** Was die Liste zeigt: alles ausser den Notizen fuer andere Stimmen. */
	const listed = computed(() => classified.value.filter((a) => a.display !== HIDE))

	const url = (suffix = '') => generateUrl(
		`/apps/scoreview/api/scores/{fileId}/annotations${suffix}`,
		{ fileId: fileId() },
	)

	/**
	 * Koordinaten je Notiz für die Seiten-Overlays: bevorzugt die exakte Note
	 * (elid, falls noch im aktuellen etag auffindbar), sonst die
	 * Takt-Koordinate als Näherung - eine Notiz bleibt so auch nach einem
	 * Re-Upload sichtbar positionierbar, nur etwas gröber (siehe
	 * docs/architecture.md zum Anker-Design).
	 */
	const markers = computed(() => {
		const notes = timeline()
		const measures = measuresTimeline()
		if (!notes || !measures) {
			return []
		}
		return listed.value
			// Stempel zeichnet ScoreStamps.vue als Symbol - ein Marker mit
			// Aufklapptext waere genau das, was ein Stempel nicht sein soll: er gehoert sichtbar in die Noten.
			.filter((a) => a.kind !== 'stamp')
			.map((a) => {
				const rect = (a.elid !== null && a.anchorEtag === currentEtag() ? notes.elements[String(a.elid)] : null)
					?? measures.elements[String(a.measureNumber - 1)]
				// mine/visibility fuers Marker-Styling in ScorePage.vue: eigene
				// und geteilte Notizen sollen unterscheidbar sein. `content`
				// kommt mit, weil der Text auf Wunsch IM Notenbild steht und
				// nicht nur im Panel - "In Takt 10 bitte forte" muss beim
				// Singen lesbar sein, ohne etwas aufzuklappen.
				// `dimmed`/`voices` fuer Stimmnotizen ohne gewaehlte Stimme:
				// zurueckgenommen und mit dem Namen der Stimme.
				return rect
					? { id: a.id, mine: a.mine, visibility: a.visibility, content: a.content, dimmed: a.display === DIM, voices: a.voices, ...rect }
					: null
			})
			.filter(Boolean)
	})

	/**
	 * Die Stempel fuer ScoreStamps.vue: Taktrechteck immer, das
	 * Notenrechteck nur, wenn elid UND etag noch passen (sonst stuende der
	 * Stempel an der Stelle einer anderen Note). Die Zielstimmen als Index in
	 * meta.parts - so, wie die Notenzeilen im System stehen (staffBands.js).
	 */
	const stamps = computed(() => {
		const notes = timeline()
		const measures = measuresTimeline()
		if (!notes || !measures) {
			return []
		}
		const scoreParts = parts() ?? []
		return listed.value
			.filter((a) => a.kind === 'stamp')
			.map((a) => {
				const measureRect = measures.elements[String(a.measureNumber - 1)] ?? null
				if (!measureRect) {
					return null
				}
				const elementRect = a.elid !== null && a.elid !== undefined && a.anchorEtag === currentEtag()
					? (notes.elements[String(a.elid)] ?? null)
					: null
				return {
					id: a.id,
					stamp: a.stamp,
					content: a.content,
					dimmed: a.display === DIM,
					voices: a.voices,
					page: measureRect.page,
					fraction: a.fraction,
					measureRect,
					elementRect,
					targetIndices: a.visibility === 'parts'
						? resolveTargets(a, scoreParts).map((part) => scoreParts.indexOf(part))
						: [],
				}
			})
			.filter(Boolean)
	})

	async function load() {
		try {
			const res = await axios.get(url())
			annotations.value = res.data
		} catch (err) {
			// Notizen sind eine Zusatzfunktion - ein Fehler hier soll die
			// eigentliche Notenansicht nicht mit in den Fehlerzustand reißen.
			// eslint-disable-next-line no-console
			console.error('ScoreView: Notizen konnten nicht geladen werden.', err)
		}
	}

	async function create(draft) {
		error.value = ''
		try {
			const res = await axios.post(url(), {
				measureNumber: draft.measureNumber,
				fraction: draft.fraction,
				elid: draft.elid,
				anchorEtag: draft.anchorEtag,
				content: draft.content,
				visibility: draft.visibility,
				kind: draft.kind ?? 'text',
				stamp: draft.stamp ?? null,
				targetParts: draft.visibility === 'parts' ? draft.targetParts : null,
			})
			annotations.value = [...annotations.value, { ...res.data, orphaned: false }]
		} catch (err) {
			// eslint-disable-next-line no-console
			console.error('ScoreView: Notiz konnte nicht gespeichert werden.', err)
			error.value = err.response?.data?.error || err.message
		}
	}

	async function update({ id, content, targetParts = null }) {
		error.value = ''
		try {
			const res = await axios.put(`${url()}/${id}`, targetParts ? { content, targetParts } : { content })
			annotations.value = annotations.value.map((a) => (a.id === id ? { ...a, ...res.data } : a))
		} catch (err) {
			// eslint-disable-next-line no-console
			console.error('ScoreView: Notiz konnte nicht aktualisiert werden.', err)
			error.value = err.response?.data?.error || err.message
		}
	}

	async function remove(annotation) {
		error.value = ''
		try {
			await axios.delete(`${url()}/${annotation.id}`)
			annotations.value = annotations.value.filter((a) => a.id !== annotation.id)
		} catch (err) {
			// eslint-disable-next-line no-console
			console.error('ScoreView: Notiz konnte nicht gelöscht werden.', err)
			error.value = err.response?.data?.error || err.message
		}
	}

	function jumpTo(annotation) {
		const measures = measuresTimeline()
		if (!measures) {
			return
		}
		const timeMs = measurePositionToTimeMs(measures, annotation.measureNumber, annotation.fraction, durationMs())
		if (timeMs !== null) {
			seek(timeMs)
		}
	}

	function jumpToById(id) {
		const annotation = annotations.value.find((a) => a.id === id)
		if (annotation) {
			jumpTo(annotation)
		}
	}

	/**
	 * Einen Stempel zum Setzen bereitlegen - der naechste Tipp ins Notenbild
	 * setzt ihn (placeArmedStamp).
	 *
	 * @param {{stamp:string, visibility:string, targetParts:?Array}} spec
	 */
	function armStamp(spec) {
		armedStamp.value = spec
	}

	function disarmStamp() {
		armedStamp.value = null
	}

	/**
	 * Setzt den bereitgelegten Stempel an die getippte Stelle. Ein Tipp neben
	 * jeden Takt setzt nichts und laesst den Stempel bereit - daneben getippt
	 * ist kein Grund, von vorn anzufangen.
	 *
	 * @param {{page:number, x:number, y:number}} tap SVG-Einheiten der Seite
	 * @return {Promise<boolean>} ob gesetzt wurde
	 */
	async function placeArmedStamp({ page, x, y }) {
		const spec = armedStamp.value
		const measures = measuresTimeline()
		if (!spec || !measures) {
			return false
		}
		const anchor = anchorFromTap(measures.elements, page, x, y)
		if (anchor === null) {
			return false
		}
		armedStamp.value = null
		await create({
			...anchor,
			elid: null,
			anchorEtag: currentEtag(),
			content: '',
			kind: 'stamp',
			stamp: spec.stamp,
			visibility: spec.visibility,
			targetParts: spec.targetParts,
		})
		return true
	}

	function reset() {
		annotations.value = []
		error.value = ''
		visible.value = false
		armedStamp.value = null
	}

	return { annotations, listed, error, visible, markers, stamps, armedStamp, load, create, update, remove, jumpTo, jumpToById, armStamp, disarmStamp, placeArmedStamp, reset }
}
