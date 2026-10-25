import axios from '@nextcloud/axios'
import { ref } from 'vue'
import { createArtifactUrls, createVariantUrls } from '../lib/artifactUrls.js'
import { convertInBrowser, convertVariantInBrowser } from '../lib/clientConversion.js'

/**
 * How many display variants (E19) one tab keeps. Each is a set of pages in
 * memory - a phone's memory is the limit here, not a server's disk.
 */
const MAX_VARIANTS = 3

/**
 * Der Rückfall: Konvertieren im Browser, wo der Server es nicht kann.
 *
 * Das Unreine an dieser Stelle - Netz, dynamischer Import, Blob-URLs und ihr
 * Lebensende. Der Ablauf selbst liegt ohne all das in `lib/clientConversion.js`,
 * die Form des Ergebnisses in `lib/artifactUrls.js`.
 *
 * **Was hier NICHT passiert: speichern.** Auf diesem Weg gibt es keinen
 * Servercache, keine Statuszeile, keinen IAppData-Ordner - das ist die
 * getroffene Entscheidung, nicht eine offene Lücke. Was bleibt, ist ein
 * Sitzungscache mit genau einem Eintrag: Wer dieselbe Partitur noch einmal
 * öffnet, ohne zwischendurch eine andere anzusehen, wartet nicht erneut. Alles
 * darüber hinaus (Cache Storage, IndexedDB) wäre die erste Stelle, an der
 * clientseitig erzeugte Artefakte eine Seite überleben - mit eigener
 * Invalidierung und eigenem Kontingentproblem.
 *
 * **Die Engine wird dynamisch geladen, dieses Modul nicht.** Der Import der
 * Engine (rund 14 MB) steht hinter `import(engineUrl)` und passiert nur, wenn
 * der Rückfall wirklich greift - auf einer gesunden Instanz lädt niemand ein
 * Byte davon. Dieses Modul selbst wiegt ein paar KB und liegt fest im Bundle:
 * ein eigener Webpack-Chunk dafür brächte nichts als eine zweite Anfrage und
 * die Abhängigkeit von einem korrekt geratenen publicPath.
 *
 * @return {{progress: object,
 *   run: (antwort: object, fileId: (number|string)) => Promise<?object>,
 *   release: () => void}}
 */
