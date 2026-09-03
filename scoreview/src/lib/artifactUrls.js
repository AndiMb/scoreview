// Aus einer Konvertierung im Browser genau das `files`-Objekt bauen, das der
// Server sonst liefert - Schlüssel für Schlüssel dasselbe wie
// Controller\ConversionController::buildFileUrls().
//
// **Warum Blob-URLs und nicht die Artefakte selbst.** Der Viewer holt jedes
// Artefakt über seine URL (`ScorePage.vue` per axios als Text, `usePlayback.js`
// als ArrayBuffer, die drei JSON-Dateien als Objekte). Reicht der Rückfall
// stattdessen URLs auf Blobs, bleibt dieser ganze Weg unverändert - der
// Konvertierungsweg im Browser kostet dadurch keine Zeile im Viewer. Der Preis
// dafür steht in Listener\AddCspListener: `connect-src blob:`.
//
// Reine Umformung, ohne DOM und ohne Netz - `URL` wird hereingereicht, damit
// das ohne Browser prüfbar bleibt.

/**
 * Inhaltstypen der Artefakte. Nicht Kosmetik: axios entscheidet am Typ, ob es
 * die Antwort als JSON auspackt.
 */
const TYPEN = {
	svg: 'image/svg+xml',
	midi: 'audio/midi',
	json: 'application/json',
}

/**
 * @param {object} artifacts Ergebnis einer Konvertierung in Cache-Form
 * @param {string[]} artifacts.pages die SVG-Seiten als Text
 * @param {Uint8Array} artifacts.midi
 * @param {object} artifacts.timing
 * @param {object} artifacts.measures
 * @param {object} artifacts.meta
 * @param {string} etag Etag der Partitur - der Anker, an dem Notizen hängen
 * @param {object} [umgebung] nur für Tests
 * @param {(blob: Blob) => string} [umgebung.createObjectURL]
 * @param {(url: string) => void} [umgebung.revokeObjectURL]
 * @return {{files: object, revoke: () => void}} `files` in der Form der
 *   Serverantwort, `revoke()` gibt alle erzeugten URLs wieder frei
 */
export function createArtifactUrls(artifacts, etag, umgebung = {}) {
	const createObjectURL = umgebung.createObjectURL ?? ((blob) => URL.createObjectURL(blob))
	const revokeObjectURL = umgebung.revokeObjectURL ?? ((url) => URL.revokeObjectURL(url))

	const erzeugte = []
	const url = (inhalt, typ) => {
		const adresse = createObjectURL(new Blob([inhalt], { type: typ }))
		erzeugte.push(adresse)
		return adresse
	}

	const files = {
		pageCount: artifacts.pages.length,
		pages: artifacts.pages.map((svg) => url(svg, TYPEN.svg)),
		midi: url(artifacts.midi, TYPEN.midi),
		timingJson: url(JSON.stringify(artifacts.timing), TYPEN.json),
		measuresJson: url(JSON.stringify(artifacts.measures), TYPEN.json),
		metaJson: url(JSON.stringify(artifacts.meta), TYPEN.json),
		// Anker für Notizen - derselbe Etag, den der Server auch auf dem
		// gewöhnlichen Weg mitgibt. Er kommt aus der DATEI, nicht aus dem
		// Cache; deshalb funktionieren Notizen im Rückfall unverändert.
		etag,
	}

	return {
		files,
		revoke() {
			// Ohne das behält der Tab die Artefakte jeder je geöffneten
			// Partitur im Speicher: Eine Blob-URL hält ihren Blob am Leben,
			// bis sie widerrufen wird oder das Dokument endet.
			erzeugte.splice(0).forEach(revokeObjectURL)
		},
	}
}
