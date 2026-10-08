import axios from '@nextcloud/axios'
import { translate } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import { ref } from 'vue'
import {
	apiUrlsFor,
	estimateBytes,
	isOutdated,
	missingUrls,
	planForScore,
	planForSetlist,
	removeEntry,
	sharedUrls,
	splitByUser,
	upsertEntry,
} from '../lib/offlinePlan.js'
import { WORKLET_URL } from '../lib/player.js'
import { isPlayable } from '../lib/setlistNav.js'

const t = (text, vars) => translate('scoreview', text, vars)

/**
 * Der Cache, aus dem der Service Worker der Offline-Seite (src/offline-sw.js)
 * Antworten liefert. Der Name steht dort ein zweites Mal - ein Worker kann
 * dieses Modul nicht importieren, ohne Vue und axios mitzuziehen.
 */
export const DATA_CACHE = 'scoreview-offline-data'

/**
 * Die Liste des Vorgemerkten als synthetischer Eintrag im selben Cache. Unter
 * einer URL, die der Server nie beantwortet: So kann sie nicht versehentlich
 * vom Netz ueberschrieben werden, und das Loeschen des Caches (Abmelden, S10)
 * nimmt sie mit.
 */
const manifestUrl = () => generateUrl('/apps/scoreview/offline/pinned.json')

/** Ob dieser Browser vormerken kann - Cache Storage gibt es nur in sicheren Kontexten. */
export function offlineSupported() {
	return typeof window !== 'undefined' && window.isSecureContext && 'caches' in window && 'serviceWorker' in navigator
}

/** @return {Promise<import('../lib/offlinePlan.js').PinEntry[]>} */
export async function readManifest() {
	const cache = await caches.open(DATA_CACHE)
	const res = await cache.match(manifestUrl())
	if (!res) {
		return []
	}
	try {
		const list = await res.json()
		return Array.isArray(list) ? list : []
	} catch {
		return []
	}
}

async function writeManifest(list) {
	const cache = await caches.open(DATA_CACHE)
	await cache.put(manifestUrl(), new Response(JSON.stringify(list), { headers: { 'Content-Type': 'application/json' } }))
}

async function deleteUrls(urls) {
	const cache = await caches.open(DATA_CACHE)
	await Promise.all(urls.map((u) => cache.delete(u)))
}

/** @return {Promise<Set<string>>} was im Cache liegt, als Pfad wie generateUrl ihn baut */
export async function cachedUrls() {
	const cache = await caches.open(DATA_CACHE)
	const keys = await cache.keys()
	const origin = window.location.origin
	return new Set(keys.map((r) => (r.url.startsWith(origin) ? r.url.slice(origin.length) : r.url)))
}

/**
 * Eine URL holen und unter GENAU dieser URL ablegen - der Viewer fragt sie
 * offline wieder so ab, und der Worker antwortet aus dem Cache. Gleiche
 * Herkunft ueber axios (traegt den requesttoken der Sitzung), ein fremder
 * SoundFont-Host ueber fetch ohne Anmeldedaten, wie usePlayback.js ihn holt.
 *
 * @param {Cache} cache
 * @param {string} url
 * @return {Promise<number>} Bytes
 */
async function store(cache, url) {
	const sameOrigin = new URL(url, window.location.href).origin === window.location.origin
	let body
	let type
	if (sameOrigin) {
		const res = await axios.get(url, { responseType: 'blob' })
		body = res.data
		type = res.headers?.['content-type'] ?? body.type ?? 'application/octet-stream'
	} else {
		const res = await fetch(url)
		if (!res.ok) {
			throw new Error(`${res.status} ${url}`)
		}
		body = await res.blob()
		type = res.headers.get('Content-Type') ?? 'application/octet-stream'
	}
	await cache.put(url, new Response(body, { headers: { 'Content-Type': type } }))
	return body.size
}

/**
 * @param {number} fileId
 * @return {Promise<{plan: ?{urls: string[], etag: ?string}, status: object, pageCount: number, shared: string[]}>}
 */
