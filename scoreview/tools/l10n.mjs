#!/usr/bin/env node
// Translation tool for E4 (docs/architecture.md): English source strings,
// translations as gettext PO under translationfiles/, and the files Nextcloud
// actually reads (l10n/<lang>.js for the browser, l10n/<lang>.json for PHP)
// generated from them at build time.
//
// Why PO is the source and l10n/ an artifact: a translation is contributed
// as a pull request from GitHub's web editor, and such a PR cannot run a
// generator. If the generated files were committed, every translation PR
// would fail CI as "out of date" - and there is deliberately no bot that
// could commit them afterwards. One PO file per language also means a
// translator never has to know which string belongs to PHP and which to JS.
//
// Nextcloud ignores a missing or incomplete l10n file without a word
// ("missing translations files will be ignored"), so a forgotten string
// would only ever show up as English text in the UI. `check` turns that into
// a hard error - for German, which the maintainer keeps complete. Community
// languages may have gaps: an untranslated string is left out of the
// generated file, and Nextcloud falls back to the English source.
//
//   node tools/l10n.mjs extract   rewrite the .pot from the source, merge every .po, then check
//   node tools/l10n.mjs check     check only, write nothing (CI, npm test)
//   node tools/l10n.mjs build     .po -> l10n/*.js + l10n/*.json (first step of npm run build)

import { promises as fs } from 'node:fs'
import { glob } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const APP_ID = 'scoreview'
const TEMPLATE_PATH = `translationfiles/templates/${APP_ID}.pot`
// The language the maintainer keeps complete. Everything else is a community
// translation and may have gaps (N2: a release never waits for one).
const REQUIRED_LANGUAGE = 'de'

const SOURCE_GLOBS = [
	{ pattern: 'src/**/*.js', kind: 'js' },
	{ pattern: 'src/**/*.vue', kind: 'js' },
	{ pattern: 'lib/**/*.php', kind: 'php' },
	{ pattern: 'templates/**/*.php', kind: 'php' },
]

