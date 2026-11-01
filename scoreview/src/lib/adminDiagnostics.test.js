import { describe, expect, it } from 'vitest'
import { backendLine, followLine, healthLines, humanAge, isolationLine, soundFontLine } from './adminDiagnostics.js'

// Fills the placeholders, so the tests see which sentence and which values.
const t = (text, vars = {}) => text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`))

const healthy = {
	backend: 'local',
	local: { available: true, nodeVersion: 'v22.1.0', runtime: 'node', isolation: 'full' },
	sidecar: { reachable: false, url: '', renderer: 'engine' },
	soundFont: { cached: true, name: 'GeneralUser.sf2' },
	cron: { healthy: true, mode: 'cron', ageSeconds: 30 },
	conversions: { ready: 3, pending: 1, processing: 1, error: 2 },
	follow: { enabled: false },
}

describe('healthLines', () => {
	it('has no lines before the health answer arrives', () => {
		expect(healthLines(null, t)).toEqual([])
	})

	it('lists the lines of a healthy local server', () => {
		const lines = healthLines(healthy, t)
		expect(lines.map((l) => l.label)).toEqual(['Conversion', 'Isolation', 'SoundFont', 'Background jobs (cron)', 'Conversions'])
		expect(lines[0]).toMatchObject({ ok: true, detail: 'on this server, Node.js v22.1.0' })
		expect(lines[3]).toMatchObject({ ok: true, detail: 'mode cron, last run 30 s ago' })
		expect(lines[4]).toMatchObject({ ok: true, detail: '3 ready, 2 pending, 2 failed' })
	})

	it('adds fallback and "Follow me" lines, and drops isolation off the local path', () => {
		const lines = healthLines({
			...healthy,
			backend: 'sidecar',
			sidecar: { reachable: true, url: 'http://sidecar:8080', renderer: 'musescore' },
			clientFallback: { active: true },
			follow: { enabled: true, pushAvailable: true, pollMs: 1000 },
		}, t)
		expect(lines.map((l) => l.label)).toEqual(['Conversion', 'Fallback', 'SoundFont', 'Background jobs (cron)', '“Follow me”', 'Conversions'])
		expect(lines[0].detail).toBe('http://sidecar:8080, with MuseScore')
		expect(lines[1]).toMatchObject({ type: 'warning', ok: true })
	})

	it('flags pending conversions only when cron is dead', () => {
		const lines = healthLines({ ...healthy, cron: { healthy: false, mode: 'ajax', ageSeconds: null } }, t)
		const cron = lines.find((l) => l.label === 'Background jobs (cron)')
		expect(cron).toMatchObject({ ok: false, detail: 'no run in the last 15 minutes (never) – conversions will stay pending' })
		expect(lines.at(-1).ok).toBe(false)
		const idle = healthLines({ ...healthy, cron: { healthy: false, mode: 'ajax', ageSeconds: 9000 }, conversions: { ready: 1 } }, t)
		expect(idle.at(-1).ok).toBe(true)
	})
})

describe('backendLine', () => {
	it('names Deno and reports a local error', () => {
		expect(backendLine({ backend: 'local', local: { available: true, nodeVersion: '2.0', runtime: 'deno' } }, t).detail).toBe('on this server, Deno 2.0')
		expect(backendLine({ backend: 'local', local: { available: false, error: 'no node' } }, t)).toEqual({ ok: false, detail: 'no node' })
	})

	it('reports an unreachable or unconfigured sidecar', () => {
		expect(backendLine({ backend: 'sidecar', sidecar: { reachable: false, error: 'timeout' } }, t)).toEqual({ ok: false, detail: 'timeout' })
		expect(backendLine({ backend: 'sidecar', sidecar: { reachable: false } }, t).detail).toBe('not configured')
		expect(backendLine({ backend: 'sidecar', sidecar: { reachable: true, url: 'u', renderer: 'engine' } }, t).detail).toBe('u, with the scoreview-engine')
	})
})

describe('isolationLine', () => {
	it('grades full, partial and none - never as an error', () => {
		expect(isolationLine('full', t).type).toBe('success')
		expect(isolationLine('partial', t).type).toBe('info')
		expect(isolationLine('none', t)).toMatchObject({ ok: true, type: 'warning' })
	})
})

describe('followLine', () => {
	it('recommends notify_push only without it', () => {
		expect(followLine({ pushAvailable: true, pollMs: 900 }, t).type).toBeUndefined()
		const line = followLine({ pushAvailable: false, pollMs: 900, recommendPushFromDevices: 15 }, t)
		expect(line.type).toBe('info')
		expect(line.detail).toContain('From about 15 devices')
	})
})

describe('soundFontLine', () => {
	it('counts the cache, not the reachability', () => {
		expect(soundFontLine({ overrideUrl: 'x' }, t)).toEqual({ ok: true, detail: 'custom URL configured' })
		expect(soundFontLine({ cached: true }, t).detail).toBe('cached copy in use')
		expect(soundFontLine({ availableInSidecar: true, name: 'a.sf2' }, t)).toEqual({ ok: true, detail: 'a.sf2' })
		expect(soundFontLine({ fetchUrl: 'https://x/y.sf2' }, t)).toMatchObject({ ok: false, type: 'warning' })
		expect(soundFontLine({ error: 'boom' }, t)).toEqual({ ok: false, detail: 'boom' })
		expect(soundFontLine({}, t).detail).toBe('no SoundFont available')
	})
})

describe('humanAge', () => {
	it('says never, seconds or minutes', () => {
		expect(humanAge(null, t)).toBe('never')
		expect(humanAge(59, t)).toBe('59 s ago')
		expect(humanAge(130, t)).toBe('2 min ago')
	})
})
