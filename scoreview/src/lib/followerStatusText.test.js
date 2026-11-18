import { describe, expect, it } from 'vitest'
import { followerStatusText } from './followerStatusText.js'

const t = (text) => `[${text}]`
const of = (over) => followerStatusText({ error: '', active: true, phase: 'waiting', held: false, ...over }, t)

describe('followerStatusText', () => {
	it('shows an error before anything else, untranslated', () => {
		expect(of({ error: 'No microphone', active: false })).toBe('No microphone')
	})

	it('says nothing while not listening', () => {
		expect(of({ active: false })).toBe('')
	})

	it('tells a held wait from the first one', () => {
		expect(of({ phase: 'waiting' })).toBe('[Listening - tap the note where the singing starts]')
		expect(of({ phase: 'waiting', held: true })).toBe('[Waiting - tap the note where you start again]')
	})

	it('names following, unsure and lost', () => {
		expect(of({ phase: 'following' })).toBe('[Following]')
		expect(of({ phase: 'unsure' })).toBe('[Following]')
		expect(of({ phase: 'lost' })).toBe('[Lost the place - tap the note where you are]')
		expect(of({ phase: 'starting' })).toBe('[Listening - tap the note where the singing starts]')
	})
})