// JS/Vue: finds t('…') - the local single-argument wrapper around
// @nextcloud/l10n translate('scoreview', …) that every component and script
// defines (see ScoreViewer.vue methods.t). Deliberately not
// translate('scoreview', …) directly: every call site uses its own wrapper,
// which keeps extraction down to one simple pattern.
const JS_CALL_PATTERN = /\bt\(\s*(['"])((?:\\.|(?!\1).)*)\1/g
// PHP: finds $l->t('…') (IL10N) - also through property access such as
// $this->l->t('…'), as used in the controllers.
const PHP_CALL_PATTERN = /\$(?:\w+->)*l->t\(\s*(['"])((?:\\.|(?!\1).)*)\1/g

// Nextcloud language codes: "de", "de_DE", "pt_BR", "zh_Hans", "sr@latin".
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:_[A-Za-z]{2,4})?(?:@[a-z]+)?$/
const PLURAL_FORMS_PATTERN = /^nplurals=\d+; *plural=.+;$/

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

/**
 * Scans the source tree for every translated string.
 *
 * Files are visited in sorted order so the template is byte-for-byte
 * reproducible: glob order differs between file systems, and an unstable
 * order would make every `extract` a diff over the whole .pot.
 *
 * @param root
 * @return {Promise<Map<string, string[]>>} msgid -> referencing files, in order of first appearance
 */
export async function collectRequiredKeys(root = ROOT) {
	const files = []
	for (const { pattern, kind } of SOURCE_GLOBS) {
		for await (const file of glob(pattern, { cwd: root })) {
			// Test files are not shipped, and their t() calls are fixtures.
			if (!/\.test\.m?js$/.test(file)) {
				files.push({ file: file.split(path.sep).join('/'), kind })
			}
		}
	}
	files.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
	const keys = new Map()
	for (const { file, kind } of files) {
		const source = await fs.readFile(path.join(root, file), 'utf8')
		for (const key of extractFromSource(source, kind)) {
			if (!keys.has(key)) {
				keys.set(key, [])
			}
			keys.get(key).push(file)
		}
	}
	return keys
}

// --- PO ---------------------------------------------------------------------
//
// A deliberate subset of gettext PO: msgid/msgstr with continuation lines,
// "#:" references, "#." comments for translators, "#," flags (fuzzy). No
// msgctxt and no plurals - nothing in the source uses them, and the
// extractor would have to learn n() first. Obsolete "#~" entries are dropped
// on read; `extract` would remove them anyway.

function unescapePo(str) {
	return str.replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t', r: '\r' })[c] ?? c)
}

function escapePo(str) {
	return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t')
}

/**
 * @param text
 * @return {{header: Record<string, string>, entries: Array<{msgid: string, msgstr: string, references: string[], comments: string[], flags: string[]}>}}
 */
export function parsePo(text) {
	const entries = []
	let header = null
	let current = null
	let field = null
	const errors = []

	const finish = () => {
		if (current === null) {
			return
		}
		if (current.msgid === undefined || current.msgstr === undefined) {
			errors.push(`entry without msgid/msgstr near ${JSON.stringify(current.msgid ?? '')}`)
		} else if (current.msgid === '') {
			if (header !== null) {
				errors.push('more than one header entry')
			}
			header = parseHeader(current.msgstr)
		} else {
			entries.push(current)
		}
		current = null
		field = null
	}
	const fresh = () => ({ references: [], comments: [], flags: [] })

	const lines = text.replace(/\r\n?/g, '\n').split('\n')
	lines.forEach((raw, index) => {
		const line = raw.trim()
		const where = `line ${index + 1}`
		if (line === '') {
			finish()
			return
		}
		if (line.startsWith('#~')) {
			return
		}
		if (line.startsWith('#')) {
			// A comment after msgstr starts the next entry.
			if (current !== null && current.msgstr !== undefined) {
				finish()
			}
			current ??= fresh()
			if (line.startsWith('#:')) {
				current.references.push(...line.slice(2).trim().split(/\s+/).filter(Boolean))
			} else if (line.startsWith('#.')) {
				current.comments.push(line.slice(2).trim())
			} else if (line.startsWith('#,')) {
				current.flags.push(...line.slice(2).split(',').map((f) => f.trim()).filter(Boolean))
			}
			return
		}
		const keyword = /^(msgid|msgstr|msgctxt|msgid_plural|msgstr\[\d+\])\s+"(.*)"$/.exec(line)
		if (keyword) {
			if (keyword[1] !== 'msgid' && keyword[1] !== 'msgstr') {
				errors.push(`${where}: ${keyword[1]} is not supported`)
				field = null
				return
			}
			if (keyword[1] === 'msgid' && current !== null && current.msgstr !== undefined) {
				finish()
			}
			current ??= fresh()
			if (current[keyword[1]] !== undefined) {
				errors.push(`${where}: duplicate ${keyword[1]}`)
			}
			field = keyword[1]
			current[field] = unescapePo(keyword[2])
			return
		}
		const continuation = /^"(.*)"$/.exec(line)
		if (continuation && field !== null) {
			current[field] += unescapePo(continuation[1])
			return
		}
		errors.push(`${where}: cannot parse ${JSON.stringify(line)}`)
	})
	finish()

	if (errors.length > 0) {
		const error = new Error(errors.join('\n'))
		error.poErrors = errors
		throw error
	}
	return { header: header ?? {}, entries }
}

function parseHeader(msgstr) {
	const header = {}
	for (const line of msgstr.split('\n')) {
		const colon = line.indexOf(':')
		if (colon > 0) {
			header[line.slice(0, colon).trim()] = line.slice(colon + 1).trim()
		}
	}
	return header
}

// Single-line strings, no wrapping: a translator in the web editor sees one
// string per line, and a changed word changes exactly one line of the diff.
export function serializePo({ header, entries }) {
	const out = ['msgid ""', 'msgstr ""']
	for (const [name, value] of Object.entries(header)) {
		out.push(`"${escapePo(`${name}: ${value}`)}\\n"`)
	}
	for (const entry of entries) {
		out.push('')
		for (const comment of entry.comments ?? []) {
			out.push(`#. ${comment}`)
		}
		if ((entry.references ?? []).length > 0) {
			out.push(`#: ${entry.references.join(' ')}`)
		}
		if ((entry.flags ?? []).length > 0) {
			out.push(`#, ${entry.flags.join(', ')}`)
		}
		out.push(`msgid "${escapePo(entry.msgid)}"`)
		out.push(`msgstr "${escapePo(entry.msgstr)}"`)
	}
	return out.join('\n') + '\n'
}

export function templateHeader() {
	return {
		'Project-Id-Version': 'ScoreView',
		'Report-Msgid-Bugs-To': 'https://github.com/AndiMb/scoreview/issues',
		Language: '',
		'MIME-Version': '1.0',
		'Content-Type': 'text/plain; charset=UTF-8',
		'Content-Transfer-Encoding': '8bit',
		'Plural-Forms': 'nplurals=INTEGER; plural=EXPRESSION;',
	}
}

/**
 * @param keys result of collectRequiredKeys
 */
export function buildTemplate(keys) {
	return {
		header: templateHeader(),
		entries: [...keys].map(([msgid, references]) => ({ msgid, msgstr: '', references, comments: [], flags: [] })),
	}
}

/**
 * Like msgmerge: the template decides which entries exist and where they
 * are used; the translation keeps its msgstr and flags. Entries the source
 * no longer uses are dropped, new ones arrive empty - a translator sees the
 * gaps directly in their own file.
 *
 * @param template
 * @param po
 */
export function mergePo(template, po) {
	const existing = new Map(po.entries.map((entry) => [entry.msgid, entry]))
	return {
		header: po.header,
		entries: template.entries.map((entry) => {
			const old = existing.get(entry.msgid)
			return {
				msgid: entry.msgid,
				msgstr: old?.msgstr ?? '',
				references: entry.references,
				comments: entry.comments,
				flags: old?.flags ?? [],
			}
		}),
	}
}

function isTranslated(entry) {
	return entry.msgstr !== '' && !entry.flags.includes('fuzzy')
}

// {name} from @nextcloud/l10n, %s and %1$s from IL10N (sprintf).
function placeholders(str) {
	return [...str.matchAll(/\{[A-Za-z0-9_]+\}|%(?:\d+\$)?[sd]/g)].map((m) => m[0]).sort()
}

/**
 * @param lang language code, also the directory name
 * @param po parsed .po
 * @param template parsed .pot
 * @return {{missing: string[], orphaned: string[], duplicates: string[], placeholderErrors: string[], headerErrors: string[], translated: number, total: number}}
 */
export function checkPo(lang, po, template) {
	const known = new Set(template.entries.map((entry) => entry.msgid))
	const byId = new Map()
	const duplicates = []
	for (const entry of po.entries) {
		if (byId.has(entry.msgid)) {
			duplicates.push(entry.msgid)
		}
		byId.set(entry.msgid, entry)
	}
	const missing = template.entries
		.filter((entry) => !byId.has(entry.msgid) || !isTranslated(byId.get(entry.msgid)))
		.map((entry) => entry.msgid)
	const orphaned = po.entries.filter((entry) => !known.has(entry.msgid)).map((entry) => entry.msgid)
	// A typo such as {nmae} would be shown literally in the UI - checked for
	// every language, because this is the mistake a translation PR makes.
	const placeholderErrors = po.entries
		.filter((entry) => entry.msgstr !== '')
		.filter((entry) => placeholders(entry.msgid).join(' ') !== placeholders(entry.msgstr).join(' '))
		.map((entry) => entry.msgid)
	const headerErrors = []
	if (!LANGUAGE_PATTERN.test(lang)) {
		headerErrors.push(`directory name "${lang}" is not a Nextcloud language code`)
	}
	if (po.header.Language !== lang) {
		headerErrors.push(`header "Language: ${po.header.Language ?? ''}" does not match the directory "${lang}"`)
	}
	if (!PLURAL_FORMS_PATTERN.test(po.header['Plural-Forms'] ?? '')) {
		headerErrors.push('header "Plural-Forms" is missing or invalid, e.g. "nplurals=2; plural=(n != 1);"')
	}
	const translated = template.entries.length - missing.length
	return { missing, orphaned, duplicates, placeholderErrors, headerErrors, translated, total: template.entries.length }
}

/**
 * Decides which findings fail the check. Gaps fail only for the required
 * language; everything else is wrong in any language.
 *
 * @param lang
 * @param result checkPo result
 */
export function problemsOf(lang, result) {
	const problems = []
	const list = (label, keys) => keys.length > 0 && problems.push(`${label}:\n${keys.map((k) => `  - ${JSON.stringify(k)}`).join('\n')}`)
	if (lang === REQUIRED_LANGUAGE) {
		list('missing translation', result.missing)
	}
	list('not used in the source (orphaned)', result.orphaned)
	list('duplicate entry', result.duplicates)
	list('placeholders differ from the English source', result.placeholderErrors)
	result.headerErrors.forEach((error) => problems.push(error))
	return problems
}

/**
 * Generates what Nextcloud reads. Which file a string goes to follows its
 * references: src/ is the browser (l10n/<lang>.js), lib/ and templates/ are
 * PHP (l10n/<lang>.json) - Nextcloud loads them as separate key spaces, and
 * a string used on both sides goes into both.
 *
 * @param po parsed .po
 * @param template parsed .pot - decides the PHP/JS split
 */
export function buildRuntime(po, template) {
	const kinds = new Map(template.entries.map((entry) => [entry.msgid, kindsOf(entry.references)]))
	const js = {}
	const php = {}
	for (const entry of po.entries) {
		if (!isTranslated(entry) || !kinds.has(entry.msgid)) {
			continue
		}
		const entryKinds = kinds.get(entry.msgid)
		if (entryKinds.has('js')) {
			js[entry.msgid] = entry.msgstr
		}
		if (entryKinds.has('php')) {
			php[entry.msgid] = entry.msgstr
		}
	}
	const pluralForm = po.header['Plural-Forms']
	const pairs = (map) => Object.entries(map).map(([k, v]) => `    ${JSON.stringify(k)} : ${JSON.stringify(v)}`).join(',\n')
	// Same layout as Nextcloud's own translationtool, so these files look
	// like those of every other app.
	return {
		js: `OC.L10N.register(\n    ${JSON.stringify(APP_ID)},\n    {\n${pairs(js)}\n},\n${JSON.stringify(pluralForm)});\n`,
		json: `{ "translations": {\n${pairs(php)}\n},"pluralForm" :${JSON.stringify(pluralForm)}\n}\n`,
	}
}

function kindsOf(references) {
	const kinds = new Set()
	for (const reference of references) {
		kinds.add(reference.startsWith('src/') ? 'js' : 'php')
	}
	return kinds
}

// --- files ------------------------------------------------------------------

async function readPo(file) {
	try {
		return parsePo(await fs.readFile(file, 'utf8'))
	} catch (error) {
		error.message = `${path.relative(ROOT, file)}: ${error.message}`
		throw error
	}
}

export async function listLanguages(root = ROOT) {
	const dir = path.join(root, 'translationfiles')
	const languages = []
	for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
		if (entry.isDirectory() && entry.name !== 'templates') {
			languages.push(entry.name)
		}
	}
	return languages.sort()
}

function poPath(root, lang) {
	return path.join(root, 'translationfiles', lang, `${APP_ID}.po`)
}

/**
 * Everything `check` looks at, without writing.
 *
 * @param root
 * @return {Promise<{templateCurrent: boolean, languages: Array<{lang: string, result: object, problems: string[]}>}>}
 */
export async function checkTranslations(root = ROOT) {
	const expected = serializePo(buildTemplate(await collectRequiredKeys(root)))
	let committed = ''
	try {
		committed = (await fs.readFile(path.join(root, TEMPLATE_PATH), 'utf8')).replace(/\r\n?/g, '\n')
	} catch {
		// No template yet - reported as "not current" below.
	}
	const template = parsePo(expected)
	const languages = []
	for (const lang of await listLanguages(root)) {
		let problems
		let result = null
		try {
			result = checkPo(lang, await readPo(poPath(root, lang)), template)
			problems = problemsOf(lang, result)
		} catch (error) {
			problems = [error.message]
		}
		languages.push({ lang, result, problems })
	}
	if (!languages.some(({ lang }) => lang === REQUIRED_LANGUAGE)) {
		languages.push({ lang: REQUIRED_LANGUAGE, result: null, problems: [`${poPath('', REQUIRED_LANGUAGE)} is missing`] })
	}
	return { templateCurrent: committed === expected, languages }
}

async function extract(root = ROOT) {
	const template = buildTemplate(await collectRequiredKeys(root))
	await fs.mkdir(path.dirname(path.join(root, TEMPLATE_PATH)), { recursive: true })
	await fs.writeFile(path.join(root, TEMPLATE_PATH), serializePo(template))
	for (const lang of await listLanguages(root)) {
		const file = poPath(root, lang)
		await fs.writeFile(file, serializePo(mergePo(template, await readPo(file))))
	}
}

async function build(root = ROOT) {
	const template = await readPo(path.join(root, TEMPLATE_PATH))
	const outDir = path.join(root, 'l10n')
	// l10n/ holds nothing but generated files - a language removed from
	// translationfiles/ must not survive as a stale file.
	await fs.rm(outDir, { recursive: true, force: true })
	await fs.mkdir(outDir)
	const languages = await listLanguages(root)
	for (const lang of languages) {
		const runtime = buildRuntime(await readPo(poPath(root, lang)), template)
		await fs.writeFile(path.join(outDir, `${lang}.js`), runtime.js)
		await fs.writeFile(path.join(outDir, `${lang}.json`), runtime.json)
	}
	console.log(`l10n: built ${languages.join(', ')}.`)
}

async function check(root = ROOT) {
	const { templateCurrent, languages } = await checkTranslations(root)
	let failed = false
	if (!templateCurrent) {
		failed = true
		console.error(`[l10n] ${TEMPLATE_PATH} does not match the source - run \`npm run l10n:extract\`.`)
	}
	for (const { lang, result, problems } of languages) {
		const coverage = result ? ` ${result.translated}/${result.total}` : ''
		if (problems.length > 0) {
			failed = true
			console.error(`[l10n:${lang}]${coverage}\n${problems.join('\n')}`)
		} else {
			console.log(`[l10n:${lang}]${coverage} ok`)
		}
	}
	return failed
}

async function main(command) {
	if (command === 'build') {
		await build()
		return
	}
	if (command === 'extract') {
		await extract()
	} else if (command !== 'check') {
		console.error('usage: node tools/l10n.mjs extract|check|build')
		process.exitCode = 2
		return
	}
	process.exitCode = (await check()) ? 1 : 0
}

// Only when run directly, not when imported from l10n.test.js.
if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? '')) {
	main(process.argv[2]).catch((error) => {
		console.error(error.message)
		process.exitCode = 1
	})
}
