import axios from '@nextcloud/axios'
import { translate } from '@nextcloud/l10n'
import { generateFilePath, generateUrl } from '@nextcloud/router'
import { ref, shallowRef } from 'vue'
import { withAppVersion } from '../lib/assetVersion.js'
import { buildExportPlan, plansForAllParts } from '../lib/exportPlan.js'
import { practiceTrackName } from '../lib/practiceTrackName.js'

const t = (text, vars) => translate('scoreview', text, vars)

// Ein eigener Webpack-Einstieg (webpack.config.js), versioniert wie das
// Worklet des Players - sonst haenge nach einem Update der alte im Cache.
const WORKER_URL = withAppVersion(generateFilePath('scoreview', 'js', 'scoreview-render-worker.js'), SCOREVIEW_APP_VERSION)

/**
 * Uebe-Track als MP3 in Files (H1) und Tracks fuer alle Stimmen (H10).
 *
 * Gerendert wird im Browser (workers/renderWorker.js), gespeichert ueber
 * Controller\PracticeTrackController. Die Mischung kommt aus dem, was gerade
 * an den Player ging (usePlayback.currentMix) - der Track klingt wie das,
 * was man eben gehoert hat.
 *
 * Abbrechen beendet den Worker; ein angefangener Upload laeuft zu Ende, eine
 * halbe Datei entsteht so nicht (F1.5). Bei „alle Stimmen" bleiben die schon
 * gespeicherten Tracks.
 *
 * @param {object} deps
 * @param {() => number} deps.fileId
 * @param {() => ?ArrayBuffer} deps.midi eine Kopie des MIDI der Partitur
 * @param {() => Promise<?ArrayBuffer>} deps.soundFont
 * @param {() => object} deps.mix usePlayback.currentMix()
 * @param {() => object} deps.base weitere Eingaben fuer buildExportPlan:
 *   transpose, rate, measures, durationMs, baseBpm
 * @param {() => {title: string, composer: string}} deps.score
 * @param {() => ?string} deps.myPartName
 * @param {() => boolean} deps.coach
 * @param {() => Array} deps.mixerChannels
 * @param {() => Array<{partId: string, name: string}>} deps.parts
 * @param {() => number} deps.othersLevel
 * @return {object}
 */
