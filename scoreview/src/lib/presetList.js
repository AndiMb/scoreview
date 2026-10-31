// The instruments the mixer offers: what the loaded SoundFont really has.
// Pure, without a synthesizer - player.js hands over spessasynth's list.
//
// Since spessasynth 4.4 that list also carries the two GS User Drum Sets,
// drum programs 64 and 65. They are not in the SoundFont: a MIDI file fills
// them by SysEx, and until then they are empty kits. MuseScore writes no
// such SysEx, so in the mixer they would be two choices that stay silent.
// Measured on the bundled SoundFont: 4.3 offered 197 entries, 4.4 the same
// 197 plus exactly these two.

/** GS programs of the two User Drum Sets. */
const USER_DRUM_SET_PROGRAMS = new Set([64, 65])

/**
 * spessasynth puts its User Drum Sets on these patches and lets them shadow
 * a SoundFont preset with the same patch, so a drum patch 64/65 in the list
 * is always one of them.
 *
 * @param {Array<{program:number, isGMGSDrum:boolean}>|undefined} presets
 * @return {Array<object>} the presets without the User Drum Sets
 */
export function soundFontPresets(presets) {
	return (presets ?? []).filter((p) => !(p.isGMGSDrum && USER_DRUM_SET_PROGRAMS.has(p.program)))
}
