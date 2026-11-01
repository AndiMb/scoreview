import axios from '@nextcloud/axios'
import { generateUrl } from '@nextcloud/router'
import { computed, ref } from 'vue'
import { translate } from '../l10n.js'
import { classify, DIM, HIDE, resolveTarget, resolveTargets, targetNames } from '../lib/annotationFilter.js'
import { decodeDrawing, encodeDrawing } from '../lib/drawingLayout.js'
import { measurePositionToTimeMs } from '../lib/scoreLayout.js'
import { serverError } from '../lib/serverError.js'
import { anchorFromTap } from '../lib/stampLayout.js'

const t = (text, vars) => translate('scoreview', text, vars)

/**
 * What a failed write shows. The throttle (S4) answers with Nextcloud's own
 * 429 and no sentence of its own - raw it would read "Request failed with
 * status code 429" - so that case gets a text here; otherwise the server's
 * message (e.g. the per-score limit) wins over the transport's.
 *
 * @param {?object} err
 * @return {string}
 */
function failureText(err) {
	return serverError(err, err?.response?.status === 429
		? t('Too many changes in a short time. Please wait a moment and try again.')
		: (err?.message || ''))
}

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
 * @param deps.pictureElid
 * @param deps.pictureParts
 * @param {() => ?string} [deps.myPartId] „Meine Stimme"
 * @param {() => boolean} [deps.isLeader] Anzeigehilfe; durchgesetzt wird
 *   die Rolle serverseitig
 */
