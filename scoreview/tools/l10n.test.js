import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
	build,
	buildRuntime,
	buildTemplate,
	checkPo,
	checkTranslations,
	extractFromSource,
	mergePo,
	parsePo,
	problemsOf,
	serializePo,
} from './l10n.mjs'

describe('extractFromSource', () => {
	it('findet t(\'…\')-Aufrufe in JS/Vue-Quelltext', () => {
		const source = 'export default { methods: { t(text, vars) { return translate(\'scoreview\', text, vars) } }, computed: { label() { return this.t(\'Measure {n}\', { n: 1 }) } } }'
		expect(extractFromSource(source, 'js')).toEqual(new Set(['Measure {n}']))
	})

	it('findet mehrere Aufrufe und entdoppelt sie', () => {
		const source = 't(\'Save\'); t(\'Cancel\'); t(\'Save\')'
		expect(extractFromSource(source, 'js')).toEqual(new Set(['Save', 'Cancel']))
	})

	it('entschärft escapte Anführungszeichen im gefundenen String', () => {
		const source = 't(\'It\\\'s ready\')'
		expect(extractFromSource(source, 'js')).toEqual(new Set(["It's ready"]))
	})

	it('findet $l->t(\'…\')-Aufrufe in PHP-Quelltext', () => {
		const source = '<?php p($l->t(\'Save\')); echo $l->t("Sidecar URL");'
		expect(extractFromSource(source, 'php')).toEqual(new Set(['Save', 'Sidecar URL']))
	})

	it('findet $this->l->t(\'…\')-Aufrufe (Controller-Property statt lokaler Variable)', () => {
		const source = 'return new JSONResponse([\'error\' => $this->l->t(\'File not found or no access.\')]);'
		expect(extractFromSource(source, 'php')).toEqual(new Set(['File not found or no access.']))
	})

	it('ignoriert t(\'…\') beim PHP-Muster', () => {
		expect(extractFromSource('t(\'Save\')', 'php')).toEqual(new Set())
	})
})

const HEADER = '"Language: fr\\n"\n"Plural-Forms: nplurals=2; plural=(n > 1);\\n"\n'

function po(body, header = HEADER) {
	return parsePo(`msgid ""\nmsgstr ""\n${header}\n${body}`)
}

const template = buildTemplate(new Map([
	['Save', ['src/components/A.vue']],
	['Measure {n}', ['lib/Controller/X.php', 'src/components/B.vue']],
	['Not allowed.', ['lib/Controller/X.php']],
]))

describe('parsePo / serializePo', () => {
	it('liest Kopf, Fundstellen, Hinweise, Flags und Fortsetzungszeilen', () => {
		const parsed = po('#. Button label\n#: src/A.vue src/B.vue\n#, fuzzy\nmsgid "Sa"\n"ve"\nmsgstr "Enregistrer"\n')
		expect(parsed.header).toEqual({ Language: 'fr', 'Plural-Forms': 'nplurals=2; plural=(n > 1);' })
		expect(parsed.entries).toEqual([{
			msgid: 'Save',
			msgstr: 'Enregistrer',
			references: ['src/A.vue', 'src/B.vue'],
			comments: ['Button label'],
			translatorComments: [],
			flags: ['fuzzy'],
		}])
	})

	it('trennt Eintraege auch ohne Leerzeile und verkraftet CRLF', () => {
		const parsed = po('msgid "A"\r\nmsgstr "a"\r\nmsgid "B"\r\nmsgstr "b"\r\n')
		expect(parsed.entries.map((e) => [e.msgid, e.msgstr])).toEqual([['A', 'a'], ['B', 'b']])
	})

	it('ueberspringt veraltete #~-Eintraege', () => {
		expect(po('#~ msgid "Old"\n#~ msgstr "Vieux"\n').entries).toEqual([])
	})

	it('meldet Unlesbares und nicht unterstuetzte Schluesselwoerter mit Zeilennummer', () => {
		expect(() => po('msgid "A"\nmsgstr "a"\nkaputt\n')).toThrow(/line 8: cannot parse/)
		expect(() => po('msgctxt "x"\nmsgid "A"\nmsgstr "a"\n')).toThrow(/msgctxt is not supported/)
	})

	it('liest zurueck, was es schreibt - auch Anfuehrungszeichen, Backslash, Zeilenumbruch', () => {
		const data = {
			header: { Language: 'fr', 'Plural-Forms': 'nplurals=2; plural=(n > 1);' },
			headerComments: ['Translator note'],
			entries: [{ msgid: 'Say "hi"\\\nnow', msgstr: '« salut »', references: ['src/A.vue'], comments: [], translatorComments: ['', 'Keep it short'], flags: [] }],
		}
		expect(parsePo(serializePo(data))).toEqual(data)
	})
})