export function useClientConversion() {
	/** Für die Anzeige: `{phase, page?, of?}` - siehe lib/clientConversion.js. */
	const progress = ref(null)

	/**
	 * Genau ein Eintrag: `{key, files, revoke, antwort, base}` - `antwort`
	 * and `base` (the base's timing and measures) are what a variant of it
	 * needs.
	 */
	let cache = null
	/** Variants of the cached score, oldest first: key -> {files, revoke}. */
	const variants = new Map()
	/**
	 * Läufe zählen, damit ein spät zurückkehrender Lauf nicht die Anzeige
	 * einer inzwischen ganz anderen Partitur überschreibt. Abbrechen lässt
	 * sich eine laufende Konvertierung nicht - die Engine kennt kein
	 * Abbruchsignal -, verwerfen schon.
	 */
	let laufNummer = 0

	/**
	 * @param {object} antwort die `client`-Antwort des Statusendpunkts
	 * @param {number|string} fileId
	 * @return {Promise<?object>} der onReady-Körper, oder null, wenn dieser
	 *   Lauf von einem neueren überholt wurde
	 */
	async function run(antwort, fileId) {
		const schluessel = `${fileId}:${antwort.etag}`
		if (cache?.key === schluessel) {
			return koerper(cache.files, antwort)
		}

		const meinLauf = ++laufNummer
		progress.value = { phase: 'source' }

		const artefakte = await convertInBrowser({
			fetchSource: () => holeQuelle(antwort.sourceUrl),
			loadEngine: () => ladeEngine(antwort.engineUrl),
			maxBytes: antwort.maxBytes ?? 0,
			onProgress: (stand) => {
				if (meinLauf === laufNummer) {
					progress.value = stand
				}
			},
		})

		if (meinLauf !== laufNummer) {
			// Überholt: Die Artefakte sind fertig, aber niemand will sie mehr.
			// Sie hier verfallen zu lassen ist billiger, als sie in den Cache
			// zu legen und den Eintrag der aktuellen Partitur zu verdrängen.
			return null
		}

		release()
		const { files, revoke } = createArtifactUrls(artefakte, antwort.etag)
		cache = { key: schluessel, files, revoke, antwort, base: { timing: artefakte.timing, measures: artefakte.measures } }
		progress.value = null
		return koerper(files, antwort)
	}

	/**
	 * A display variant of the score run() converted last - answered in the
	 * shape of the server's variant route, so the viewer cannot tell them
	 * apart.
	 *
	 * @param {string} key canonical variant key
	 * @return {Promise<object>} `{status: 'ready', variant, files}` or `{status: 'error', errorCode}`
	 */
	async function runVariant(key) {
		if (cache === null) {
			return { status: 'error', variant: key, errorCode: 'base_not_ready' }
		}
		const known = variants.get(key)
		if (known) {
			variants.delete(key)
			variants.set(key, known)
			return { status: 'ready', variant: key, files: known.files }
		}
		const basis = cache
		try {
			const artefakte = await convertVariantInBrowser({
				fetchSource: () => holeQuelle(basis.antwort.sourceUrl),
				loadEngine: () => ladeEngine(basis.antwort.engineUrl),
				key,
				base: basis.base,
				maxBytes: basis.antwort.maxBytes ?? 0,
			})
			if (cache !== basis) {
				// The score changed meanwhile; nobody wants this any more.
				return { status: 'error', variant: key, errorCode: 'base_not_ready' }
			}
			const made = createVariantUrls(artefakte, basis.files)
			variants.set(key, made)
			while (variants.size > MAX_VARIANTS) {
				const [oldest, entry] = variants.entries().next().value
				entry.revoke()
				variants.delete(oldest)
			}
			return { status: 'ready', variant: key, files: made.files }
		} catch (err) {
			return { status: 'error', variant: key, errorCode: err?.code ?? 'conversion_failed', error: err?.message ?? '' }
		}
	}

	/** Gibt die Blob-URLs frei. Nach dem Schließen des Viewers und vor jedem neuen Lauf. */
	function release() {
		cache?.revoke()
		cache = null
		for (const entry of variants.values()) {
			entry.revoke()
		}
		variants.clear()
	}

	return { progress, run, runVariant, release }
}

/**
 * Derselbe Körper, den `useConversionStatus` sonst aus der Serverantwort
 * reicht - der Viewer sieht keinen Unterschied. Nur `renderer.backend` sagt,
 * woher die Darstellung kommt; das ist eine Angabe für Menschen, keine
 * Verzweigung (E3).
 *
 * @param {object} files
 * @param {object} antwort
 * @return {object}
 */
function koerper(files, antwort) {
	return {
		files,
		soundFontUrl: antwort.soundFontUrl,
		renderer: { backend: 'client' },
		canReconvert: antwort.canReconvert === true,
		canWriteFolder: antwort.canWriteFolder === true,
	}
}

/**
 * @param {string} sourceUrl
 * @return {Promise<Uint8Array>}
 */
async function holeQuelle(sourceUrl) {
	const antwort = await axios.get(sourceUrl, { responseType: 'arraybuffer' })
	return new Uint8Array(antwort.data)
}

/**
 * @param {string} engineUrl
 * @return {Promise<object>}
 */
async function ladeEngine(engineUrl) {
	// `webpackIgnore` ist zwingend: Bündelte Webpack den Glue mit, verlöre er
	// seine eigene Script-URL - und damit die Stelle, an der er
	// `scoreview.lib.wasm` und `scoreview.lib.data` sucht (die Engine löst
	// beides relativ zu `import.meta.url` auf). Genau deshalb liegen alle drei
	// Dateien hinter derselben Route.
	const modul = await import(/* webpackIgnore: true */ engineUrl)
	return modul.default
}
