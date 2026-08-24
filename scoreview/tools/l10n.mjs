#!/usr/bin/env node
// Extraktions-/Vollstaendigkeitswerkzeug fuer E4 (docs/architecture.md):
// englische Quellstrings, deutsche Uebersetzung in l10n/de.json (PHP) und
// l10n/de.js (JS/Vue) gepflegt. Nextclouds JSResourceLocator ignoriert eine
// fehlende/unvollstaendige l10n-Datei stillschweigend ("missing
// translations files will be ignored") - ein vergessener String faellt also
// nie durch einen Fehler auf, sondern nur durch englischen statt deutschen
// Text in der Oberflaeche. Dieses Skript macht daraus einen harten Fehler:
// `npm run l10n:extract` fuer Menschen, `l10n.test.js` fuer `npm test`.
//
// Beide Seiten (PHP und JS) werden getrennt gefuehrt: Nextcloud laedt sie
// als getrennte Dateien mit getrenntem Schluesselraum (siehe
// apps/files/l10n/de.json vs. de.js in der Testinstanz - beide enthalten
// denselben vollen Uebersetzungsbestand, aber unabhaengig voneinander).

import { promises as fs } from 'node:fs'
import { glob } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const SOURCE_GLOBS = [
	{ pattern: 'src/**/*.js', kind: 'js' },
	{ pattern: 'src/**/*.vue', kind: 'js' },
	{ pattern: 'lib/**/*.php', kind: 'php' },
	{ pattern: 'templates/**/*.php', kind: 'php' },
]

// JS/Vue: findet t('…') - der lokale Einzelargument-Wrapper um
// @nextcloud/l10n translate('scoreview', …), den jede Komponente/jedes
// Skript definiert (siehe ScoreViewer.vue methods.t). Bewusst nicht direkt
// nach translate('scoreview', …) gesucht - jede Aufrufstelle nutzt den
// eigenen Wrapper, das haelt die Extraktion auf ein einziges, simples Muster
// reduziert.
const JS_CALL_PATTERN = /\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g
// PHP: findet $l->t('…') (IL10N) - auch ueber Property-Zugriffe wie
// $this->l->t('…') hinweg, wie in den Controllern verwendet.
const PHP_CALL_PATTERN = /\$(?:\w+->)*l->t\(\s*(['"])((?:\\.|(?!\1).)*)\1/g

function unescapeQuoted(str) {
	return str.replace(/\\(.)/g, '$1')
}

export function extractFromSource(source, kind) {
	const pattern = kind === 'php' ? PHP_CALL_PATTERN : JS_CALL_PATTERN
	const found = new Set()
	let match
	pattern.lastIndex = 0
	while ((match = pattern.exec(source)) !== null) {
		found.add(unescapeQuoted(match[2]))
	}
	return found
}

export async function collectRequiredKeys(root = ROOT) {
	const jsKeys = new Set()
	const phpKeys = new Set()
	for (const { pattern, kind } of SOURCE_GLOBS) {
		for await (const file of glob(pattern, { cwd: root })) {
			const source = await fs.readFile(path.join(root, file), 'utf8')
			const found = extractFromSource(source, kind)
			const target = kind === 'php' ? phpKeys : jsKeys
			for (const key of found) {
				target.add(key)
			}
		}
	}
	return { jsKeys, phpKeys }
}

/**
 * Reine, klammernbasierte Extraktion von "key" : "value"-Paaren - bewusst kein eval() auf einer JS-Datei.
 *
 * @param objectBody
 */
function parseKeyValuePairs(objectBody) {
	const pairPattern = /"((?:\\.|[^"\\])*)"\s*:\s*"((?:\\.|[^"\\])*)"/g
	const translations = {}
	let match
	while ((match = pairPattern.exec(objectBody)) !== null) {
		translations[unescapeQuoted(match[1])] = unescapeQuoted(match[2])
	}
	return translations
}

export async function loadJsonTranslations(root = ROOT) {
	const raw = await fs.readFile(path.join(root, 'l10n', 'de.json'), 'utf8')
	const data = JSON.parse(raw)
	return data.translations ?? {}
}

export async function loadJsTranslations(root = ROOT) {
	const raw = await fs.readFile(path.join(root, 'l10n', 'de.js'), 'utf8')
	const start = raw.indexOf('{')
	const end = raw.lastIndexOf('}')
	if (start === -1 || end === -1 || end <= start) {
		throw new Error('l10n/de.js: Übersetzungsobjekt nicht gefunden oder unerwartetes Format.')
	}
	return parseKeyValuePairs(raw.slice(start, end))
}

function diff(requiredKeys, translations) {
	const missing = [...requiredKeys].filter((key) => !(key in translations))
	const orphaned = Object.keys(translations).filter((key) => !requiredKeys.has(key))
	return { missing, orphaned }
}

/**
 * @param root
 * @return {Promise<{js: {missing: string[], orphaned: string[]}, php: {missing: string[], orphaned: string[]}}>}
 */
export async function checkTranslations(root = ROOT) {
	const [{ jsKeys, phpKeys }, jsTranslations, phpTranslations] = await Promise.all([
		collectRequiredKeys(root),
		loadJsTranslations(root),
		loadJsonTranslations(root),
	])
	return {
		js: diff(jsKeys, jsTranslations),
		php: diff(phpKeys, phpTranslations),
	}
}

async function main() {
	const result = await checkTranslations()
	let hasProblems = false
	for (const [label, { missing, orphaned }] of Object.entries(result)) {
		if (missing.length > 0) {
			hasProblems = true
			console.error(`[l10n:${label}] Fehlende deutsche Übersetzung für:`)
			missing.forEach((key) => console.error(`  - ${JSON.stringify(key)}`))
		}
		if (orphaned.length > 0) {
			hasProblems = true
			console.error(`[l10n:${label}] Verwaiste Übersetzung (im Quelltext nicht mehr gefunden):`)
			orphaned.forEach((key) => console.error(`  - ${JSON.stringify(key)}`))
		}
	}
	if (!hasProblems) {
		console.log('l10n: alle Übersetzungen vollständig (PHP + JS).')
	}
	process.exitCode = hasProblems ? 1 : 0
}

// Nur beim direkten Aufruf laufen lassen (`node tools/l10n.mjs` /
// `npm run l10n:extract`), nicht beim Import aus l10n.test.js.
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? '')) {
	main()
}
