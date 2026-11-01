/**
 * The lines of the admin diagnosis (Settings\AdminSettings, HealthService),
 * chosen from the health answer - with `t` passed in, so they are testable
 * without Nextcloud. The calls stay literal t() calls with the source string
 * as a literal: tools/l10n.mjs finds the source strings exactly there.
 */

/**
 * @typedef {object} HealthLine
 * @property {string} label what is checked
 * @property {boolean} ok whether it works
 * @property {string} detail the finding in a sentence
 * @property {string} [type] NcNoteCard type, else success/error from `ok`
 */

/**
 * @param {?object} h the answer of the health endpoint
 * @param {(text: string, vars?: object) => string} t
 * @return {HealthLine[]}
 */
export function healthLines(h, t) {
	if (!h) {
		return []
	}
	const c = h.conversions
	const stuck = (c.pending || 0) + (c.processing || 0)
	return [
		{
			label: t('Conversion'),
			...backendLine(h, t),
		},
		...(h.backend === 'local' && h.local.available && h.local.isolation
			? [{
					label: t('Isolation'),
					...isolationLine(h.local.isolation, t),
				}]
			: []),
		...(h.clientFallback?.active
			? [{
					label: t('Fallback'),
					// Warnung, nicht Erfolg und nicht Fehler: Es
					// funktioniert - aber jedes Geraet laedt dafuer rund
					// 14 MB, und gecacht wird nichts.
					type: 'warning',
					ok: true,
					detail: t('Scores are converted in the browser because this server cannot. Every device downloads the conversion engine once (about 14 MB), and nothing is cached on the server.'),
				}]
			: []),
		{
			label: t('SoundFont'),
			...soundFontLine(h.soundFont, t),
		},
		{
			label: t('Background jobs (cron)'),
			ok: h.cron.healthy,
			detail: h.cron.healthy
				? t('mode {mode}, last run {age}', { mode: h.cron.mode, age: humanAge(h.cron.ageSeconds, t) })
				: t('no run in the last 15 minutes ({age}) – conversions will stay pending', { age: humanAge(h.cron.ageSeconds, t) }),
		},
		...(h.follow?.enabled
			? [{
					label: t('“Follow me”'),
					...followLine(h.follow, t),
				}]
			: []),
		{
			label: t('Conversions'),
			// Nur dann ein Problem, wenn etwas haengt UND der Cron tot
			// ist - ausstehende Konvertierungen bei laufendem Cron sind
			// schlicht Arbeit in der Warteschlange.
			ok: !(stuck > 0 && !h.cron.healthy),
			detail: t('{ready} ready, {pending} pending, {failed} failed', {
				ready: c.ready || 0,
				pending: stuck,
				failed: c.error || 0,
			}),
		},
	]
}

/**
 * Die Diagnosezeile des AKTIVEN Konvertierungswegs - beim Sidecar
 * "erreichbar?", lokal "node da, Konverter vollstaendig, darf PHP
 * ueberhaupt Prozesse starten?". Der Server liefert immer beides
 * (siehe Service\HealthService); welche Antwort zaehlt, entscheidet
 * sich hier, damit die Zeile nicht von einem Dienst rot wird, der gar
 * nicht benutzt wird.
 *
 * @param {object} h die Antwort des Health-Endpunkts
 * @param {(text: string, vars?: object) => string} t
 * @return {{ok: boolean, detail: string}}
 */
export function backendLine(h, t) {
	if (h.backend === 'local') {
		const version = !h.local.nodeVersion
			? ''
			: h.local.runtime === 'deno'
				? t('Deno {version}', { version: h.local.nodeVersion })
				: t('Node.js {version}', { version: h.local.nodeVersion })
		return {
			ok: h.local.available,
			detail: h.local.available ? t('on this server, {version}', { version }) : (h.local.error || ''),
		}
	}
	const renderer = h.sidecar.renderer === 'musescore' ? t('with MuseScore') : t('with the scoreview-engine')
	return {
		ok: h.sidecar.reachable,
		detail: h.sidecar.reachable ? `${h.sidecar.url}, ${renderer}` : (h.sidecar.error || t('not configured')),
	}
}

