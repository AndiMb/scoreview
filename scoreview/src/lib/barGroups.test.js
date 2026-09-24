import { describe, expect, it } from 'vitest'
import { anyGroupActive, barGroups, groupActive } from './barGroups.js'
import { allowed } from './interactionPolicy.js'

function ctx(overrides = {}) {
	return {
		can: () => true,
		hasRealPlayer: true,
		canFocusMyPart: true,
		recordingEnabled: true,
		intonationEnabled: false,
		setlistCanCreate: true,
		isLeader: false,
		...overrides,
	}
}

const IDLE = {
	metronomeEnabled: false,
	loopActive: false,
	trainerActive: false,
	showMixer: false,
	showPractice: false,
	focusMyPart: false,
	showNoteText: false,
	showAnnotations: false,
	showRehearsal: false,
	setlistEditorMode: null,
}

describe('barGroups', () => {
	it('ordnet alle Werkzeuge ihrer Gruppe zu', () => {
		expect(barGroups(ctx())).toEqual([
			{ id: 'practice', items: ['loop', 'tempo', 'metronome', 'toneMode', 'mixer', 'practice'] },
			{ id: 'view', items: ['zoom', 'appearance', 'myPart', 'noteText', 'annotations'] },
			{ id: 'rehearsal', items: ['rehearsal', 'newSetlist'] },
		])
	})

	it('stellt die Probe fuer Leitungen nach vorn', () => {
		expect(barGroups(ctx({ isLeader: true })).map((g) => g.id))
			.toEqual(['rehearsal', 'practice', 'view'])
	})

	it('laesst im Auffuehrungsmodus nur Zoom stehen', () => {
		const can = (action) => allowed(action, { performance: true })
		expect(barGroups(ctx({ can }))).toEqual([{ id: 'view', items: ['zoom'] }])
	})

	it('laesst beim Folgen alles stehen, was die Regel erlaubt', () => {
		const can = (action) => allowed(action, { following: true })
		expect(barGroups(ctx({ can })).map((g) => g.id)).toEqual(['practice', 'view', 'rehearsal'])
	})

	it('blendet Werkzeuge ohne ihre Voraussetzung aus', () => {
		const groups = barGroups(ctx({
			hasRealPlayer: false,
			canFocusMyPart: false,
			recordingEnabled: false,
			setlistCanCreate: false,
		}))
		expect(groups).toEqual([
			{ id: 'practice', items: ['loop', 'tempo', 'metronome'] },
			{ id: 'view', items: ['zoom', 'appearance', 'noteText', 'annotations'] },
			{ id: 'rehearsal', items: ['rehearsal'] },
		])
	})

	it('zeigt Aufnahme auch, wenn nur die Intonation eingeschaltet ist', () => {
		const practice = barGroups(ctx({ recordingEnabled: false, intonationEnabled: true }))[0]
		expect(practice.items).toContain('practice')
	})
})

describe('groupActive', () => {
	it('setzt ohne eingeschaltetes Werkzeug keinen Punkt', () => {
		for (const id of ['practice', 'view', 'rehearsal']) {
			expect(groupActive(id, IDLE)).toBe(false)
		}
		expect(anyGroupActive(IDLE)).toBe(false)
	})

	it.each([
		['metronomeEnabled', 'practice'],
		['loopActive', 'practice'],
		['trainerActive', 'practice'],
		['showMixer', 'practice'],
		['showPractice', 'practice'],
		['focusMyPart', 'view'],
		['showNoteText', 'view'],
		['showAnnotations', 'view'],
		['showRehearsal', 'rehearsal'],
	])('%s setzt den Punkt an %s und nur dort', (flag, group) => {
		const state = { ...IDLE, [flag]: true }
		for (const id of ['practice', 'view', 'rehearsal']) {
			expect(groupActive(id, state)).toBe(id === group)
		}
		expect(anyGroupActive(state)).toBe(true)
	})

	it('zaehlt nur den Editor fuer eine NEUE Setliste zur Probe', () => {
		expect(groupActive('rehearsal', { ...IDLE, setlistEditorMode: 'new' })).toBe(true)
		expect(groupActive('rehearsal', { ...IDLE, setlistEditorMode: 'edit' })).toBe(false)
	})
})
