import { describe, expect, it, vi } from 'vitest'
import { createBridge } from './mobileBridge.js'

describe('createBridge', () => {
	it('erkennt die Android-Bruecke und ruft ihre Methoden', () => {
		const loaded = vi.fn()
		const close = vi.fn()
		const bruecke = createBridge({ DirectEditingMobileInterface: { loaded, close } })

		expect(bruecke.verfuegbar).toBe(true)
		expect(bruecke.loaded()).toBe(true)
		expect(loaded).toHaveBeenCalledOnce()
		bruecke.close()
		expect(close).toHaveBeenCalledOnce()
	})

	it('schickt auf iOS den Namen als Nutzlast an den einen Handler', () => {
		const postMessage = vi.fn()
		const bruecke = createBridge({
			webkit: { messageHandlers: { DirectEditingMobileInterface: { postMessage } } },
		})

		expect(bruecke.verfuegbar).toBe(true)
		bruecke.reload()
		expect(postMessage).toHaveBeenCalledWith('reload')
	})

	/**
	 * Dieselbe Seite laeuft auch im gewoehnlichen Browser - dort darf ein
	 * Aufruf nichts tun, statt die Seite mitzunehmen.
	 */
	it('bleibt ohne Bruecke wirkungslos statt zu werfen', () => {
		const bruecke = createBridge({})

		expect(bruecke.verfuegbar).toBe(false)
		expect(bruecke.loaded()).toBe(false)
		expect(() => bruecke.close()).not.toThrow()
	})

	it('meldet eine Methode, die die App gar nicht kennt, als nicht zugestellt', () => {
		const bruecke = createBridge({ DirectEditingMobileInterface: { loaded: () => {} } })

		expect(bruecke.loaded()).toBe(true)
		expect(bruecke.share()).toBe(false)
	})

	/** Eine WebView, die beim Aufruf wirft, darf die Seite nicht mitnehmen. */
	it('faengt einen Fehler der Bruecke ab', () => {
		const bruecke = createBridge({
			DirectEditingMobileInterface: {
				close: () => {
					throw new Error('Activity ist schon weg')
				},
			},
		})

		expect(bruecke.close()).toBe(false)
	})

	it('kommt mit einem Fenster ohne alles zurecht', () => {
		expect(createBridge(undefined).verfuegbar).toBe(false)
		expect(createBridge(null).verfuegbar).toBe(false)
	})
})