export function useAnnotations({ fileId, timeline, measuresTimeline, currentEtag, durationMs, seek, parts = () => [], pictureParts = parts, pictureElid = (elid) => elid, myPartId = () => null, isLeader = () => false }) {
	const annotations = ref([])
	const error = ref('')
	const visible = ref(false)
	// Der Stempel, der auf den naechsten Tipp ins Notenbild wartet (Palette,
	// Symbol, Tipp) - {stamp, visibility, targetParts} oder null.
	const armedStamp = ref(null)
	// Drawing (E22): who the drawing is for ({visibility, targetParts}), or
	// null while not drawing - and the strokes drawn so far, each with the
	// page's staves ({page, points, systems, mappable}).
	const drawSpec = ref(null)
	const drawStrokes = ref([])
	/**
	 * Von reset() hochgezählt. In der Setliste wechselt die Partitur, während
	 * Anfragen noch laufen - ohne die Prüfung landeten die Notizen von A mit
	 * ihren Ankern in B, eine späte Antwort von load() überschrieb gar die
	 * Liste des neuen Stücks.
	 */
	let generation = 0

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
			// A saved loop is a range to set, not a spot to mark (savedLoops).
			.filter((a) => a.kind !== 'stamp' && a.kind !== 'loop' && a.kind !== 'drawing')
			.map((a) => {
				// The anchor is the base's segment; the picture may be a variant
				// with its own numbering (E19) - pictureElid() translates.
				const rect = (a.elid !== null && a.anchorEtag === currentEtag() ? notes.elements[String(pictureElid(a.elid))] : null)
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
		// Target staves are counted in the picture: a part drawn alone is
		// staff 0 there, and a part not drawn has no staff (E19).
		const drawnIds = (pictureParts() ?? []).map((part) => String(part.id))
		return listed.value
			.filter((a) => a.kind === 'stamp')
			.map((a) => {
				const measureRect = measures.elements[String(a.measureNumber - 1)] ?? null
				if (!measureRect) {
					return null
				}
				const elementRect = a.elid !== null && a.elid !== undefined && a.anchorEtag === currentEtag()
					? (notes.elements[String(pictureElid(a.elid))] ?? null)
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
						? resolveTargets(a, scoreParts).map((part) => drawnIds.indexOf(String(part.id))).filter((i) => i !== -1)
						: [],
				}
			})
			.filter(Boolean)
	})

	/**
	 * The drawings for ScoreDrawings.vue (E22): the measure, and the staff of
	 * the drawing's part counted in the picture on screen. A drawing for a
	 * part that the picture does not draw (another part shown alone, E19) is
	 * not shown there - it would land on a stranger's staff.
	 */
	// Decoded drawings by their stored content. `drawings` recomputes on any
	// change to any annotation - a new text note, a stamp, a part switch - and
	// parsing every drawing's JSON again each time grows with the drawings,
	// not with the change. Rebuilt per run, so deleted drawings drop out.
	let decodedByContent = new Map()
	const drawings = computed(() => {
		const measures = measuresTimeline()
		if (!measures) {
			return []
		}
		const scoreParts = parts() ?? []
		const drawnIds = (pictureParts() ?? []).map((part) => String(part.id))
		const previous = decodedByContent
		decodedByContent = new Map()
		const decode = (content) => {
			const data = previous.has(content) ? previous.get(content) : decodeDrawing(content)
			decodedByContent.set(content, data)
			return data
		}
		return listed.value
			.filter((a) => a.kind === 'drawing')
			.map((a) => {
				const measureRect = measures.elements[String(a.measureNumber - 1)] ?? null
				const data = decode(a.content)
				if (!measureRect || !data) {
					return null
				}
				let staffIndex = null
				if (data.part) {
					const part = resolveTarget(data.part, scoreParts)
					staffIndex = drawnIds.indexOf(String(part?.id ?? data.part.id))
					if (staffIndex === -1) {
						return null
					}
				}
				return {
					id: a.id,
					page: measureRect.page,
					fraction: a.fraction,
					measureRect,
					staffIndex,
					strokes: data.strokes,
					dimmed: a.display === DIM,
					voices: a.voices,
				}
			})
			.filter(Boolean)
	})

	/**
	 * Saved loops (B5): a range of measures with a name, kept like a note -
	 * private, shared, or for parts (leaders), filtered the same way, so a
	 * loop for the altos dims for everyone else and hides from the basses.
	 */
	const savedLoops = computed(() => listed.value
		.filter((a) => a.kind === 'loop' && Number.isFinite(a.endMeasure))
		.map((a) => ({
			id: a.id,
			name: a.content ?? '',
			from: a.measureNumber,
			to: a.endMeasure,
			visibility: a.visibility,
			mine: a.mine,
			authorName: a.authorName ?? null,
			byLeader: a.byLeader === true,
			orphaned: a.orphaned === true,
			dimmed: a.display === DIM,
			voices: a.voices,
		}))
		.sort((a, b) => a.from - b.from || a.to - b.to))

	async function load() {
		const mine = generation
		try {
			const res = await axios.get(url())
			if (mine === generation) {
				annotations.value = res.data
			}
		} catch (err) {
			// Notizen sind eine Zusatzfunktion - ein Fehler hier soll die
			// eigentliche Notenansicht nicht mit in den Fehlerzustand reißen.
			// eslint-disable-next-line no-console
			console.error('ScoreView: could not load the annotations.', err)
		}
	}

	async function create(draft) {
		const mine = generation
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
				endMeasure: draft.endMeasure ?? null,
			})
			if (mine === generation) {
				annotations.value = [...annotations.value, { ...res.data, orphaned: false }]
			}
		} catch (err) {
			// eslint-disable-next-line no-console
			console.error('ScoreView: could not save the annotation.', err)
			if (mine !== generation) {
				return
			}
			error.value = failureText(err)
		}
	}

	async function update({ id, content, targetParts = null }) {
		const mine = generation
		error.value = ''
		try {
			const res = await axios.put(`${url()}/${id}`, targetParts ? { content, targetParts } : { content })
			if (mine === generation) {
				annotations.value = annotations.value.map((a) => (a.id === id ? { ...a, ...res.data } : a))
			}
		} catch (err) {
			// eslint-disable-next-line no-console
			console.error('ScoreView: could not update the annotation.', err)
			if (mine !== generation) {
				return
			}
			error.value = failureText(err)
		}
	}

	async function remove(annotation) {
		const mine = generation
		error.value = ''
		try {
			await axios.delete(`${url()}/${annotation.id}`)
			if (mine === generation) {
				annotations.value = annotations.value.filter((a) => a.id !== annotation.id)
			}
		} catch (err) {
			// eslint-disable-next-line no-console
			console.error('ScoreView: could not delete the annotation.', err)
			if (mine !== generation) {
				return
			}
			error.value = failureText(err)
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
		drawSpec.value = null
		drawStrokes.value = []
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

	/**
	 * Takes up the pen (E22): pointer input on the pages draws until the
	 * drawing is saved or dropped.
	 *
	 * @param {{visibility:string, targetParts:?Array}} spec
	 */
	function startDrawing(spec) {
		armedStamp.value = null
		drawSpec.value = spec
		drawStrokes.value = []
	}

	/** @param {{page:number, points:Array, systems:Array, mappable:boolean}} stroke */
	function addStroke(stroke) {
		if (drawSpec.value && stroke.points.length > 0) {
			drawStrokes.value = [...drawStrokes.value, stroke]
		}
	}

	function undoStroke() {
		drawStrokes.value = drawStrokes.value.slice(0, -1)
	}

	function cancelDrawing() {
		drawSpec.value = null
		drawStrokes.value = []
	}

	/**
	 * Saves what was drawn - one drawing per page, anchored where its first
	 * stroke began. Strokes beside every measure are dropped with a message
	 * rather than stored somewhere else.
	 *
	 * @return {Promise<void>}
	 */
	async function saveDrawing() {
		const spec = drawSpec.value
		const measures = measuresTimeline()
		const strokes = drawStrokes.value
		drawSpec.value = null
		drawStrokes.value = []
		if (!spec || !measures || strokes.length === 0) {
			return
		}
		const byPage = new Map()
		for (const s of strokes) {
			const list = byPage.get(s.page) ?? []
			list.push(s)
			byPage.set(s.page, list)
		}
		let lost = false
		for (const [page, list] of byPage) {
			const encoded = encodeDrawing({
				strokes: list.map((s) => s.points),
				measureElements: measures.elements,
				page,
				systems: list[0].systems,
				mappable: list[0].mappable,
				pictureParts: pictureParts() ?? [],
			})
			if (encoded === null) {
				lost = true
				continue
			}
			await create({
				measureNumber: encoded.measureNumber,
				fraction: encoded.fraction,
				elid: null,
				anchorEtag: currentEtag(),
				content: encoded.content,
				kind: 'drawing',
				visibility: spec.visibility,
				targetParts: spec.targetParts,
			})
		}
		if (lost && error.value === '') {
			error.value = t('A drawing beside the music was not saved. Start it on the staff.')
		}
	}

	function reset() {
		generation++
		annotations.value = []
		error.value = ''
		visible.value = false
		armedStamp.value = null
		drawSpec.value = null
		drawStrokes.value = []
	}

	return { annotations, listed, error, visible, markers, stamps, drawings, savedLoops, armedStamp, drawSpec, drawStrokes, load, create, update, remove, jumpTo, jumpToById, armStamp, disarmStamp, placeArmedStamp, startDrawing, addStroke, undoStroke, cancelDrawing, saveDrawing, reset }
}