/**
 * How far the runtime locks the local converter in (S11). Only a
 * statement for the admin: the level never decides whether the
 * server converts - an old Node keeps working, so this is a warning
 * and not an error.
 *
 * @param {string} isolation h.local.isolation from the health endpoint
 * @param {(text: string, vars?: object) => string} t
 * @return {{ok: boolean, detail: string, type: string}}
 */
export function isolationLine(isolation, t) {
	if (isolation === 'full') {
		return {
			ok: true,
			type: 'success',
			detail: t('The converter can only read the score and write its result – no other files, no network, no processes.'),
		}
	}
	if (isolation === 'partial') {
		return {
			ok: true,
			type: 'info',
			detail: t('The converter can only read the score and write its result, and cannot start processes. This Node.js version cannot block network access; Node.js 25 or newer, or Deno, can.'),
		}
	}
	return {
		ok: true,
		type: 'warning',
		detail: t('This Node.js version cannot isolate the converter. Node.js 20.7 or newer, or Deno, runs it with access to the score only.'),
	}
}

/**
 * Ob „Folgt mir" Push nutzt (E10). Ohne Push ist nichts kaputt - die
 * Geraete fragen ab -, deshalb Hinweis statt Fehler. Er nennt die
 * gemessenen Kosten, damit die Entscheidung fuer notify_push
 * nicht auf Vermutung beruht.
 *
 * @param {object} f h.follow aus dem Health-Endpunkt
 * @param {(text: string, vars?: object) => string} t
 * @return {{ok: boolean, detail: string, type?: string}}
 */
export function followLine(f, t) {
	if (f.pushAvailable) {
		return { ok: true, detail: t('notify_push is available: devices get jumps pushed instead of asking every {ms} ms.', { ms: f.pollMs }) }
	}
	return {
		ok: true,
		type: 'info',
		detail: t('Without notify_push every following device asks every {ms} ms, costing about 50 ms of CPU per request - with 40 devices about three cores during the session. From about {n} devices, installing notify_push is recommended.', { ms: f.pollMs, n: f.recommendPushFromDevices }),
	}
}

/**
 * Wiedergabe ist auch dann moeglich, wenn die Quelle gerade nicht
 * erreichbar ist - solange eine Kopie im Cache liegt. Deshalb zaehlt
 * hier der Cache und NICHT die Erreichbarkeit: ein ✓ neben einer rohen
 * Verbindungsfehlermeldung waere eine Zeile, die sich selbst
 * widerspricht.
 *
 * @param {object} sf h.soundFont aus dem Health-Endpunkt
 * @param {(text: string, vars?: object) => string} t
 * @return {{ok: boolean, detail: string, type?: string}}
 */
export function soundFontLine(sf, t) {
	if (sf.overrideUrl) {
		return { ok: true, detail: t('custom URL configured') }
	}
	if (sf.cached) {
		return { ok: true, detail: sf.name || t('cached copy in use') }
	}
	if (sf.availableInSidecar) {
		return { ok: true, detail: sf.name || '' }
	}
	if (sf.fetchUrl) {
		// Nichts im Cache, aber die Quelle steht fest: der Zustand
		// direkt nach der Installation. Rot waere hier ein Fehlalarm
		// - es ist noch nichts schiefgegangen, es hat nur noch
		// niemand abgespielt.
		return {
			ok: false,
			type: 'warning',
			detail: t('not fetched yet – the server downloads it on first playback ({url})', { url: sf.fetchUrl }),
		}
	}
	return { ok: false, detail: sf.error || t('no SoundFont available') }
}

/**
 * @param {?number} seconds Alter in Sekunden, null wenn nie gelaufen
 * @param {(text: string, vars?: object) => string} t
 * @return {string}
 */
export function humanAge(seconds, t) {
	if (seconds === null || seconds === undefined) {
		return t('never')
	}
	if (seconds < 60) {
		return t('{n} s ago', { n: seconds })
	}
	return t('{n} min ago', { n: Math.floor(seconds / 60) })
}
