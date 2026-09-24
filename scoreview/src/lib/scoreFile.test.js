import { describe, expect, it } from 'vitest'
import { isSetlistFile, MSCZ_MIME, needsOwnFileAction } from './scoreFile.js'

describe('needsOwnFileAction', () => {
	it('greift bei .mscz ohne registrierten Mimetype', () => {
		expect(needsOwnFileAction({
			basename: 'Aequale.mscz',
			extension: '.mscz',
			mime: 'application/octet-stream',
		})).toBe(true)
	})

	it('haelt sich heraus, wo Nextclouds Viewer zustaendig ist', () => {
		expect(needsOwnFileAction({
			basename: 'Aequale.mscz',
			extension: '.mscz',
			mime: MSCZ_MIME,
		})).toBe(false)
	})

	it('faellt auf den Dateinamen zurueck, wenn `extension` fehlt', () => {
		expect(needsOwnFileAction({
			basename: 'Aequale.MSCZ',
			mime: 'application/octet-stream',
		})).toBe(true)
	})

	it('laesst andere Dateien in Ruhe', () => {
		expect(needsOwnFileAction({
			basename: 'Handbuch.pdf',
			extension: '.pdf',
			mime: 'application/pdf',
		})).toBe(false)
		// Kein Treffer auf einen Namen, der die Endung nur enthaelt.
		expect(needsOwnFileAction({
			basename: 'mscz-notizen.txt',
			extension: '.txt',
			mime: 'text/plain',
		})).toBe(false)
	})

	it('faellt bei fehlendem Knoten nicht um', () => {
		expect(needsOwnFileAction(null)).toBe(false)
		expect(needsOwnFileAction({})).toBe(false)
	})
})

describe('isSetlistFile', () => {
	it('erkennt eine Setliste am Namen, gleich welcher Mimetype', () => {
		expect(isSetlistFile({ basename: 'Konzert Herbst.setlist.md', mime: 'text/markdown', type: 'file' })).toBe(true)
		expect(isSetlistFile({ basename: 'KONZERT.SETLIST.MD', extension: '.MD' })).toBe(true)
	})

	it('laesst gewoehnliches Markdown bei Text', () => {
		expect(isSetlistFile({ basename: 'Notizen.md', extension: '.md', type: 'file' })).toBe(false)
		expect(isSetlistFile({ basename: 'setlist.md', type: 'file' })).toBe(false)
		expect(isSetlistFile({ basename: 'Konzert.setlist.md.bak', type: 'file' })).toBe(false)
	})

	it('nimmt keinen Ordner und nichts ohne Namen', () => {
		expect(isSetlistFile({ basename: 'Alt.setlist.md', type: 'folder' })).toBe(false)
		expect(isSetlistFile({})).toBe(false)
		expect(isSetlistFile(null)).toBe(false)
	})
})
