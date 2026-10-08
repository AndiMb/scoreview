import { describe, expect, it } from 'vitest'
import {
	apiUrlsFor,
	estimateBytes,
	isOutdated,
	missingUrls,
	planForScore,
	planForSetlist,
	removeEntry,
	sharedUrls,
	splitByUser,
	upsertEntry,
} from './offlinePlan.js'

// generateUrl wie in @nextcloud/router, ohne index.php
const generateUrl = (path, params) => path.replace(/\{(\w+)\}/g, (_, k) => params[k])
const api = apiUrlsFor(generateUrl, 4711)

const ready = {
	status: 'ready',
	files: {
		pageCount: 2,
		pages: ['/a/page-1?v=e1-1', '/a/page-2?v=e1-1'],
		midi: '/a/midi?v=e1-1',
		timingJson: '/a/timing?v=e1-1',
		measuresJson: '/a/measures?v=e1-1',
		metaJson: '/a/meta?v=e1-1',
		etag: 'e1',
	},
}

describe('apiUrlsFor', () => {
	it('baut genau die Adressen, die die Composables abrufen', () => {
		expect(api).toEqual({
			status: '/apps/scoreview/api/scores/4711/status',
			annotations: '/apps/scoreview/api/scores/4711/annotations',
			myPart: '/apps/scoreview/api/scores/4711/my-part',
			leaders: '/apps/scoreview/api/scores/4711/leaders',
			setlistOffers: '/apps/scoreview/api/scores/4711/setlists',
		})
	})
})

describe('planForScore', () => {
	it('nimmt API und alle Artefakte mit', () => {
		const plan = planForScore({ statusBody: ready, api })
		expect(plan.etag).toBe('e1')
		expect(plan.urls).toHaveLength(5 + 2 + 4)
		expect(plan.urls).toContain('/a/page-2?v=e1-1')
		expect(plan.urls).toContain(api.annotations)
	})

	it('merkt nichts vor, was nicht fertig ist', () => {
		expect(planForScore({ statusBody: { status: 'pending' }, api })).toBeNull()
		expect(planForScore({ statusBody: { status: 'client' }, api })).toBeNull()
	})
})

describe('sharedUrls und estimateBytes', () => {
	it('laesst Fehlendes weg', () => {
		expect(sharedUrls({ soundFontUrl: '/sf', workletUrl: null })).toEqual(['/sf'])
	})

	it('rechnet das SoundFont nur einmal', () => {
		expect(estimateBytes([{ pageCount: 2 }], false)).toBe(24_000_000 + 100_000 + 500_000)
		expect(estimateBytes([{ pageCount: 2 }], true)).toBe(600_000)
	})
})

const entry = (type, id, urls, uid = 'anna', etag = null) => ({ type, id, title: '', etag, urls, bytes: 0, pinnedAt: 0, uid })

describe('upsertEntry und removeEntry', () => {
	it('ersetzt einen Eintrag und nennt seine alten Artefakte', () => {
		const m0 = [entry('score', 1, ['/s', '/p?v=1'])]
		const { manifest, obsolete } = upsertEntry(m0, entry('score', 1, ['/s', '/p?v=2']))
		expect(manifest).toHaveLength(1)
		expect(obsolete).toEqual(['/p?v=1'])
	})

	it('behaelt, was ein anderer Eintrag noch braucht', () => {
		const m0 = [entry('score', 1, ['/x', '/shared']), entry('setlist', 9, ['/shared', '/list'])]
		const { manifest, obsolete } = removeEntry(m0, 'score', 1)
		expect(manifest).toHaveLength(1)
		expect(obsolete).toEqual(['/x'])
	})

	it('entfernt Unbekanntes ohne Fehler', () => {
		const m0 = [entry('score', 1, ['/x'])]
		expect(removeEntry(m0, 'score', 2)).toEqual({ manifest: m0, obsolete: [] })
	})
})

describe('splitByUser', () => {
	it('trennt fremde Eintraege ab', () => {
		const { own, foreign } = splitByUser([entry('score', 1, [], 'anna'), entry('score', 2, [], 'bert')], 'anna')
		expect(own.map((e) => e.id)).toEqual([1])
		expect(foreign.map((e) => e.id)).toEqual([2])
	})
})

describe('isOutdated', () => {
	it('erkennt einen neuen Konvertierungsstand', () => {
		const e = entry('score', 1, [], 'anna', 'e1')
		expect(isOutdated(e, ready)).toBe(false)
		expect(isOutdated(e, { ...ready, files: { ...ready.files, etag: 'e2' } })).toBe(true)
	})

	it('wertet eine Antwort ohne Etag nicht als veraltet', () => {
		expect(isOutdated(entry('score', 1, [], 'anna', 'e1'), { status: 'pending' })).toBe(false)
	})
})

describe('planForSetlist und missingUrls', () => {
	it('vereinigt die Stuecke und nennt jedes einmal', () => {
		const plan = planForSetlist({
			setlistUrl: '/s/9',
			scorePlans: [{ fileId: 1, urls: ['/a', '/sf'] }, { fileId: 2, urls: ['/b', '/sf'] }, { fileId: 1, urls: ['/a'] }],
		})
		expect(plan.urls).toEqual(['/s/9', '/a', '/sf', '/b'])
		expect(plan.members).toEqual([1, 2])
	})
	it('meldet, was der Browser geraeumt hat', () => {
		const entry = { urls: ['/a', '/b', '/c'] }
		expect(missingUrls(entry, new Set(['/a', '/c']))).toEqual(['/b'])
		expect(missingUrls(entry, new Set(['/a', '/b', '/c']))).toEqual([])
	})
})
