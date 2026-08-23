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
})()
