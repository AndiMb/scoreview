import { describe, expect, it } from 'vitest'
import { computeEffectiveVolumes, resolveMixerChannels } from './mixerLayout.js'

describe('resolveMixerChannels', () => {
	// tracks[].name ist bei MuseScore 4 fuer jede Stimme "MS Basic" (Name der
	// Klangbibliothek) - echte meta.json-Daten, siehe mixerLayout.js.
	const tracks = [
		{ instrumentId: 'soprano', name: 'MS Basic', partId: '1', type: 'fluid_soundfont' },
		{ instrumentId: 'alto', name: 'MS Basic', partId: '2', type: 'fluid_soundfont' },
		{ instrumentId: 'tenor', name: 'MS Basic', partId: '3', type: 'fluid_soundfont' },
		{ instrumentId: 'bass', name: 'MS Basic', partId: '4', type: 'fluid_soundfont' },
		{ instrumentId: 'metronome', name: 'MS Basic', partId: '999', type: 'fluid_soundfont' },
	]
	const parts = [
		{ id: '1', name: 'Soprano', instrumentId: 'soprano', program: 52 },
		{ id: '2', name: 'Alto', instrumentId: 'alto', program: 52 },
		{ id: '3', name: 'Tenor', instrumentId: 'tenor', program: 52 },
		{ id: '4', name: 'Bass', instrumentId: 'bass', program: 52 },
	]

	it('ordnet Kanäle nach Index zu und benennt sie nach dem Part (M6-Beispiel: SATB + Metronom)', () => {
		expect(resolveMixerChannels(tracks, parts)).toEqual([
			{ channel: 0, instrumentId: 'soprano', name: 'Soprano', partId: '1', program: 52 },
			{ channel: 1, instrumentId: 'alto', name: 'Alto', partId: '2', program: 52 },
			{ channel: 2, instrumentId: 'tenor', name: 'Tenor', partId: '3', program: 52 },
			{ channel: 3, instrumentId: 'bass', name: 'Bass', partId: '4', program: 52 },
			// Die Metronomspur hat keinen Part - Fallback auf die instrumentId,
			// nicht auf das nichtssagende "MS Basic".
			{ channel: 4, instrumentId: 'metronome', name: 'metronome', partId: '999', program: 0 },
		])
	})

	it('faellt ohne parts auf die instrumentId zurück statt auf den Klangbibliotheksnamen', () => {
		expect(resolveMixerChannels(tracks).map((c) => c.name))
			.toEqual(['soprano', 'alto', 'tenor', 'bass', 'metronome'])
	})

	it('liefert eine leere Liste ohne tracks', () => {
		expect(resolveMixerChannels(undefined)).toEqual([])
		expect(resolveMixerChannels([])).toEqual([])
	})
})

describe('computeEffectiveVolumes', () => {
	it('ohne Solo: nur die eigene Mute-Einstellung zählt', () => {
		const states = [
			{ channel: 0, volume: 100, muted: false, solo: false },
			{ channel: 1, volume: 80, muted: true, solo: false },
		]
		const result = computeEffectiveVolumes(states)
		expect(result.get(0)).toBe(100)
		expect(result.get(1)).toBe(0)
	})

	it('mit mindestens einem Solo: nur nicht gemutete Solo-Kanäle sind hörbar', () => {
		const states = [
			{ channel: 0, volume: 100, muted: false, solo: true },
			{ channel: 1, volume: 90, muted: false, solo: false },
			{ channel: 2, volume: 80, muted: true, solo: true },
		]
		const result = computeEffectiveVolumes(states)
		expect(result.get(0)).toBe(100)
		expect(result.get(1)).toBe(0)
		// Solo UND gemutet -> weiterhin stumm (Mute gewinnt).
		expect(result.get(2)).toBe(0)
	})

	it('liefert eine leere Map für eine leere Kanalliste', () => {
		expect(computeEffectiveVolumes([]).size).toBe(0)
	})
})
