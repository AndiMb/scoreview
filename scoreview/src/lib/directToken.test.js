import { describe, expect, it } from 'vitest'
import {
	ausweisFuer,
	begleiterErneuerbar,
	COMPANION_HEADER,
	darfTokenTragen,
	dateiDerAnfrage,
	setlisteDerAnfrage,
	TOKEN_HEADER,
} from './directToken.js'

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

describe('Begleit-Token', () => {
	const begleiter = new Map([['43', 'b43'], ['50', 'b50'], ['42', 'b42']])
	const ausweis = { token: 'de', originFileId: 42, begleiter }

	it('liest die Datei aus dem Pfad der App-Routen', () => {
		expect(dateiDerAnfrage('/index.php/apps/scoreview/api/scores/43/status', EIGEN)).toBe('43')
		expect(dateiDerAnfrage('/apps/scoreview/api/scores/43/artifact/page-1?v=x', EIGEN)).toBe('43')
		expect(dateiDerAnfrage(`${EIGEN}/apps/scoreview/api/setlists/50`, EIGEN)).toBe('50')
		expect(dateiDerAnfrage('/apps/scoreview/api/soundfont', EIGEN)).toBeNull()
		expect(dateiDerAnfrage('/apps/scoreview/api/preferences', EIGEN)).toBeNull()
		expect(dateiDerAnfrage('/apps/scoreview/api/setlists', EIGEN)).toBeNull()
		expect(dateiDerAnfrage('/apps/andere/api/scores/43/status', EIGEN)).toBeNull()
	})

	it('erkennt die Setlisten-Datei selbst, nicht die Ausgabe', () => {
		expect(setlisteDerAnfrage('/index.php/apps/scoreview/api/setlists/50', EIGEN)).toBe('50')
		expect(setlisteDerAnfrage('/apps/scoreview/api/scores/42/setlists/50/tokens', EIGEN)).toBeNull()
		expect(setlisteDerAnfrage('/apps/scoreview/api/scores/42/setlists', EIGEN)).toBeNull()
		expect(setlisteDerAnfrage('https://fremde.example/apps/scoreview/api/setlists/50', EIGEN)).toBeNull()
	})

	it('schickt den Begleiter nur an seine Datei, das Direct-Editing-Token immer mit', () => {
		expect(ausweisFuer('/apps/scoreview/api/scores/43/status', EIGEN, ausweis))
			.toEqual({ [TOKEN_HEADER]: 'de', [COMPANION_HEADER]: 'b43' })
		expect(ausweisFuer('/apps/scoreview/api/setlists/50', EIGEN, ausweis))
			.toEqual({ [TOKEN_HEADER]: 'de', [COMPANION_HEADER]: 'b50' })
		expect(ausweisFuer('/apps/scoreview/api/scores/44/status', EIGEN, ausweis))
			.toEqual({ [TOKEN_HEADER]: 'de' })
		expect(ausweisFuer('/apps/scoreview/api/soundfont', EIGEN, ausweis))
			.toEqual({ [TOKEN_HEADER]: 'de' })
	})

	/** Die Datei des Direct-Editing-Tokens - und damit die Ausgabe neuer Token - bekommt nie einen Begleiter. */
	it('schickt fuer die eigene Datei keinen Begleiter', () => {
		expect(ausweisFuer('/apps/scoreview/api/scores/42/setlists/50/tokens', EIGEN, ausweis))
			.toEqual({ [TOKEN_HEADER]: 'de' })
	})

	it('schickt an eine fremde Herkunft gar nichts', () => {
		expect(ausweisFuer('https://fremde.example/apps/scoreview/api/scores/43/status', EIGEN, ausweis)).toEqual({})
		expect(ausweisFuer('blob:https://wolke.example/1', EIGEN, ausweis)).toEqual({})
	})

	it('erneuert nur abgelaufene oder widerrufene Begleiter', () => {
		expect(begleiterErneuerbar(401, 'companion_expired')).toBe(true)
		expect(begleiterErneuerbar(401, 'companion_revoked')).toBe(true)
		expect(begleiterErneuerbar(401, 'companion_invalid')).toBe(true)
		expect(begleiterErneuerbar(401, 'token_expired')).toBe(false)
		expect(begleiterErneuerbar(403, 'companion_purpose')).toBe(false)
		expect(begleiterErneuerbar(403, 'token_file_mismatch')).toBe(false)
	})
})
