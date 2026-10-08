import { describe, expect, it } from 'vitest'
import { anyGroupActive, barGroups, groupActive } from './barGroups.js'
import { allowed } from './interactionPolicy.js'

function ctx(overrides = {}) {
	return {
		can: () => true,
		hasRealPlayer: true,
		canFocusMyPart: true,
		canCoach: true,
		recordingEnabled: true,
		intonationEnabled: false,
		setlistCanCreate: true,
		isLeader: false,
		exportEnabled: true,
		offlineEnabled: true,
		offline: false,
		standalone: false,
		...overrides,
	}
}

const IDLE = {
	metronomeEnabled: false,
	loopActive: false,
	trainerActive: false,
	showMixer: false,
	showPractice: false,
	coachActive: false,
	transposed: false,
	focusMyPart: false,
	showNoteNames: false,
	showNoteText: false,
	showAnnotations: false,
	showRehearsal: false,
	setlistEditorMode: null,
}

describe('barGroups', () => {
	it('ordnet alle Werkzeuge ihrer Gruppe zu', () => {
		expect(barGroups(ctx())).toEqual([
			{ id: 'practice', items: ['loop', 'tempo', 'metronome', 'toneMode', 'mixer', 'coach', 'transpose', 'practice', 'export'] },
			{ id: 'view', items: ['zoom', 'layout', 'appearance', 'myPart', 'noteNames', 'noteText', 'annotations', 'pin'] },
			{ id: 'rehearsal', items: ['rehearsal', 'newSetlist'] },
		])
	})

	it('nimmt offline alles weg, was den Server braucht (E14)', () => {
		const can = (action) => allowed(action, { offline: true })
		expect(barGroups(ctx({ can, offline: true }))).toEqual([
			{ id: 'practice', items: ['loop', 'tempo', 'metronome', 'toneMode', 'mixer', 'coach', 'transpose'] },
			{ id: 'view', items: ['zoom', 'layout', 'appearance', 'myPart', 'noteNames', 'noteText'] },
		])
	})

	it('bietet Vormerken in den Apps nicht an', () => {
		const view = barGroups(ctx({ standalone: true }))[1]
		expect(view.items).not.toContain('pin')
	})

	it('zeigt Export und Vormerken nur, wenn die Administration sie erlaubt', () => {
		const groups = barGroups(ctx({ exportEnabled: false, offlineEnabled: false }))
		expect(groups[0].items).not.toContain('export')
		expect(groups[1].items).not.toContain('pin')
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
			{ id: 'view', items: ['zoom', 'layout', 'appearance', 'noteNames', 'noteText', 'annotations', 'pin'] },
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
		['coachActive', 'practice'],
		['transposed', 'practice'],
		['showNoteNames', 'view'],
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

describe('Coach', () => {
	it('braucht nur eine eigene Stimme, keine Zuordnung der Notenzeilen', () => {
		const practice = barGroups(ctx({ canFocusMyPart: false, canCoach: true }))[0]
		expect(practice.items).toContain('coach')
		expect(barGroups(ctx({ canCoach: false }))[0].items).not.toContain('coach')
	})
})
