import { describe, expect, it } from 'vitest'
import { normalizeFeatures } from './featureFlags.js'

describe('normalizeFeatures', () => {
	it('schaltet ohne Anfangszustand alles aus', () => {
		expect(normalizeFeatures(null)).toEqual({
			followSession: false,
			recording: false,
			intonation: false,
			scoreFollower: false,
			followPollMs: 800,
			maxRecordingsPerScore: 5,
			maxRecordingSeconds: 600,
		})
	})

	it('uebernimmt, was der Server liefert', () => {
		const raw = {
			followSession: true,
			recording: false,
			intonation: true,
			scoreFollower: false,
			followPollMs: 1200,
			maxRecordingsPerScore: 3,
			maxRecordingSeconds: 300,
		}
		expect(normalizeFeatures(raw)).toEqual(raw)
	})

	it('nimmt nur echtes true als eingeschaltet und begrenzt die Zahlen', () => {
		const features = normalizeFeatures({ followSession: 'true', followPollMs: 10, maxRecordingSeconds: 'viel' })
		expect(features.followSession).toBe(false)
		expect(features.followPollMs).toBe(500)
		expect(features.maxRecordingSeconds).toBe(600)
	})
})
