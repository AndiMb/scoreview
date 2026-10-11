import { describe, expect, it } from 'vitest'
import {
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
			entries: [{ msgid: 'Say "hi"\\\nnow', msgstr: '« salut »', references: ['src/A.vue'], comments: [], flags: [] }],
		}
		expect(parsePo(serializePo(data))).toEqual(data)
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
