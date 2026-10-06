import { describe, expect, it } from 'vitest'
import { evaluateAudit } from './audit.mjs'

// Gestalt wie `npm audit --json`: eine Meldung als Objekt in `via`, die
// erbenden Pakete verweisen per String auf das Paket mit der Meldung.
function advisory(name, ghsa, severity = 'high') {
	return {
		source: 1,
		name,
		title: `${name} kaputt`,
		url: `https://github.com/advisories/${ghsa}`,
		severity,
	}
}
const report = {
	vulnerabilities: {
		braces: { name: 'braces', severity: 'high', via: [advisory('braces', 'GHSA-aaaa-bbbb-cccc')] },
		micromatch: { name: 'micromatch', severity: 'high', via: ['braces'] },
		elliptic: { name: 'elliptic', severity: 'low', via: [advisory('elliptic', 'GHSA-low0-low0-low0', 'low')] },
	},
}

describe('evaluateAudit', () => {
	it('blockiert eine hohe Meldung ohne Ausnahme, einmal statt pro erbendem Paket', () => {
		const result = evaluateAudit(report, [], '2026-10-06')
		expect(result.blocking.map((a) => a.id)).toEqual(['GHSA-aaaa-bbbb-cccc'])
		expect(result.blocking[0].packages).toEqual(['braces'])
	})

	it('ignoriert Meldungen unterhalb der Schwelle', () => {
		const result = evaluateAudit(report, [], '2026-10-06')
		expect(result.blocking.some((a) => a.id === 'GHSA-low0-low0-low0')).toBe(false)
	})

	it('laesst eine gueltige Ausnahme durch, bis einschliesslich zum Ablaufdatum', () => {
		const allow = [{ id: 'GHSA-aaaa-bbbb-cccc', until: '2026-10-06', reason: 'Bauzeit' }]
		const result = evaluateAudit(report, allow, '2026-10-06')
		expect(result.blocking).toEqual([])
		expect(result.expired).toEqual([])
		expect(result.allowed.map((a) => a.id)).toEqual(['GHSA-aaaa-bbbb-cccc'])
	})

	it('meldet eine abgelaufene Ausnahme', () => {
		const allow = [{ id: 'GHSA-aaaa-bbbb-cccc', until: '2026-10-05', reason: 'Bauzeit' }]
		const result = evaluateAudit(report, allow, '2026-10-06')
		expect(result.expired.map((a) => a.id)).toEqual(['GHSA-aaaa-bbbb-cccc'])
		expect(result.allowed).toEqual([])
	})

	it('deckt mit einer Ausnahme keine andere Meldung im selben Paket ab', () => {
		const second = {
			vulnerabilities: {
				braces: { name: 'braces', severity: 'high', via: [advisory('braces', 'GHSA-aaaa-bbbb-cccc'), advisory('braces', 'GHSA-neue-neue-neue')] },
			},
		}
		const allow = [{ id: 'GHSA-aaaa-bbbb-cccc', until: '2027-01-01', reason: 'Bauzeit' }]
		expect(evaluateAudit(second, allow, '2026-10-06').blocking.map((a) => a.id)).toEqual(['GHSA-neue-neue-neue'])
	})

	it('nennt Ausnahmen, deren Meldung verschwunden ist', () => {
		const allow = [{ id: 'GHSA-weg0-weg0-weg0', until: '2027-01-01', reason: 'erledigt' }]
		expect(evaluateAudit(report, allow, '2026-10-06').stale.map((e) => e.id)).toEqual(['GHSA-weg0-weg0-weg0'])
	})
})
