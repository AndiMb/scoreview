// „Offline vormerken" (H9): welche Antworten fuer ein Stueck oder eine
// Setliste in den Cache gehoeren, und was beim Aktualisieren und Entfernen
// wegfaellt. Rein - Cache Storage bedient useOffline.js.
//
// Tragend (Entwurf §7): Der Viewer fragt offline DIESELBEN URLs wie online,
// der Service Worker der Offline-Seite beantwortet sie aus dem Cache. Deshalb
// stehen hier keine eigenen Schluessel, sondern genau die Adressen, die
// die Composables abrufen - einschliesslich `?v=` der Artefakte. Wer im
// Viewer eine URL aendert, muss sie hier mitaendern; die Tests nennen jede.

/**
 * The cache the offline page's service worker answers from (src/offline-sw.js)
 * and useOffline.js fills. Kept here, in a module without dependencies, so
 * both can import the one name.
 */
export const DATA_CACHE = 'scoreview-offline-data'

/**
 * Where a pin or refresh downloads to before anything lands in DATA_CACHE.
 * Each build gets its own cache under this prefix; the timestamp in the name
 * lets a later visit clear what a closed tab left behind.
 */
export const STAGING_PREFIX = 'scoreview-offline-staging-'

/** Staging caches older than this belong to no running download any more. */
export const STAGING_MAX_AGE_MS = 60 * 60 * 1000

/**
 * @param {number} now ms
 * @return {string} a fresh staging cache name
 */
