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
			}),
		}).then(function(res) {
			if (!res.ok) { throw new Error('HTTP ' + res.status) }
			status.textContent = '✓ gespeichert'
			document.getElementById('scoreview-sidecar-secret').value = ''
		}).catch(function(err) {
			status.textContent = 'Fehler: ' + err.message
		})
	})
})()
