import { describe, expect, it } from 'vitest'
import { createArtifactUrls } from './artifactUrls.js'

/**
 * Der Rückfall im Browser trägt nur, solange sein `files`-Objekt **genau** so
 * aussieht wie das des Servers. Fehlt ein Schlüssel, merkt es der Viewer erst
 * beim Abspielen oder beim Anlegen einer Notiz - und dann sieht es nach einem
 * Fehler im Viewer aus, nicht nach einem im Rückfall. Deshalb steht die
 * Serverform hier als Festwert daneben.
 */

/**
 * Die Schlüssel aus Controller\ConversionController::buildFileUrls().
 * Ändert sich dort etwas, muss es sich hier auch ändern.
 */
const SCHLUESSEL_DES_SERVERS = ['pageCount', 'pages', 'midi', 'timingJson', 'measuresJson', 'metaJson', 'etag']

/** Zählt mit, was erzeugt und was wieder freigegeben wurde. */
function urlAttrappe() {
	const erzeugt = []
	const freigegeben = []
	return {
		erzeugt,
		freigegeben,
		createObjectURL(blob) {
			const adresse = `blob:test/${erzeugt.length}`
			erzeugt.push({ adresse, typ: blob.type })
			return adresse
		},
		revokeObjectURL(adresse) {
			freigegeben.push(adresse)
		},
	}
}

const artefakte = {
	pages: ['<svg>1</svg>', '<svg>2</svg>', '<svg>3</svg>'],
	midi: new Uint8Array([77, 84, 104, 100]),
	timing: { events: [{ elid: 1, timeMs: 0 }], elements: {} },
	measures: { events: [], elements: {} },
	meta: { pages: 3, measures: 12 },
}

describe('createArtifactUrls', () => {
	it('liefert genau die Schlüssel, die der Server liefert', () => {
		const { files } = createArtifactUrls(artefakte, 'etag-1', urlAttrappe())
		expect(Object.keys(files).sort()).toEqual([...SCHLUESSEL_DES_SERVERS].sort())
	})

	it('zählt die Seiten wie der Server aus der Zahl der Seiten', () => {
		const { files } = createArtifactUrls(artefakte, 'etag-1', urlAttrappe())
		expect(files.pageCount).toBe(3)
		expect(files.pages).toHaveLength(3)
	})

	it('reicht den Etag durch - daran hängen die Notizanker', () => {
		const { files } = createArtifactUrls(artefakte, 'etag-42', urlAttrappe())
		expect(files.etag).toBe('etag-42')
	})

	it('gibt jedem Artefakt den Typ, an dem axios die Antwort erkennt', () => {
		const url = urlAttrappe()
		createArtifactUrls(artefakte, 'etag-1', url)
		// Drei Seiten, MIDI, dann die drei JSON-Dateien - in dieser Reihenfolge
		// erzeugt. Der JSON-Typ ist nicht Kosmetik: Ohne ihn liefert axios die
		// Zeitleiste als Zeichenkette statt als Objekt.
		expect(url.erzeugt.map((e) => e.typ)).toEqual([
			'image/svg+xml',
			'image/svg+xml',
			'image/svg+xml',
			'audio/midi',
			'application/json',
			'application/json',
			'application/json',
		])
	})

	it('gibt beim Freigeben jede erzeugte Adresse zurück', () => {
		const url = urlAttrappe()
		const { revoke } = createArtifactUrls(artefakte, 'etag-1', url)
		revoke()
		expect(url.freigegeben).toEqual(url.erzeugt.map((e) => e.adresse))
	})

	it('gibt beim zweiten Freigeben nichts doppelt frei', () => {
		// reset() im Viewer ruft release() auch dann, wenn schon aufgeräumt
		// wurde. Eine zweite Freigabe derselben Adresse wäre folgenlos, aber
		// sie würde verbergen, dass hier zweimal aufgeräumt wird.
		const url = urlAttrappe()
		const { revoke } = createArtifactUrls(artefakte, 'etag-1', url)
		revoke()
		revoke()
		expect(url.freigegeben).toHaveLength(url.erzeugt.length)
	})
})