export function usePracticeExport(deps) {
	const running = ref(false)
	// {stage: 'render'|'encode'|'upload', p: 0..1, index?, count?, part?}
	const progress = ref(null)
	const error = ref('')
	// Nach einem Namenskonflikt: {name, suggested, job} - der Dialog fragt dann
	const conflict = shallowRef(null)
	const saved = ref([])
	let worker = null
	let cancelled = false

	const labels = () => ({ fullMix: t('Full mix'), coach: t('Coach'), loop: t('Excerpt') })

	function cancel() {
		cancelled = true
		worker?.terminate()
		worker = null
		running.value = false
		progress.value = null
	}

	/**
	 * @param {object} options
	 * @param {boolean} options.metronome mit Klick
	 * @param {boolean} options.everyBeat jeder Schlag statt nur die Eins
	 * @param {?{fromMs: number, toMs: number}} options.range nur der Loop
	 * @param {'folder'|'own'} options.target
	 * @param {?number} options.ownFolder
	 * @param {?string} [options.name] Name statt des Vorschlags
	 * @param {boolean} [options.replace]
	 */
	async function exportOne(options) {
		const base = deps.base()
		const plan = buildExportPlan({
			...deps.mix(),
			...base,
			range: options.range ?? null,
			metronome: options.metronome ? { everyBeat: options.everyBeat } : null,
		})
		const part = deps.myPartName()
		const name = options.name ?? practiceTrackName({
			title: deps.score().title,
			part,
			coach: deps.coach(),
			tempoPercent: base.rate * 100,
			transpose: base.transpose,
			loop: options.range !== null && options.range !== undefined,
		}, labels())
		await run([{ name, plan, part }], { target: options.target, ownFolder: options.ownFolder, replace: options.replace === true, retry: options })
	}

	/**
	 * Je Stimme ein Coach-Track in den Unterordner (H10). Ersetzt vorhandene -
	 * wer neu erzeugt, will die alten nicht daneben liegen haben.
	 *
	 * @param {{metronome: boolean, everyBeat: boolean}} options
	 */
	async function exportAllParts(options) {
		const base = deps.base()
		const plans = plansForAllParts({
			mixerChannels: deps.mixerChannels(),
			parts: deps.parts(),
			othersLevel: deps.othersLevel(),
			programs: deps.mix().programs,
			base: { ...base, metronome: options.metronome ? { everyBeat: options.everyBeat } : null },
		})
		const jobs = plans.map(({ name, plan }) => ({
			name: practiceTrackName({ title: deps.score().title, part: name, coach: true, tempoPercent: base.rate * 100, transpose: base.transpose }, labels()),
			plan,
			part: name,
		}))
		await run(jobs, { target: 'sub', ownFolder: null, replace: true, retry: null })
	}

	async function run(jobs, { target, ownFolder, replace, retry }) {
		const midi = deps.midi()
		const soundFont = await deps.soundFont()
		if (!midi || !soundFont) {
			error.value = t('The sound is not loaded yet.')
			return
		}
		cancelled = false
		running.value = true
		error.value = ''
		conflict.value = null
		saved.value = []
		try {
			for (let i = 0; i < jobs.length && !cancelled; i++) {
				const job = jobs[i]
				const mp3 = await renderInWorker({
					midi: midi.slice(0),
					soundFont: soundFont.slice(0),
					plan: job.plan,
					tags: { title: job.name.replace(/\.mp3$/i, ''), artist: deps.score().composer, album: deps.score().title, comment: job.part ?? '' },
				}, (stage, p) => {
					progress.value = { stage, p, index: i + 1, count: jobs.length, part: job.part }
				})
				if (cancelled) {
					break
				}
				progress.value = { stage: 'upload', p: 0, index: i + 1, count: jobs.length, part: job.part }
				const result = await upload(mp3, job.name, target, ownFolder, replace)
				if (result.conflict) {
					conflict.value = { name: job.name, suggested: result.suggested, retry }
					break
				}
				saved.value = [...saved.value, result]
			}
		} catch (err) {
			error.value = err?.response?.data?.error ?? err?.message ?? String(err)
		} finally {
			worker?.terminate()
			worker = null
			running.value = false
			progress.value = null
		}
	}

	function renderInWorker(job, onProgress) {
		return new Promise((resolve, reject) => {
			worker = new Worker(WORKER_URL)
			worker.onmessage = ({ data }) => {
				if (data.type === 'progress') {
					onProgress(data.stage, data.p)
				} else if (data.type === 'done') {
					resolve(data.mp3)
				} else if (data.type === 'error') {
					reject(new Error(data.message))
				}
			}
			worker.onerror = (e) => reject(new Error(e.message || 'Worker failed'))
			worker.postMessage(job, [job.midi, job.soundFont])
		})
	}

	async function upload(mp3, name, target, ownFolder, replace) {
		const params = new URLSearchParams({ name, target, replace: replace ? '1' : '0' })
		if (ownFolder !== null && ownFolder !== undefined) {
			params.set('ownFolder', String(ownFolder))
		}
		const url = generateUrl('/apps/scoreview/api/scores/{fileId}/practice-tracks', { fileId: deps.fileId() }) + '?' + params.toString()
		try {
			const res = await axios.post(url, mp3, { headers: { 'Content-Type': 'audio/mpeg' } })
			return res.data
		} catch (err) {
			if (err?.response?.status === 409 && err.response.data?.reason === 'exists') {
				return { conflict: true, suggested: err.response.data.suggested ?? null }
			}
			throw err
		}
	}

	/**
	 * Nach einem Konflikt: ersetzen oder unter dem Vorschlag speichern.
	 *
	 * @param {'replace'|'rename'} how
	 */
	async function resolveConflict(how) {
		const c = conflict.value
		if (!c?.retry) {
			conflict.value = null
			return
		}
		conflict.value = null
		await exportOne({ ...c.retry, name: how === 'rename' ? c.suggested : c.name, replace: how === 'replace' })
	}

	return { running, progress, error, conflict, saved, exportOne, exportAllParts, resolveConflict, cancel }
}