export function stagingName(now) {
	return `${STAGING_PREFIX}${now}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * @param {string} name a cache name
 * @param {number} now ms
 * @return {boolean} whether it is a staging cache left behind by a download
 */
export function isStaleStaging(name, now) {
	if (!name.startsWith(STAGING_PREFIX)) {
		return false
	}
	const started = Number.parseInt(name.slice(STAGING_PREFIX.length), 10)
	return !Number.isFinite(started) || now - started > STAGING_MAX_AGE_MS
}

/**
 * @typedef {object} PinEntry
 * @property {'score'|'setlist'} type was vorgemerkt ist
 * @property {number} id fileId der Partitur bzw. der Setliste
 * @property {string} title fuer die Liste der Offline-Seite
 * @property {?string} etag Konvertierungsstand (score) bzw. null
 * @property {string[]} urls alles, was nur dieser Eintrag braucht
 * @property {number[]} [members] fileIds der Stuecke (setlist)
 * @property {number} [first] das Stueck, mit dem eine Setliste oeffnet
 * @property {number} bytes tatsaechlich geladen, fuer die Platzanzeige
 * @property {number} pinnedAt ms
 * @property {string} uid wem der Eintrag gehoert (S10)
 */

/**
 * Die API-Adressen, die der Viewer beim Oeffnen einer Partitur abruft. Wer
 * sie baut, uebergibt `generateUrl` - so bleibt dieses Modul ohne Nextcloud.
 *
 * @param {(path: string, params: object) => string} generateUrl
 * @param {number} fileId
 * @return {{status:string, annotations:string, myPart:string, leaders:string, setlistOffers:string}}
 */
export function apiUrlsFor(generateUrl, fileId) {
	const p = { fileId }
	return {
		status: generateUrl('/apps/scoreview/api/scores/{fileId}/status', p),
		annotations: generateUrl('/apps/scoreview/api/scores/{fileId}/annotations', p),
		myPart: generateUrl('/apps/scoreview/api/scores/{fileId}/my-part', p),
		leaders: generateUrl('/apps/scoreview/api/scores/{fileId}/leaders', p),
		setlistOffers: generateUrl('/apps/scoreview/api/scores/{fileId}/setlists', p),
	}
}

/**
 * @param {object} input
 * @param {object} input.statusBody Antwort von `status` (muss `ready` sein)
 * @param {ReturnType<typeof apiUrlsFor>} input.api
 * @return {{urls: string[], etag: ?string}|null} null, wenn die Partitur
 *   (noch) nicht fertig konvertiert ist - dann gibt es nichts vorzumerken
 */
export function planForScore({ statusBody, api }) {
	const files = statusBody?.files
	if (statusBody?.status !== 'ready' || !files || !Array.isArray(files.pages)) {
		return null
	}
	const urls = [
		api.status,
		api.annotations,
		api.myPart,
		api.leaders,
		api.setlistOffers,
		...files.pages,
		files.midi,
		files.timingJson,
		files.measuresJson,
		files.metaJson,
	].filter((u) => typeof u === 'string' && u !== '')
	return { urls: unique(urls), etag: files.etag ?? null }
}

/**
 * Was alle Eintraege teilen und nur einmal je Geraet geladen wird.
 *
 * @param {{soundFontUrl:?string, workletUrl:?string}} input
 * @return {string[]}
 */
export function sharedUrls({ soundFontUrl, workletUrl }) {
	return [soundFontUrl, workletUrl].filter((u) => typeof u === 'string' && u !== '')
}

/**
 * Eine Setliste vormerken heisst: ihre eigene Antwort plus alles, was ihre
 * Stuecke brauchen. Die Stuecke stehen dabei nicht als eigene Eintraege in
 * der Liste der Offline-Seite - eine Setliste ist EIN Eintrag, und was sie
 * mit einem einzeln vorgemerkten Stueck teilt, bleibt beim Entfernen ueber
 * `unreferenced` erhalten.
 *
 * @param {object} input
 * @param {string} input.setlistUrl `/api/setlists/{id}`, wie useSetlist.js sie abruft
 * @param {Array<{fileId: number, urls: string[]}>} input.scorePlans
 * @return {{urls: string[], members: number[]}}
 */
export function planForSetlist({ setlistUrl, scorePlans }) {
	return {
		urls: unique([setlistUrl, ...scorePlans.flatMap((p) => p.urls)]),
		members: unique(scorePlans.map((p) => p.fileId)),
	}
}

/**
 * Was einem Eintrag fehlt. Der Browser darf Cache Storage unter Platznot
 * raeumen (M-D) - dann ist ein Eintrag beschaedigt, und die Offline-Seite
 * sagt das, statt ihn halb zu oeffnen.
 *
 * @param {PinEntry} entry
 * @param {Set<string>} cached die URLs, die im Cache liegen
 * @return {string[]}
 */
export function missingUrls(entry, cached) {
	return entry.urls.filter((u) => !cached.has(u))
}

/**
 * Grobe Schaetzung vor dem Laden, fuer die Rueckfrage mit Platzbedarf. Die
 * echte Groesse steht erst nach dem Laden fest und wird dann gespeichert.
 * Gemessen (M-C/Testpartituren): SVG-Seite 0,1-0,3 MB, der Rest einer
 * Partitur zusammen unter 0,1 MB, SoundFont ~24 MB.
 *
 * @param {{pageCount:number}[]} scores
 * @param {boolean} sharedCached ob SoundFont und Worklet schon da sind
 * @return {number} Bytes
 */
export function estimateBytes(scores, sharedCached) {
	const perPage = 250_000
	const perScore = 100_000
	const shared = sharedCached ? 0 : 24_000_000
	return shared + scores.reduce((sum, s) => sum + perScore + perPage * (s.pageCount ?? 1), 0)
}

/**
 * Eintrag einfuegen oder ersetzen. Gibt zurueck, welche URLs der alte Eintrag
 * hatte und kein anderer mehr braucht - etwa die Artefakte mit altem `?v=`
 * nach einer Neukonvertierung (D15).
 *
 * @param {PinEntry[]} manifest
 * @param {PinEntry} entry
 * @return {{manifest: PinEntry[], obsolete: string[]}}
 */
export function upsertEntry(manifest, entry) {
	const old = manifest.find((e) => e.type === entry.type && e.id === entry.id)
	const next = manifest.filter((e) => e !== old).concat(entry)
	const obsolete = old ? unreferenced(old.urls, next) : []
	return { manifest: next, obsolete }
}

/**
 * @param {PinEntry[]} manifest
 * @param {'score'|'setlist'} type
 * @param {number} id
 * @return {{manifest: PinEntry[], obsolete: string[]}}
 */
export function removeEntry(manifest, type, id) {
	const old = manifest.find((e) => e.type === type && e.id === id)
	if (!old) {
		return { manifest, obsolete: [] }
	}
	const next = manifest.filter((e) => e !== old)
	return { manifest: next, obsolete: unreferenced(old.urls, next) }
}

/**
 * Trennt die Eintraege der angemeldeten Person von fremden (S10): Der Cache
 * haengt am Origin, nicht am Konto. Fremde werden geloescht, nicht gezeigt.
 *
 * @param {PinEntry[]} manifest
 * @param {string} uid
 * @return {{own: PinEntry[], foreign: PinEntry[]}}
 */
export function splitByUser(manifest, uid) {
	return {
		own: manifest.filter((e) => e.uid === uid),
		foreign: manifest.filter((e) => e.uid !== uid),
	}
}

/**
 * Ob ein Eintrag veraltet ist: ein anderer Konvertierungsstand als beim
 * Vormerken.
 *
 * @param {PinEntry} entry
 * @param {object} statusBody frische Antwort von `status`
 * @return {boolean}
 */
export function isOutdated(entry, statusBody) {
	if (entry.type !== 'score') {
		return false
	}
	const etag = statusBody?.files?.etag ?? null
	return etag !== null && etag !== entry.etag
}

/**
 * Whether the server now names a different SoundFont than the one stored with
 * the entry. Its address carries its version (ConversionController::
 * soundFontUrl()), so a new sidecar image or download URL shows up here, and
 * refreshing stores the new one and drops the old, once no entry needs it.
 *
 * @param {PinEntry} entry
 * @param {object} statusBody frische Antwort von `status`
 * @return {boolean}
 */
export function soundFontChanged(entry, statusBody) {
	const url = statusBody?.soundFontUrl
	return typeof url === 'string' && url !== '' && !entry.urls.includes(url)
}

/**
 * @param {string[]} urls
 * @param {PinEntry[]} others
 * @return {string[]} die URLs, die keiner der anderen Eintraege braucht
 */
/**
 * Keys in the data cache that no entry names any more - left by a download
 * that failed after storing part of it, or by an entry removed in another tab.
 *
 * @param {PinEntry[]} manifest
 * @param {string[]} keys what lies in the cache, as generateUrl builds paths
 * @param {string[]} keep keys that are not entries (the manifest itself)
 * @return {string[]}
 */
export function orphanedUrls(manifest, keys, keep) {
	const used = new Set([...keep, ...manifest.flatMap((e) => e.urls)])
	return keys.filter((k) => !used.has(k))
}

function unreferenced(urls, others) {
	const used = new Set(others.flatMap((e) => e.urls))
	return urls.filter((u) => !used.has(u))
}

function unique(list) {
	return [...new Set(list)]
}