// What Poedit (and msgmerge/msgcat) write: lines wrapped at 79 columns, a
// fuzzy header with tool fields, previous msgids (#|), obsolete entries (#~)
// and translator comments. Checked against the real tools in a gettext
// container; this keeps the parser from regressing on it.
describe('Poedit output', () => {
	const POEDIT = [
		'# French translation of ScoreView.',
		'#, fuzzy',
		'msgid ""',
		'msgstr ""',
		'"Language: fr\\n"',
		'"Plural-Forms: nplurals=2; plural=(n > 1);\\n"',
		'"X-Generator: Poedit 3.5\\n"',
		'',
		'# Keep it short, the button is narrow.',
		'#: src/components/ScoreViewer.vue',
		'#, fuzzy',
		'#| msgid "Measure"',
		'msgid ""',
		'"Measure {n}"',
		'msgstr ""',
		'"Mesu"',
		'"re {n}"',
		'',
		'#~ msgid "Gone"',
		'#~ msgstr "Parti"',
		'',
	].join('\r\n')

	it('parses wrapped strings, tool headers and flags, and skips obsolete entries', () => {
		const parsed = parsePo(POEDIT)
		expect(parsed.header['X-Generator']).toBe('Poedit 3.5')
		expect(parsed.entries).toHaveLength(1)
		expect(parsed.entries[0]).toMatchObject({ msgid: 'Measure {n}', msgstr: 'Mesure {n}', flags: ['fuzzy'] })
		expect(problemsOf('fr', checkPo('fr', parsed, template))).toEqual([])
	})

	it('keeps translator comments through extract', () => {
		const merged = serializePo(mergePo(template, parsePo(POEDIT)))
		expect(merged.startsWith('# French translation of ScoreView.\nmsgid ""\n')).toBe(true)
		expect(merged).toContain('# Keep it short, the button is narrow.\n#: ')
		expect(merged).not.toContain('#|')
	})
})

describe('mergePo', () => {
	it('behaelt Uebersetzungen, ergaenzt Neues leer, entfernt Verwaistes, uebernimmt Fundstellen der Vorlage', () => {
		const old = po('#: src/old.vue\nmsgid "Save"\nmsgstr "Enregistrer"\n\nmsgid "Gone"\nmsgstr "Parti"\n')
		const merged = mergePo(template, old)
		expect(merged.header).toEqual(old.header)
		expect(merged.entries.map((e) => [e.msgid, e.msgstr, e.references])).toEqual([
			['Save', 'Enregistrer', ['src/components/A.vue']],
			['Measure {n}', '', ['lib/Controller/X.php', 'src/components/B.vue']],
			['Not allowed.', '', ['lib/Controller/X.php']],
		])
	})
})

describe('checkPo / problemsOf', () => {
	it('erlaubt Luecken in Community-Sprachen, nicht in Deutsch', () => {
		const fr = po('msgid "Save"\nmsgstr "Enregistrer"\n')
		const result = checkPo('fr', fr, template)
		expect(result.missing).toEqual(['Measure {n}', 'Not allowed.'])
		expect(result.translated).toBe(1)
		expect(problemsOf('fr', result)).toEqual([])

		const de = po('msgid "Save"\nmsgstr "Speichern"\n', '"Language: de\\n"\n"Plural-Forms: nplurals=2; plural=(n != 1);\\n"\n')
		expect(problemsOf('de', checkPo('de', de, template)).join('\n')).toMatch(/missing translation/)
	})

	it('zaehlt fuzzy als nicht uebersetzt', () => {
		const fr = po('#, fuzzy\nmsgid "Save"\nmsgstr "Enregistrer"\n')
		expect(checkPo('fr', fr, template).missing).toContain('Save')
	})

	it('meldet verwaiste und doppelte Eintraege in jeder Sprache', () => {
		const fr = po('msgid "Save"\nmsgstr "a"\n\nmsgid "Save"\nmsgstr "b"\n\nmsgid "Unknown"\nmsgstr "c"\n')
		const problems = problemsOf('fr', checkPo('fr', fr, template)).join('\n')
		expect(problems).toMatch(/\(orphaned\):\n {2}- "Unknown"/)
		expect(problems).toMatch(/duplicate entry:\n {2}- "Save"/)
	})

	it('meldet abweichende Platzhalter, {name} wie %s', () => {
		const fr = po('msgid "Measure {n}"\nmsgstr "Mesure {nombre}"\n')
		expect(checkPo('fr', fr, template).placeholderErrors).toEqual(['Measure {n}'])
		const tpl = buildTemplate(new Map([['Longer than %s minutes.', ['lib/X.php']]]))
		expect(checkPo('fr', po('msgid "Longer than %s minutes."\nmsgstr "Plus de minutes."\n'), tpl).placeholderErrors).toHaveLength(1)
		expect(checkPo('fr', po('msgid "Longer than %s minutes."\nmsgstr "Plus de %s minutes."\n'), tpl).placeholderErrors).toEqual([])
	})

	it('meldet einen Kopf, der nicht zum Ordner passt', () => {
		const result = checkPo('it', po('msgid "Save"\nmsgstr "Salva"\n', '"Language: fr\\n"\n'), template)
		expect(result.headerErrors).toHaveLength(2)
		expect(checkPo('Deutsch', po('', '"Language: Deutsch\\n"\n"Plural-Forms: nplurals=1; plural=0;\\n"\n'), template).headerErrors)
			.toEqual(['directory name "Deutsch" is not a Nextcloud language code'])
	})
})

