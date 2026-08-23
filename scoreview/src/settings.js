import { translate } from '@nextcloud/l10n'

// Einzelargument-Wrapper wie in den Vue-Komponenten (siehe ScoreViewer.vue) -
// haelt tools/l10n.mjs' Extraktionsmuster fuer diese Datei gueltig, obwohl
// sie kein Vue-Setup ist.
function t(text, vars) {
	return translate('scoreview', text, vars)
}

// Eigenes Bundle statt Inline-<script> im PHP-Template: Nextclouds
// Content-Security-Policy blockt Inline-Scripts ohne Nonce, ein per
// Util::addScript geladenes Bundle bekommt die Nonce automatisch.
(function() {
	var form = document.getElementById('scoreview-settings-form')
	if (!form) {
		return
	}
	var status = document.getElementById('scoreview-settings-status')
	form.addEventListener('submit', function(event) {
		event.preventDefault()
		status.textContent = '…'
		fetch(OC.generateUrl('/apps/scoreview/api/settings'), {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				requesttoken: OC.requestToken,
			},
			body: JSON.stringify({
				sidecarUrl: document.getElementById('scoreview-sidecar-url').value,
				sidecarSecret: document.getElementById('scoreview-sidecar-secret').value,
				eagerConversion: document.getElementById('scoreview-eager-conversion').checked,
				soundFontUrl: document.getElementById('scoreview-soundfont-url').value,
			}),
		}).then(function(res) {
			if (!res.ok) { throw new Error('HTTP ' + res.status) }
			status.textContent = '✓ ' + t('Saved')
			document.getElementById('scoreview-sidecar-secret').value = ''
		}).catch(function(err) {
			status.textContent = t('Error: {message}', { message: err.message })
		})
	})

	// --- Betriebsdiagnose (Phase 21) ---
	var healthBox = document.getElementById('scoreview-health')
	if (!healthBox) {
		return
	}

	function line(ok, label, detail) {
		var el = document.createElement('div')
		// Symbol statt Farbe allein: die Aussage muss auch ohne
		// Farbwahrnehmung ankommen.
		el.textContent = (ok ? '✓ ' : '✗ ') + label + (detail ? ' – ' + detail : '')
		el.style.color = ok ? 'var(--color-success, green)' : 'var(--color-error, red)'
		return el
	}

	function humanAge(seconds) {
		if (seconds === null || seconds === undefined) {
			return t('never')
		}
		if (seconds < 60) {
			return t('{n} s ago', { n: seconds })
		}
		return t('{n} min ago', { n: Math.floor(seconds / 60) })
	}

	function renderHealth(h) {
		healthBox.textContent = ''

		healthBox.appendChild(line(
			h.sidecar.reachable,
			t('Conversion service'),
			h.sidecar.reachable
				? h.sidecar.url
				: (h.sidecar.error || t('not configured')),
		))

		// Wiedergabe ist auch dann moeglich, wenn der Sidecar gerade nicht
		// erreichbar ist - solange eine Kopie im Cache liegt. Deshalb beide
		// Faelle als "ok" werten, nicht nur die Sidecar-Meldung.
		//
		// Der Detailtext muss dazu passen: frueher stand hier bei
		// unerreichbarem Sidecar ein ✓ NEBEN der rohen cURL-Fehlermeldung -
		// eine Zeile, die sich selbst widerspricht. Der Sidecar-Fehler ist
		// nur dann die richtige Auskunft, wenn wirklich nichts verfuegbar ist.
		var soundOk = !!(h.soundFont.cached || h.soundFont.availableInSidecar || h.soundFont.overrideUrl)
		var soundDetail
		if (h.soundFont.overrideUrl) {
			soundDetail = t('custom URL configured')
		} else if (h.soundFont.availableInSidecar) {
			soundDetail = h.soundFont.name || ''
		} else if (h.soundFont.cached) {
			soundDetail = t('cached copy in use (conversion service currently unreachable)')
		} else {
			soundDetail = h.soundFont.error || t('no SoundFont available')
		}
		healthBox.appendChild(line(soundOk, t('SoundFont'), soundDetail))

		healthBox.appendChild(line(
			h.cron.healthy,
			t('Background jobs (cron)'),
			h.cron.healthy
				? t('mode {mode}, last run {age}', { mode: h.cron.mode, age: humanAge(h.cron.ageSeconds) })
				: t('no run in the last 15 minutes ({age}) – conversions will stay pending', { age: humanAge(h.cron.ageSeconds) }),
		))

		var c = h.conversions
		var stuck = (c.pending || 0) + (c.processing || 0)
		healthBox.appendChild(line(
			!(stuck > 0 && !h.cron.healthy),
			t('Conversions'),
			t('{ready} ready, {pending} pending, {failed} failed', {
				ready: c.ready || 0,
				pending: stuck,
				failed: c.error || 0,
			}),
		))
	}

	function loadHealth() {
		healthBox.textContent = '…'
		fetch(OC.generateUrl('/apps/scoreview/api/health'), {
			headers: { requesttoken: OC.requestToken },
		}).then(function(res) {
			if (!res.ok) { throw new Error('HTTP ' + res.status) }
			return res.json()
		}).then(renderHealth).catch(function(err) {
			healthBox.textContent = t('Error: {message}', { message: err.message })
		})
	}

	document.getElementById('scoreview-health-refresh').addEventListener('click', loadHealth)

	var selfTestStatus = document.getElementById('scoreview-selftest-status')
	document.getElementById('scoreview-selftest-run').addEventListener('click', function() {
		// Dauert eine echte Konvertierung lang (~8s gemessen) - deshalb ein
		// sichtbarer Zwischenstand statt eines scheinbar toten Knopfes.
		selfTestStatus.textContent = t('Running…')
		fetch(OC.generateUrl('/apps/scoreview/api/selftest'), {
			method: 'POST',
			headers: { requesttoken: OC.requestToken },
		}).then(function(res) {
			return res.json()
		}).then(function(r) {
			if (r.ok) {
				var d = r.details || {}
				selfTestStatus.textContent = '✓ ' + t('MuseScore {version} works as expected ({pages} page(s), {events} events, {seconds} s)', {
					version: d.musescoreVersion || '?',
					pages: d.pages,
					events: d.events,
					seconds: d.seconds,
				})
			} else {
				selfTestStatus.textContent = '✗ ' + (r.error || t('Self-test failed.'))
			}
		}).catch(function(err) {
			selfTestStatus.textContent = t('Error: {message}', { message: err.message })
		})
	})

	loadHealth()
})()
