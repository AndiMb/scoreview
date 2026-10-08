// Laeuft als Service Worker: `self` ist der ServiceWorkerGlobalScope.
// Der Service Worker der Offline-Seite (E14, H9). Sein Scope ist genau die
// Offline-Seite (PageController::serviceWorker setzt Service-Worker-Allowed
// darauf) - er steuert also nur sie und laesst Nextclouds eigenen Worker
// (Files, Scope `/`, M-E) unberuehrt.
//
// Tragend (Entwurf §7): Der Viewer fragt offline DIESELBEN URLs wie online.
// Dieser Worker beantwortet sie aus dem Cache, in den useOffline.js sie beim
// Vormerken gelegt hat. Deshalb kennt er keine Partituren, keine fileIds und
// keine eigenen Schluessel - nur drei Regeln nach Art der Anfrage.

// Muss mit composables/useOffline.js uebereinstimmen.
const DATA_CACHE = 'scoreview-offline-data'
// Die Huelle der Seite (Skripte, Stile, Schriften). Je App-Version neu, damit
// nach einem Update kein altes Bundle mit neuen Daten zusammentrifft.
const VERSION = new URL(self.location.href).searchParams.get('v') ?? 'dev'
const SHELL_CACHE = `scoreview-offline-shell-${VERSION}`

self.addEventListener('install', () => {
	self.skipWaiting()
})

self.addEventListener('activate', (event) => {
	event.waitUntil((async () => {
		for (const name of await caches.keys()) {
			if (name.startsWith('scoreview-offline-shell-') && name !== SHELL_CACHE) {
				await caches.delete(name)
			}
		}
		await self.clients.claim()
	})())
})

// Was die Seite vor dem Zugriff dieses Workers schon geladen hatte - beim
// ersten Besuch also alles. Die Seite schickt die Liste, sobald er steuert.
self.addEventListener('message', (event) => {
	if (event.data?.type !== 'precache' || !Array.isArray(event.data.urls)) {
		return
	}
	event.waitUntil((async () => {
		const cache = await caches.open(SHELL_CACHE)
		for (const url of event.data.urls) {
			const u = new URL(url, self.location.href)
			if (u.origin !== self.location.origin || !isShellAsset(u)) {
				continue
			}
			try {
				const res = await fetch(url, { credentials: 'same-origin' })
				if (res.ok) {
					await cache.put(url, res)
				}
			} catch {
				// Offline oder weg - beim naechsten Besuch wieder.
			}
		}
	})())
})

self.addEventListener('fetch', (event) => {
	const request = event.request
	if (request.method !== 'GET') {
		// Schreibendes geht durch; offline scheitert es, und die Oberflaeche
		// bietet es dort gar nicht erst an (interactionPolicy, barGroups).
		return
	}
	const url = new URL(request.url)
	if (request.mode === 'navigate') {
		event.respondWith(navigate(request))
		return
	}
	if (url.origin === self.location.origin && url.pathname.includes('/apps/scoreview/api/')) {
		// Das Aktualisieren der Offline-Seite (D15) will wissen, ob es den
		// Server erreicht - eine Antwort aus dem Cache waere dafuer eine Luege.
		const networkOnly = request.headers.get('X-ScoreView-Network-Only') === '1'
		event.respondWith(networkFirst(request, DATA_CACHE, networkOnly))
		return
	}
	if (url.origin === self.location.origin && isShellAsset(url)) {
		event.respondWith(staleWhileRevalidate(request))
		return
	}
	// Alles Uebrige (fremde Hosts, etwa ein externes SoundFont): erst der
	// Vormerk-Cache, dann das Netz.
	event.respondWith((async () => (await caches.match(request, { cacheName: DATA_CACHE })) ?? fetch(request))())
})

/**
 * Die Seite selbst. Leitet der Server zum Login um, ist niemand mehr
 * angemeldet - dann gehoert das Vorgemerkte niemandem mehr in diesem
 * Browser (S10). Nextcloud raeumt beim Abmelden selbst nur ueber HTTPS und
 * nie in Chrome (`Clear-Site-Data`, core/Controller/LoginController.php);
 * gemessen: In Chrome blieb alles liegen. Hier wird es spaetestens beim
 * naechsten Aufruf mit Netz nachgeholt.
 *
 * @param {Request} request
 */
