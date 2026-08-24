import { describe, expect, it } from 'vitest'
import { computeEffectiveVolumes, computeVoiceFocusVolumes, resolveMixerChannels, resolveMixerGroups } from './mixerLayout.js'

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

	it('schliesst die Metronomspur aus (traegt nachweislich keine MIDI-Noten) und benennt die uebrigen nach dem Part', () => {
		expect(resolveMixerChannels(tracks, parts)).toEqual([
			{ channel: 0, instrumentId: 'soprano', name: 'Soprano', partId: '1', program: 52 },
			{ channel: 1, instrumentId: 'alto', name: 'Alto', partId: '2', program: 52 },
			{ channel: 2, instrumentId: 'tenor', name: 'Tenor', partId: '3', program: 52 },
			{ channel: 3, instrumentId: 'bass', name: 'Bass', partId: '4', program: 52 },
		])
	})

	it('faellt ohne parts auf die instrumentId zurück statt auf den Klangbibliotheksnamen', () => {
		expect(resolveMixerChannels(tracks).map((c) => c.name))
			.toEqual(['soprano', 'alto', 'tenor', 'bass'])
	})

	it('faellt bei leeren tracks auf parts zurück (M8: repeat-test.mscz liefert tracks:[] bei gefuellten parts)', () => {
		const soloParts = [{ id: '1', name: 'Test', instrumentId: 'grand-piano', program: 0 }]
		expect(resolveMixerChannels([], soloParts)).toEqual([
			{ channel: 0, instrumentId: 'grand-piano', name: 'Test', partId: '1', program: 0 },
		])
	})

	it('liefert eine leere Liste ohne tracks und ohne parts', () => {
		expect(resolveMixerChannels(undefined)).toEqual([])
		expect(resolveMixerChannels([])).toEqual([])
	})

	it('bevorzugt echte, aus dem MIDI gelesene Kanäle vor dem Track-Index (gemessen an duckwerk: Sopran/Alt/Tenor/Bariton/Bass auf MIDI-Kanal 0/2/3/1/6, nicht 0-4)', () => {
		const duckwerkTracks = [
			{ instrumentId: 'grand-piano', name: 'MS Basic', partId: '1' },
			{ instrumentId: 'grand-piano', name: 'MS Basic', partId: '2' },
			{ instrumentId: 'grand-piano', name: 'MS Basic', partId: '3' },
			{ instrumentId: 'grand-piano', name: 'MS Basic', partId: '4' },
			{ instrumentId: 'grand-piano', name: 'MS Basic', partId: '5' },
			{ instrumentId: 'metronome', name: 'MS Basic', partId: '999' },
		]
		const duckwerkParts = [
			{ id: '1', name: 'Sopran', instrumentId: 'grand-piano', program: 0 },
			{ id: '2', name: 'Alt', instrumentId: 'grand-piano', program: 0 },
			{ id: '3', name: 'Tenor', instrumentId: 'grand-piano', program: 0 },
			{ id: '4', name: 'Bariton', instrumentId: 'grand-piano', program: 0 },
			{ id: '5', name: 'Bass', instrumentId: 'grand-piano', program: 0 },
		]
		const trackChannels = [[0], [2], [3], [1], [6]]
		expect(resolveMixerChannels(duckwerkTracks, duckwerkParts, trackChannels).map((c) => [c.name, c.channel]))
			.toEqual([['Sopran', 0], ['Alt', 2], ['Tenor', 3], ['Bariton', 1], ['Bass', 6]])
	})

	it('faellt bei einer Laengenabweichung zwischen trackChannels und den Spuren sichtbar auf den Index zurück, statt falsch zuzuordnen', () => {
		expect(resolveMixerChannels(tracks, parts, [[0], [1]]).map((c) => c.channel)).toEqual([0, 1, 2, 3])
	})
})

describe('resolveMixerGroups', () => {
	it('fasst Kanäle mit derselben partId zu einer Gruppe zusammen (Divisi)', () => {
		const channels = [
			{ channel: 0, instrumentId: 'soprano-1', name: 'Sopran', partId: '1', program: 52 },
			{ channel: 1, instrumentId: 'soprano-2', name: 'Sopran', partId: '1', program: 52 },
			{ channel: 2, instrumentId: 'alto', name: 'Alt', partId: '2', program: 52 },
		]
		expect(resolveMixerGroups(channels)).toEqual([
			{ key: '1', name: 'Sopran', partId: '1', program: 52, channels: [0, 1] },
			{ key: '2', name: 'Alt', partId: '2', program: 52, channels: [2] },
		])
	})

	it('liefert eine Gruppe pro Kanal, wenn keine partId geteilt wird', () => {
		const channels = [
			{ channel: 0, instrumentId: 'soprano', name: 'Soprano', partId: '1', program: 52 },
			{ channel: 1, instrumentId: 'alto', name: 'Alto', partId: '2', program: 52 },
		]
		expect(resolveMixerGroups(channels).map((g) => g.channels)).toEqual([[0], [1]])
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

describe('computeVoiceFocusVolumes', () => {
	it('hebt die eigenen Kanäle an und dämpft die übrigen, statt sie stumm zu schalten', () => {
		const result = computeVoiceFocusVolumes([0, 1, 2, 3], [0, 1])
		expect(result.get(0)).toBe(127)
		expect(result.get(1)).toBe(127)
		expect(result.get(2)).toBe(40)
		expect(result.get(3)).toBe(40)
	})

	it('erlaubt eigene loud/quiet-Werte', () => {
		const result = computeVoiceFocusVolumes([0, 1], [0], { loud: 100, quiet: 20 })
		expect(result.get(0)).toBe(100)
		expect(result.get(1)).toBe(20)
	})
})
