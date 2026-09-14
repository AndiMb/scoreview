import { describe, expect, it } from 'vitest'
import { darfTokenTragen } from './directToken.js'

const EIGEN = 'https://wolke.example'

describe('darfTokenTragen', () => {
	it('traegt den Token an relative Pfade der eigenen Instanz', () => {
		expect(darfTokenTragen('/apps/scoreview/api/scores/7/status', EIGEN)).toBe(true)
		expect(darfTokenTragen('apps/scoreview/api/soundfont', EIGEN)).toBe(true)
	})

	it('traegt ihn auch an absolute URLs derselben Herkunft', () => {
		expect(darfTokenTragen(`${EIGEN}/apps/scoreview/api/engine/x.wasm`, EIGEN)).toBe(true)
	})

	/**
	 * Der Grund fuer die Herkunftspruefung: Das SoundFont kann per
	 * `soundfont_url` von einem fremden Host kommen.
	 */
	it('traegt ihn nicht an eine fremde Herkunft', () => {
		expect(darfTokenTragen('https://fremde.example/soundfont.sf3', EIGEN)).toBe(false)
		expect(darfTokenTragen('//fremde.example/soundfont.sf3', EIGEN)).toBe(false)
	})

	/** Auch ein anderer Port oder ein anderes Schema ist eine andere Herkunft. */
	it('unterscheidet Port und Schema', () => {
		expect(darfTokenTragen('https://wolke.example:8443/x', EIGEN)).toBe(false)
		expect(darfTokenTragen('http://wolke.example/x', EIGEN)).toBe(false)
	})

	/**
	 * Der Rueckfall im Browser reicht Artefakte als Blob-URLs durch dieselben
	 * Aufrufe (lib/artifactUrls.js).
	 */
	it('laesst blob: und data: aus', () => {
		expect(darfTokenTragen('blob:https://wolke.example/1234-5678', EIGEN)).toBe(false)
		expect(darfTokenTragen('data:application/json,{}', EIGEN)).toBe(false)
	})

	it('entscheidet bei fehlender URL fuer die eigene Instanz', () => {
		expect(darfTokenTragen('', EIGEN)).toBe(true)
		expect(darfTokenTragen(undefined, EIGEN)).toBe(true)
	})

	it('haengt an einer unlesbaren URL nichts an', () => {
		expect(darfTokenTragen('http://[nicht so', EIGEN)).toBe(false)
	})
})