async function navigate(request) {
	const res = await networkFirst(request, SHELL_CACHE, false)
	// Eine Navigation holt der Worker mit `redirect: manual` - die Umleitung
	// kommt als `opaqueredirect` ohne lesbares Ziel an. Die Offline-Seite
	// selbst leitet nur in einem Fall um: niemand angemeldet (die Umleitung
	// auf die kanonische Adresse trifft diesen Scope nie).
	if ((res.type === 'opaqueredirect' || res.redirected) && await leadsToLogin(request.url)) {
		for (const name of await caches.keys()) {
			if (name.startsWith('scoreview-offline')) {
				await caches.delete(name)
			}
		}
		await self.registration.unregister()
	}
	return res
}

/**
 * Fuehrt die Umleitung wirklich zum Login? Ein Captive Portal oder eine
 * Zwischenseite (SSO, zweiter Faktor) leitet auch um - dort das Vorgemerkte
 * zu loeschen, hiesse es genau dann zu verlieren, wenn kein Netz da ist.
 *
 * @param {string} url
 */
async function leadsToLogin(url) {
	try {
		// Mit `Accept: text/html` wie eine Navigation - sonst antwortet
		// Nextcloud einer abgemeldeten Anfrage mit 401 statt der Umleitung.
		const res = await fetch(url, { redirect: 'follow', credentials: 'same-origin', headers: { Accept: 'text/html' } })
		const target = new URL(res.url)
		return target.origin === self.location.origin && /\/login(\/|$)/.test(target.pathname)
	} catch {
		return false
	}
}

/**
 * Online gilt der Server - offline das zuletzt Gesehene bzw. Vorgemerkte.
 * `index.php` kommt mal mit, mal nicht (je nach Front-Controller-Einstellung
 * und Aufrufer); gesucht wird deshalb unter beiden Formen.
 *
 * @param {Request} request
 * @param {string} cacheName
 * @param {boolean} networkOnly
 */
async function networkFirst(request, cacheName, networkOnly) {
	try {
		const res = await fetch(request)
		if (cacheName === SHELL_CACHE && res.ok && !res.redirected && res.type !== 'opaqueredirect') {
			const cache = await caches.open(SHELL_CACHE)
			await cache.put(request, res.clone())
		}
		return res
	} catch (err) {
		if (!networkOnly) {
			for (const candidate of variants(request.url)) {
				const hit = await caches.match(candidate, { cacheName })
				if (hit) {
					return hit
				}
			}
		}
		if (request.mode === 'navigate') {
			throw err
		}
		return new Response(JSON.stringify({ offline: true }), {
			status: 503,
			headers: { 'Content-Type': 'application/json' },
		})
	}
}

async function staleWhileRevalidate(request) {
	const cache = await caches.open(SHELL_CACHE)
	const cached = await cache.match(request)
	const update = fetch(request).then(async (res) => {
		if (res.ok) {
			await cache.put(request, res.clone())
		}
		return res
	}).catch(() => null)
	if (cached) {
		return cached
	}
	return (await update) ?? new Response('', { status: 504 })
}

/**
 * Nur Code, Stile, Schriften und Bilder der Oberflaeche - nichts, was einer
 * Person gehoert (Avatare, Vorschauen, API). Der Shell-Cache gilt fuer jedes
 * Konto in diesem Browser.
 *
 * @param {URL} url
 */
function isShellAsset(url) {
	const path = url.pathname.replace(/^\/index\.php/, '')
	if (path.includes('/apps/scoreview/api/') || !/^\/(apps|custom_apps|core|dist|themes|apps-extra)\//.test(path)) {
		return false
	}
	return /\.(js|mjs|css|woff2?|ttf|svg|png|json|wasm)$/.test(path)
		|| path.includes('/l10n/')
		|| path.startsWith('/apps/theming/')
}

/** @param {string} href */
function variants(href) {
	const url = new URL(href)
	const out = [url.href]
	if (url.pathname.startsWith('/index.php/')) {
		out.push(url.origin + url.pathname.slice('/index.php'.length) + url.search)
	} else {
		out.push(url.origin + '/index.php' + url.pathname + url.search)
	}
	return out
}
