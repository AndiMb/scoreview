import { describe, expect, it } from 'vitest'
import { createAudioSession } from './audioSession.js'

/** A navigator whose audio session records every write. */
function fakeNavigator(initial = 'auto') {
	const writes = []
	let type = initial
	return {
		writes,
		audioSession: {
			get type() {
				return type
			},
			set type(value) {
				writes.push(value)
				type = value
			},
		},
	}
}

describe('createAudioSession', () => {
	it('does nothing where the API is missing', () => {
		const session = createAudioSession({})
		expect(() => {
			session.forPlayback()
			session.forCapture()()
			session.reset()
		}).not.toThrow()
		expect(() => createAudioSession(undefined).forPlayback()).not.toThrow()
	})

	it('sets playback before a sound', () => {
		const nav = fakeNavigator()
		createAudioSession(nav).forPlayback()
		expect(nav.audioSession.type).toBe('playback')
	})

	it('keeps play-and-record while capturing, also when playback starts', () => {
		const nav = fakeNavigator()
		const session = createAudioSession(nav)
		session.forPlayback()
		const release = session.forCapture()
		expect(nav.audioSession.type).toBe('play-and-record')
		session.forPlayback()
		expect(nav.audioSession.type).toBe('play-and-record')
		release()
		expect(nav.audioSession.type).toBe('playback')
	})

	it('counts captures, and a second release does not count twice', () => {
		const nav = fakeNavigator()
		const session = createAudioSession(nav)
		const first = session.forCapture()
		const second = session.forCapture()
		first()
		first()
		expect(nav.audioSession.type).toBe('play-and-record')
		second()
		expect(nav.audioSession.type).not.toBe('play-and-record')
	})

	it('writes only on a change', () => {
		const nav = fakeNavigator()
		const session = createAudioSession(nav)
		session.forPlayback()
		session.forPlayback()
		session.forPlayback()
		expect(nav.writes).toEqual(['playback'])
	})

	it('goes back to auto on reset, and to auto after a capture released later', () => {
		const nav = fakeNavigator()
		const session = createAudioSession(nav)
		session.forPlayback()
		session.reset()
		expect(nav.audioSession.type).toBe('auto')

		session.forPlayback()
		const release = session.forCapture()
		session.reset()
		// A microphone still open keeps its type ...
		expect(nav.audioSession.type).toBe('play-and-record')
		release()
		// ... and the viewer that closed meanwhile is not playing any more.
		expect(nav.audioSession.type).toBe('auto')
	})

	it('survives a setter that throws', () => {
		const nav = {
			audioSession: {
				type: 'auto',
			},
		}
		Object.defineProperty(nav.audioSession, 'type', {
			get: () => 'auto',
			set: () => {
				throw new TypeError('not supported')
			},
		})
		const session = createAudioSession(nav)
		expect(() => session.forPlayback()).not.toThrow()
		expect(() => session.forCapture()()).not.toThrow()
	})
})
