import { describe, expect, it } from 'vitest'
import { soundFontPresets } from './presetList.js'

describe('soundFontPresets', () => {
	const piano = { bankMSB: 0, bankLSB: 0, program: 0, isGMGSDrum: false, name: 'Piano' }
	const standard = { bankMSB: 0, bankLSB: 0, program: 0, isGMGSDrum: true, name: 'Standard' }
	const user1 = { bankMSB: 0, bankLSB: 0, program: 64, isGMGSDrum: true, name: 'User Drum Set 1' }
	const user2 = { bankMSB: 0, bankLSB: 0, program: 65, isGMGSDrum: true, name: 'User Drum Set 2' }

	it('drops the two GS User Drum Sets', () => {
		expect(soundFontPresets([user1, piano, user2, standard])).toEqual([piano, standard])
	})

	it('keeps melodic presets on programs 64 and 65', () => {
		const sax = { bankMSB: 0, bankLSB: 0, program: 64, isGMGSDrum: false, name: 'Soprano Sax' }
		const alto = { bankMSB: 0, bankLSB: 0, program: 65, isGMGSDrum: false, name: 'Alto Sax' }
		expect(soundFontPresets([sax, alto])).toEqual([sax, alto])
	})

	it('copes with no list', () => {
		expect(soundFontPresets(undefined)).toEqual([])
	})
})
