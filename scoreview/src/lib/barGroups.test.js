import { describe, expect, it } from 'vitest'
import { anyGroupActive, barGroups, barPins, defaultPins, groupActive, isPinned, MAX_PINS, pinLimitReached, PINNABLE, togglePin } from './barGroups.js'
import { allowed } from './interactionPolicy.js'

function ctx(overrides = {}) {
	return {
		can: () => true,
		hasRealPlayer: true,
		canFocusMyPart: true,
		hasParts: true,
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
	showTuner: false,
	coachActive: false,
	transposed: false,
	focusMyPart: false,
	showNoteNames: false,
	showNoteText: false,
	showAnnotations: false,
	showRehearsal: false,
	setlistEditorMode: null,
}

const items = (groups, id) => groups.find((g) => g.id === id)?.items

describe('barGroups', () => {
	it('ordnet alle Werkzeuge ihrer Gruppe zu', () => {
		expect(barGroups(ctx())).toEqual([
			{
				id: 'playback',
				sections: [['loop', 'metronome', 'tempo', 'mixer', 'transpose', 'coach'], ['recording']],
				items: ['loop', 'metronome', 'tempo', 'mixer', 'transpose', 'coach', 'recording'],
			},
			{
				id: 'view',
				sections: [['zoom', 'autoScroll', 'myPart', 'noteNames', 'annotations', 'noteText'], ['layout', 'appearance']],
				items: ['zoom', 'autoScroll', 'myPart', 'noteNames', 'annotations', 'noteText', 'layout', 'appearance'],
			},
			{
				id: 'score',
				sections: [['partChoice', 'toneMode', 'rehearsal', 'newSetlist'], ['print', 'export', 'offline', 'info']],
				items: ['partChoice', 'toneMode', 'rehearsal', 'newSetlist', 'print', 'export', 'offline', 'info'],
			},
		])
	})

	it('keeps the group order for leaders - their way in is a pin', () => {
		expect(barGroups(ctx({ isLeader: true })).map((g) => g.id)).toEqual(['playback', 'view', 'score'])
	})

	it('offers choosing "my part" without sound, but not in performance mode (issue #18)', () => {
		expect(items(barGroups(ctx({ hasRealPlayer: false })), 'score')).toContain('partChoice')
		expect(items(barGroups(ctx({ hasParts: false })), 'score')).not.toContain('partChoice')
		const performance = barGroups(ctx({ can: (a) => allowed(a, { performance: true }) }))
		expect(items(performance, 'score')).toBeUndefined()
	})

	it('offers printing only online and in the browser', () => {
		expect(items(barGroups(ctx()), 'score')).toContain('print')
		expect(items(barGroups(ctx({ standalone: true })), 'score')).not.toContain('print')
		expect(items(barGroups(ctx({ offline: true })), 'score')).not.toContain('print')
	})

	it('nimmt offline alles weg, was den Server braucht (E14)', () => {
		const can = (action) => allowed(action, { offline: true })
		expect(barGroups(ctx({ can, offline: true })).map((g) => [g.id, g.items])).toEqual([
			['playback', ['loop', 'metronome', 'tempo', 'mixer', 'transpose', 'coach']],
			['view', ['zoom', 'autoScroll', 'myPart', 'noteNames', 'noteText', 'layout', 'appearance']],
			['score', ['partChoice', 'toneMode', 'info']],
		])
	})

	it('bietet Vormerken in den Apps nicht an', () => {
		expect(items(barGroups(ctx({ standalone: true })), 'score')).not.toContain('offline')
	})

	it('zeigt Export und Vormerken nur, wenn die Administration sie erlaubt', () => {
		const groups = barGroups(ctx({ exportEnabled: false, offlineEnabled: false }))
		expect(items(groups, 'score')).not.toContain('export')
		expect(items(groups, 'score')).not.toContain('offline')
	})

	it('laesst im Auffuehrungsmodus nur Zoom stehen', () => {
		const can = (action) => allowed(action, { performance: true })
		expect(barGroups(ctx({ can }))).toEqual([{ id: 'view', sections: [['zoom']], items: ['zoom'] }])
	})

	it('laesst beim Folgen alles stehen, was die Regel erlaubt', () => {
		const can = (action) => allowed(action, { following: true })
		expect(barGroups(ctx({ can })).map((g) => g.id)).toEqual(['playback', 'view', 'score'])
	})

	it('blendet Werkzeuge ohne ihre Voraussetzung aus', () => {
		const groups = barGroups(ctx({
			hasRealPlayer: false,
			canFocusMyPart: false,
			recordingEnabled: false,
			setlistCanCreate: false,
		}))
		expect(groups.map((g) => [g.id, g.items])).toEqual([
			['playback', ['loop', 'metronome', 'tempo']],
			['view', ['zoom', 'autoScroll', 'noteNames', 'annotations', 'noteText', 'layout', 'appearance']],
			['score', ['partChoice', 'rehearsal', 'print', 'offline', 'info']],
		])
	})

	it('zeigt Aufnahme auch, wenn nur die Intonation eingeschaltet ist', () => {
		const groups = barGroups(ctx({ recordingEnabled: false, intonationEnabled: true }))
		expect(items(groups, 'playback')).toContain('recording')
	})

	it('offers the tuner with the intonation switch, even offline', () => {
		expect(items(barGroups(ctx()), 'playback')).not.toContain('tuner')
		expect(items(barGroups(ctx({ intonationEnabled: true })), 'playback')).toContain('tuner')
		expect(items(barGroups(ctx({ intonationEnabled: true, offline: true })), 'playback')).toContain('tuner')
	})

	it('offers the practice log only when switched on and online (E20)', () => {
		expect(items(barGroups(ctx()), 'playback')).not.toContain('practiceLog')
		const on = barGroups(ctx({ practiceLogEnabled: true }))
		expect(on[0].sections.at(-1)).toEqual(['practiceLog'])
		expect(items(barGroups(ctx({ practiceLogEnabled: true, offline: true })), 'playback')).not.toContain('practiceLog')
		const performance = barGroups(ctx({ intonationEnabled: true, can: (a) => allowed(a, { performance: true }) }))
		expect(performance.find((g) => g.id === 'playback')).toBeUndefined()
	})

	it('lets everything be pinned but zoom and the starting note', () => {
		const all = barGroups(ctx({ intonationEnabled: true, practiceLogEnabled: true })).flatMap((g) => g.items)
		expect(all.filter((id) => !(id in PINNABLE))).toEqual(['zoom', 'toneMode'])
	})
})

describe('pins (E23)', () => {
	const groups = barGroups(ctx())

	it('pins the mixer by default, for a leader the rehearsal as well', () => {
		expect(defaultPins(false)).toEqual(['mixer'])
		expect(barPins(groups, null, false)).toEqual([{ id: 'mixer', kind: 'panel' }])
		expect(barPins(groups, null, true).map((p) => p.id)).toEqual(['mixer', 'rehearsal'])
	})

	it('keeps an empty list as a choice of its own', () => {
		expect(barPins(groups, [], true)).toEqual([])
	})

	it('shows a pin only while its tool is visible', () => {
		expect(barPins(barGroups(ctx({ hasRealPlayer: false })), ['mixer', 'loop'], false).map((p) => p.id)).toEqual(['loop'])
		const performance = barGroups(ctx({ can: (a) => allowed(a, { performance: true }) }))
		expect(barPins(performance, ['mixer', 'loop'], false)).toEqual([])
	})

	it('drops unknown ids and keeps at most four', () => {
		expect(barPins(groups, ['zoom', 'bogus', 'loop', 'loop'], false).map((p) => p.id)).toEqual(['loop'])
		expect(barPins(groups, ['loop', 'metronome', 'tempo', 'mixer', 'transpose'], false)).toHaveLength(MAX_PINS)
	})

	it('toggles from the default, appends, and stops at the limit', () => {
		expect(togglePin(null, 'loop', false)).toEqual(['mixer', 'loop'])
		expect(togglePin(null, 'mixer', true)).toEqual(['rehearsal'])
		const full = ['loop', 'metronome', 'tempo', 'mixer']
		expect(pinLimitReached(full, false)).toBe(true)
		expect(pinLimitReached(null, true)).toBe(false)
		expect(togglePin(full, 'coach', false)).toEqual(full)
		expect(togglePin(full, 'tempo', false)).toEqual(['loop', 'metronome', 'mixer'])
		expect(togglePin([], 'zoom', false)).toEqual([])
	})

	it('reads a pin from the default as well', () => {
		expect(isPinned(null, 'mixer', false)).toBe(true)
		expect(isPinned(null, 'rehearsal', false)).toBe(false)
		expect(isPinned(['loop'], 'mixer', false)).toBe(false)
	})
})

describe('groupActive', () => {
	it('setzt ohne eingeschaltetes Werkzeug keinen Punkt', () => {
		for (const id of ['playback', 'view', 'score']) {
			expect(groupActive(id, IDLE)).toBe(false)
		}
		expect(anyGroupActive(IDLE)).toBe(false)
	})

	it.each([
		['metronomeEnabled', 'playback'],
		['loopActive', 'playback'],
		['coachActive', 'playback'],
		['transposed', 'playback'],
		['showNoteNames', 'view'],
		['trainerActive', 'playback'],
		['showMixer', 'playback'],
		['showPractice', 'playback'],
		['showTuner', 'playback'],
		['focusMyPart', 'view'],
		['showNoteText', 'view'],
		['showAnnotations', 'view'],
		['showRehearsal', 'score'],
	])('%s setzt den Punkt an %s und nur dort', (flag, group) => {
		const state = { ...IDLE, [flag]: true }
		for (const id of ['playback', 'view', 'score']) {
			expect(groupActive(id, state)).toBe(id === group)
		}
		expect(anyGroupActive(state)).toBe(true)
	})

	it('zaehlt nur den Editor fuer eine NEUE Setliste zur Partitur', () => {
		expect(groupActive('score', { ...IDLE, setlistEditorMode: 'new' })).toBe(true)
		expect(groupActive('score', { ...IDLE, setlistEditorMode: 'edit' })).toBe(false)
	})
})

describe('Coach', () => {
	it('braucht nur eine eigene Stimme, keine Zuordnung der Notenzeilen', () => {
		expect(items(barGroups(ctx({ canFocusMyPart: false, canCoach: true })), 'playback')).toContain('coach')
		expect(items(barGroups(ctx({ canCoach: false })), 'playback')).not.toContain('coach')
	})
})
