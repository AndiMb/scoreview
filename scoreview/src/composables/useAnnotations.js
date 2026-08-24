import axios from '@nextcloud/axios'
import { generateUrl } from '@nextcloud/router'
import { computed, ref } from 'vue'
import { measurePositionToTimeMs } from '../lib/scoreLayout.js'

/**
 * Notizen zu einer Partitur: Laden, Anlegen, Ändern, Löschen, Anspringen -
 * und die Koordinaten für die Marker im Notenbild.
 *
 * Erstes von mehreren Composables aus der Zerlegung von `ScoreViewer.vue`
 * (Codereview-Befund B1, Phase 23/Schritt 6). Die Komponente hatte rund 60
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
 */
export function useAnnotations({ fileId, timeline, measuresTimeline, currentEtag, durationMs, seek }) {
	const annotations = ref([])
	const error = ref('')
	const visible = ref(false)

	const url = (suffix = '') => generateUrl(
		`/apps/scoreview/api/scores/{fileId}/annotations${suffix}`,
		{ fileId: fileId() },
	)

	/**
	 * Koordinaten je Notiz für die Seiten-Overlays: bevorzugt die exakte Note
	 * (elid, falls noch im aktuellen etag auffindbar), sonst die
	 * Takt-Koordinate als Näherung - eine Notiz bleibt so auch nach einem
	 * Re-Upload sichtbar positionierbar, nur etwas gröber (siehe PLAN.md
	 * Phase 11 zum Anker-Design).
	 */
	const markers = computed(() => {
		const notes = timeline()
		const measures = measuresTimeline()
		if (!notes || !measures) {
			return []
		}
		return annotations.value
			.map((a) => {
				const rect = (a.elid !== null && a.anchorEtag === currentEtag() ? notes.elements[String(a.elid)] : null)
					?? measures.elements[String(a.measureNumber - 1)]
				// mine/visibility fuers Marker-Styling in ScorePage.vue (Phase
				// 18: eigene und geteilte Notizen sollen unterscheidbar sein).
				return rect ? { id: a.id, mine: a.mine, visibility: a.visibility, ...rect } : null
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
			})
			annotations.value = [...annotations.value, { ...res.data, orphaned: false }]
		} catch (err) {
			// eslint-disable-next-line no-console
			console.error('ScoreView: Notiz konnte nicht gespeichert werden.', err)
			error.value = err.response?.data?.error || err.message
		}
	}

	async function update({ id, content }) {
		error.value = ''
		try {
			const res = await axios.put(`${url()}/${id}`, { content })
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

	function reset() {
		annotations.value = []
		error.value = ''
		visible.value = false
	}

	return { annotations, error, visible, markers, load, create, update, remove, jumpTo, jumpToById, reset }
}
