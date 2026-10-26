import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { readTrackLayout } from './midiNotes.js'
import { groupPrograms, resolveMixerChannels, resolveMixerGroups } from './mixerLayout.js'

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
			{ key: '1', name: 'Sopran', partId: '1', program: 52, channels: [0, 1], voices: 2 },
			{ key: '2', name: 'Alt', partId: '2', program: 52, channels: [2], voices: 1 },
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

describe('chord symbols and further channels (chords-test.mid, see midiNotes.test.js)', () => {
	const layout = readTrackLayout(readFileSync(new URL('./__fixtures__/chords-test.mid', import.meta.url)))
	const parts = [
		{ id: '1', name: 'Flute', instrumentId: 'flute', program: 73, harmonyCount: 4 },
		{ id: '2', name: 'Piano', instrumentId: 'piano', program: 0, harmonyCount: 4 },
		{ id: '3', name: 'Contrabass', instrumentId: 'contrabass', program: 43, harmonyCount: 0 },
	]
	const channels = resolveMixerChannels([], parts, layout)

	it('gives every part all of its channels, and chord symbols their own entry', () => {
		expect(channels.map((c) => [c.channel, c.partId, c.harmonyOf ?? null, c.program, c.articulation ?? false])).toEqual([
			[0, '1', null, 73, false],
			[1, null, '1', 0, false],
			[2, '2', null, 0, false],
			[6, null, '2', 0, false],
			[3, '3', null, 43, false],
			[4, '3', null, 32, true],
			[5, '3', null, 44, true],
		])
	})

	it("makes one mixer row per part and one for each part's chord symbols", () => {
		expect(resolveMixerGroups(channels).map((g) => [g.key, g.name, g.channels, g.voices, g.harmonyOf ?? null])).toEqual([
			['1', 'Flute', [0], 1, null],
			['harmony-1', 'Flute', [1], 1, '1'],
			['2', 'Piano', [2], 1, null],
			['harmony-2', 'Piano', [6], 1, '2'],
			['3', 'Contrabass', [3, 4, 5], 1, null],
		])
	})

	it('takes no chord channel from a part without chord symbols', () => {
		const none = parts.map((p) => ({ ...p, harmonyCount: 0 }))
		expect(resolveMixerChannels([], none, layout).filter((c) => c.harmonyOf !== undefined)).toEqual([])
	})

	it("changes the instrument on all of a row's channels", () => {
		const contrabass = resolveMixerGroups(channels).find((g) => g.key === '3')
		expect(groupPrograms(contrabass, channels, 42)).toEqual([
			{ channel: 3, program: 42 },
			{ channel: 4, program: 42 },
			{ channel: 5, program: 42 },
		])
	})

	it("gives every channel its own sound back when the row's instrument is chosen again", () => {
		const contrabass = resolveMixerGroups(channels).find((g) => g.key === '3')
		expect(groupPrograms(contrabass, channels, 43)).toEqual([
			{ channel: 3, program: 43 },
			{ channel: 4, program: 32 },
			{ channel: 5, program: 44 },
		])
	})

	it('falls back to the index when the tracks cannot be grouped onto the parts', () => {
		expect(resolveMixerChannels([], parts.slice(0, 2), layout).map((c) => c.channel)).toEqual([0, 1])
	})
})
