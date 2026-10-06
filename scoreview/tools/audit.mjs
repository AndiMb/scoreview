#!/usr/bin/env node
// `npm audit --audit-level=high` mit datierten Ausnahmen, fuer den CI-Job
// "Abhaengigkeiten (Sicherheitsmeldungen)".
//
// npm audit kennt keine Ausnahmen. Ohne sie bliebe der Job dauerhaft rot,
// sobald eine Meldung ohne bereinigte Version erscheint (alle Versionen
// betroffen, `npm audit fix --force` schlaegt nur einen Rueckschritt vor) -
// und ein Dauer-Rot wird binnen einer Woche ignoriert, womit die naechste,
// echte Meldung untergeht. Darum: eine Ausnahme gilt fuer genau EINE Meldung
// (GHSA-Kennung, nicht fuer ein Paket), traegt eine Begruendung und ein
// Ablaufdatum. Nach dem Ablauf wird der Job wieder rot, auch wenn sich
// nichts geaendert hat - die Ausnahme muss dann bewusst verlaengert werden.
//
// Gezaehlt werden nur die Meldungen selbst (die Objekte in `via`), nicht die
// Pakete, die sie bloss erben: Eine Meldung in braces faerbt micromatch,
// fast-glob, stylelint usw. ebenfalls hoch ein, ist aber nur EINE Luecke.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ALLOWLIST = path.join(ROOT, 'tools', 'audit-allowlist.json')

// Dieselbe Schwelle wie zuvor `--audit-level=high`; zur Begruendung siehe
// den Kommentar am Job in .github/workflows/ci.yml.
const BLOCKING = new Set(['high', 'critical'])

function advisoryId(via) {
	const match = /GHSA-[\w-]+/.exec(via.url ?? '')
	return match ? match[0] : `npm-${via.source}`
}

/**
 * Wertet einen `npm audit --json`-Bericht gegen die Ausnahmen aus.
 *
 * @param {object} report geparster Bericht (`vulnerabilities`-Map, npm >= 7)
 * @param {Array<{id: string, until: string, reason: string}>} allowlist Ausnahmen
 * @param {string} today Datum als YYYY-MM-DD; ein `until` gilt einschliesslich
 * @return {{blocking: object[], allowed: object[], expired: object[], stale: object[]}}
 */
export function evaluateAudit(report, allowlist, today) {
	const advisories = new Map()
	for (const vuln of Object.values(report.vulnerabilities ?? {})) {
		for (const via of vuln.via ?? []) {
			// Strings verweisen nur auf ein anderes Paket der Map; dessen
			// eigene Meldung wird dort gezaehlt.
			if (typeof via !== 'object' || !BLOCKING.has(via.severity)) {
				continue
			}
			const id = advisoryId(via)
			const entry = advisories.get(id) ?? { id, title: via.title, severity: via.severity, packages: new Set() }
			entry.packages.add(via.name ?? vuln.name)
			advisories.set(id, entry)
		}
	}

	const exceptions = new Map(allowlist.map((e) => [e.id, e]))
	const result = { blocking: [], allowed: [], expired: [], stale: [] }
	for (const advisory of advisories.values()) {
		const found = { ...advisory, packages: [...advisory.packages].sort() }
		const exception = exceptions.get(advisory.id)
		if (!exception) {
			result.blocking.push(found)
		} else if (exception.until < today) {
			result.expired.push({ ...found, until: exception.until })
		} else {
			result.allowed.push({ ...found, until: exception.until, reason: exception.reason })
		}
	}
	// Eine Ausnahme, deren Meldung nicht mehr auftaucht, ist erledigt und
	// gehoert entfernt - sonst deckt sie spaeter stillschweigend eine
	// Wiederkehr derselben Meldung ab.
	result.stale = allowlist.filter((e) => !advisories.has(e.id))
	return result
}

function runAudit() {
	try {
		return execFileSync('npm', ['audit', '--json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
	} catch (error) {
		// npm audit endet mit Exitcode 1, sobald es ueberhaupt etwas findet;
		// der Bericht steht trotzdem vollstaendig auf stdout.
		if (error.stdout) {
			return error.stdout
		}
		throw error
	}
}

function main() {
	const report = JSON.parse(runAudit())
	if (report.error) {
		console.error('npm audit fehlgeschlagen:', report.error.summary ?? report.error)
		process.exitCode = 1
		return
	}
	const allowlist = JSON.parse(readFileSync(ALLOWLIST, 'utf8'))
	const today = new Date().toISOString().slice(0, 10)
	const { blocking, allowed, expired, stale } = evaluateAudit(report, allowlist, today)

	const show = (a) => `  - ${a.id} (${a.severity}) ${a.title} [${a.packages.join(', ')}]`
	for (const a of allowed) {
		console.log(`Ausnahme bis ${a.until}:\n${show(a)}\n    ${a.reason}`)
	}
	for (const e of stale) {
		console.warn(`Ausnahme ${e.id} wird nicht mehr gemeldet - aus tools/audit-allowlist.json entfernen.`)
	}
	for (const a of expired) {
		console.error(`Ausnahme abgelaufen am ${a.until} - pruefen und verlaengern oder beheben:\n${show(a)}`)
	}
	if (blocking.length > 0) {
		console.error('Sicherheitsmeldungen ohne Ausnahme:')
		blocking.forEach((a) => console.error(show(a)))
	}
	if (blocking.length === 0 && expired.length === 0) {
		console.log('npm audit: keine hohen oder kritischen Meldungen ohne gueltige Ausnahme.')
	}
	process.exitCode = blocking.length > 0 || expired.length > 0 ? 1 : 0
}

// Nur beim direkten Aufruf laufen lassen, nicht beim Import aus audit.test.js.
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? '')) {
	main()
}