async function planScore(fileId) {
	const api = apiUrlsFor(generateUrl, fileId)
	const status = (await axios.get(api.status)).data
	const plan = planForScore({ statusBody: status, api })
	return {
		plan,
		status,
		pageCount: status?.files?.pages?.length ?? 1,
		shared: sharedUrls({ soundFontUrl: status?.soundFontUrl ?? null, workletUrl: WORKLET_URL }),
	}
}

/**
 * „Offline vormerken" (H9) fuer den Viewer: schaetzen, dann laden.
 *
 * @param {object} deps
 * @param {() => string} deps.uid die angemeldete Person (S10)
 * @return {object}
 */
export function useOffline({ uid }) {
	const busy = ref(false)
	const progress = ref(0)
	const error = ref('')
	const done = ref('')

	/**
	 * Was das Vormerken kostete, bevor es losgeht - fuer die Rueckfrage.
	 *
	 * @param {{fileId: number}|{setlistId: number}} target
	 * @return {Promise<{bytes: number, free: ?number, pinned: boolean, notReady: boolean}>}
	 */
	async function estimate(target) {
		const manifest = await readManifest().catch(() => [])
		const cached = await cachedUrls().catch(() => new Set())
		const ids = target.setlistId
			? (await setlistMembers(target.setlistId)).map((e) => e.fileId)
			: [target.fileId]
		const plans = await Promise.all(ids.map((id) => planScore(id).catch(() => null)))
		const ready = plans.filter((p) => p?.plan)
		const sharedCached = ready.length > 0 && ready[0].shared.every((u) => cached.has(u))
		const bytes = estimateBytes(ready.map((p) => ({ pageCount: p.pageCount })), sharedCached)
		const quota = await navigator.storage?.estimate?.().catch(() => null)
		const free = quota?.quota ? quota.quota - (quota.usage ?? 0) : null
		const type = target.setlistId ? 'setlist' : 'score'
		const id = Number(target.setlistId ?? target.fileId)
		return {
			bytes,
			free,
			pinned: manifest.some((e) => e.type === type && e.id === id && e.uid === uid()),
			notReady: ready.length < ids.length,
		}
	}

	async function setlistMembers(setlistId) {
		const data = (await axios.get(generateUrl('/apps/scoreview/api/setlists/{id}', { id: setlistId }))).data
		return (data?.entries ?? []).filter(isPlayable)
	}

	/**
	 * @param {object} target
	 * @param {number} [target.fileId]
	 * @param {number} [target.setlistId]
	 * @param {string} target.title
	 * @return {Promise<boolean>}
	 */
	async function pin(target) {
		if (busy.value) {
			return false
		}
		busy.value = true
		progress.value = 0
		error.value = ''
		done.value = ''
		try {
			await purgeForeign()
			const entry = await buildEntry(target, (p) => {
				progress.value = p
			})
			await commit(entry)
			// Einmal fragen, ob der Browser den Speicher behalten darf (M-D).
			// Verweigert er, zeigt die Offline-Seite einen Hinweis.
			await navigator.storage?.persist?.().catch(() => false)
			done.value = t('Saved for offline use.')
			return true
		} catch (err) {
			error.value = err?.userMessage ?? t('Could not save this for offline use.')
			return false
		} finally {
			busy.value = false
		}
	}

	async function buildEntry(target, onProgress) {
		const cache = await caches.open(DATA_CACHE)
		const setlistUrl = target.setlistId ? generateUrl('/apps/scoreview/api/setlists/{id}', { id: target.setlistId }) : null
		const ids = target.setlistId ? (await setlistMembers(target.setlistId)).map((e) => e.fileId) : [target.fileId]
		const scorePlans = []
		let shared = []
		for (const id of ids) {
			const { plan, shared: s } = await planScore(id)
			if (!plan) {
				const err = new Error('not ready')
				err.userMessage = t('Open every piece once until it is shown, then try again.')
				throw err
			}
			shared = s
			scorePlans.push({ fileId: id, urls: plan.urls, etag: plan.etag })
		}
		const urls = target.setlistId
			? planForSetlist({ setlistUrl, scorePlans }).urls
			: scorePlans[0].urls
		const all = [...urls, ...shared]
		// Getrennt gezaehlt: Das SoundFont (~24 MB) teilen sich alle Eintraege,
		// es liegt nur einmal im Cache und darf in der Summe nur einmal stehen.
		let bytes = 0
		let sharedBytes = 0
		for (const [i, url] of all.entries()) {
			const size = await store(cache, url)
			if (i < urls.length) {
				bytes += size
			} else {
				sharedBytes += size
			}
			onProgress((i + 1) / all.length)
		}
		return {
			type: target.setlistId ? 'setlist' : 'score',
			id: Number(target.setlistId ?? target.fileId),
			title: target.title,
			etag: target.setlistId ? null : scorePlans[0].etag,
			etags: Object.fromEntries(scorePlans.map((p) => [p.fileId, p.etag])),
			urls: all,
			members: scorePlans.map((p) => p.fileId),
			first: scorePlans[0]?.fileId ?? null,
			bytes,
			sharedBytes,
			pinnedAt: Date.now(),
			uid: uid(),
		}
	}

	async function commit(entry) {
		const { manifest, obsolete } = upsertEntry(await readManifest(), entry)
		await writeManifest(manifest)
		await deleteUrls(obsolete)
	}

	/**
	 * @param {'score'|'setlist'} type
	 * @param {number} id
	 */
	async function remove(type, id) {
		const { manifest, obsolete } = removeEntry(await readManifest(), type, id)
		await writeManifest(manifest)
		await deleteUrls(obsolete)
	}

	/**
	 * Was der angemeldeten Person gehoert - fremde Eintraege werden dabei
	 * geloescht (S10): Der Cache haengt am Browser, nicht am Konto.
	 *
	 * @return {Promise<Array<object>>} eigene Eintraege mit `missing`
	 */
	async function ownEntries() {
		const own = await purgeForeign()
		const cached = await cachedUrls()
		return own.map((e) => ({ ...e, missing: missingUrls(e, cached).length }))
	}

	/**
	 * Ein Konto je Cache (S10): Eintraege einer anderen Person gehen samt
	 * ALLER ihrer URLs - auch der, die ein eigener Eintrag ebenfalls nennt.
	 * Unter derselben URL koennen ihre privaten Antworten liegen (Notizen,
	 * eigene Stimme), die sie beim Vormerken ueberschrieben hat. Ein eigener
	 * Eintrag, dem dadurch etwas fehlt, gilt danach als beschaedigt und wird
	 * neu vorgemerkt bzw. beim naechsten Aktualisieren neu geladen.
	 *
	 * @return {Promise<Array<object>>} die eigenen Eintraege
	 */
	async function purgeForeign() {
		const { own, foreign } = splitByUser(await readManifest(), uid())
		if (foreign.length > 0) {
			await writeManifest(own)
			await deleteUrls([...new Set(foreign.flatMap((e) => e.urls))])
		}
		return own
	}

	/**
	 * Aktualisieren beim Oeffnen der Offline-Seite (D15): Hat sich der
	 * Konvertierungsstand eines Stuecks geaendert, wird der Eintrag neu
	 * geladen. Ohne Netz bleibt er, wie er ist.
	 *
	 * @param {object} entry
	 * @return {Promise<'current'|'updated'|'offline'>}
	 */
	async function refresh(entry) {
		try {
			const members = entry.members ?? [entry.id]
			let outdated = false
			for (const id of members) {
				const status = (await axios.get(apiUrlsFor(generateUrl, id).status, { headers: { 'X-ScoreView-Network-Only': '1' } })).data
				const known = { type: 'score', etag: entry.etags?.[id] ?? entry.etag }
				if (isOutdated(known, status)) {
					outdated = true
				}
			}
			if (!outdated && entry.missing === 0) {
				return 'current'
			}
			const fresh = await buildEntry(entry.type === 'setlist'
				? { setlistId: entry.id, title: entry.title }
				: { fileId: entry.id, title: entry.title }, () => {})
			await commit(fresh)
			return 'updated'
		} catch {
			return 'offline'
		}
	}

	return { busy, progress, error, done, estimate, pin, remove, ownEntries, refresh }
}