describe('buildRuntime', () => {
	it('verteilt nach Fundstellen auf js/json und laesst Unuebersetztes weg', () => {
		const fr = po('msgid "Save"\nmsgstr "Enregistrer"\n\nmsgid "Measure {n}"\nmsgstr "Mesure {n}"\n\n#, fuzzy\nmsgid "Not allowed."\nmsgstr "Interdit."\n')
		const runtime = buildRuntime(fr, template)
		const json = JSON.parse(runtime.json)
		expect(json).toEqual({ translations: { 'Measure {n}': 'Mesure {n}' }, pluralForm: 'nplurals=2; plural=(n > 1);' })

		let registered
		// So wie Nextcloud die Datei ausfuehrt.
		const register = (app, translations, plural) => {
			registered = { app, translations, plural }
		}
		new Function('OC', runtime.js)({ L10N: { register } })
		expect(registered).toEqual({
			app: 'scoreview',
			translations: { Save: 'Enregistrer', 'Measure {n}': 'Mesure {n}' },
			plural: 'nplurals=2; plural=(n > 1);',
		})
	})
})

async function tempTree(languages) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scoreview-l10n-'))
	const pot = serializePo(buildTemplate(new Map()))
	await fs.mkdir(path.join(root, 'translationfiles', 'templates'), { recursive: true })
	await fs.writeFile(path.join(root, 'translationfiles', 'templates', 'scoreview.pot'), pot)
	for (const lang of languages) {
		await fs.mkdir(path.join(root, 'translationfiles', lang))
		await fs.writeFile(path.join(root, 'translationfiles', lang, 'scoreview.po'), pot.replace('"Language: \\n"', `"Language: ${lang}\\n"`))
	}
	return root
}

describe('de_DE', () => {
	it('is built as a copy of de, so "Deutsch (Sie)" does not fall back to English', async () => {
		const root = await tempTree(['de'])
		try {
			await build(root)
			const files = (await fs.readdir(path.join(root, 'l10n'))).sort()
			expect(files).toEqual(['de.js', 'de.json', 'de_DE.js', 'de_DE.json'])
			for (const ext of ['js', 'json']) {
				expect(await fs.readFile(path.join(root, 'l10n', `de_DE.${ext}`), 'utf8'))
					.toBe(await fs.readFile(path.join(root, 'l10n', `de.${ext}`), 'utf8'))
			}
		} finally {
			await fs.rm(root, { recursive: true, force: true })
		}
	})

	it('cannot be contributed as a .po of its own', async () => {
		const root = await tempTree(['de', 'de_DE'])
		try {
			const { languages } = await checkTranslations(root)
			expect(languages.find(({ lang }) => lang === 'de_DE').problems[0]).toMatch(/generated from de/)
		} finally {
			await fs.rm(root, { recursive: true, force: true })
		}
	})
})

// Der eigentliche Vollstaendigkeitstest: scannt den echten Quellbaum, damit
// npm test fehlschlaegt, sobald ein String ohne deutsche Uebersetzung
// dazukommt - und ebenso bei jedem Fehler in einer Community-Sprache.
describe('checkTranslations (echter Quellbaum)', () => {
	it('hat eine aktuelle Vorlage und keine Befunde in irgendeiner Sprache', async () => {
		const { templateCurrent, languages } = await checkTranslations()
		expect(templateCurrent).toBe(true)
		expect(languages.find(({ lang }) => lang === 'de')).toBeDefined()
		for (const { lang, problems } of languages) {
			expect(problems, lang).toEqual([])
		}
	})
})
