import { describe, expect, it } from 'vitest'
import { browserFileUrl, classifyMicError, mayUseCapturePath, MIC_CONSTRAINTS } from './micAccess.js'

describe('classifyMicError', () => {
	it.each([
		['NotAllowedError', 'blocked'],
		['SecurityError', 'blocked'],
		['NotSupportedError', 'blocked'],
		['NotFoundError', 'noDevice'],
		['OverconstrainedError', 'noDevice'],
		['NotReadableError', 'busy'],
		['AbortError', 'busy'],
		['Irgendwas', 'other'],
	])('%s -> %s', (name, erwartet) => {
		expect(classifyMicError({ name })).toBe(erwartet)
	})

	it('ohne Fehlerobjekt: other', () => {
		expect(classifyMicError(null)).toBe('other')
	})
})

describe('mayUseCapturePath (S7)', () => {
	it('Aufnahme und Intonation ja, das Mitverfolgen nie', () => {
		expect(mayUseCapturePath('recorder')).toBe(true)
		expect(mayUseCapturePath('intonation')).toBe(true)
		expect(mayUseCapturePath('follower')).toBe(false)
		expect(mayUseCapturePath('irgendwer')).toBe(false)
	})
})

describe('MIC_CONSTRAINTS', () => {
	it('schaltet jede Verarbeitung des Browsers ab', () => {
		expect(MIC_CONSTRAINTS.audio).toMatchObject({ echoCancellation: false, noiseSuppression: false, autoGainControl: false })
	})
})

describe('browserFileUrl', () => {
	it('fuehrt ueber Nextclouds Kurzlink zur Datei', () => {
		expect(browserFileUrl('https://cloud.example.org', '', 42)).toBe('https://cloud.example.org/index.php/f/42')
		expect(browserFileUrl('https://x.org', '/nextcloud/', '7')).toBe('https://x.org/nextcloud/index.php/f/7')
	})
})
