import { describe, expect, it } from 'vitest'
import { checkTranslations, extractFromSource } from './l10n.mjs'

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

// Der eigentliche Vollstaendigkeitstest (PLAN.md Phase 14: "Ein
// vitest-Test ruft dieselbe Logik auf, damit npm test fehlschlägt, sobald
// ein String ohne deutsche Übersetzung dazukommt") - scannt den echten
// Quellbaum, nicht nur Beispieltexte wie oben.
describe('checkTranslations (echter Quellbaum)', () => {
	it('hat für jeden verwendeten String eine deutsche Übersetzung, und keine verwaisten Einträge', async () => {
		const result = await checkTranslations()
		expect(result.js.missing).toEqual([])
		expect(result.js.orphaned).toEqual([])
		expect(result.php.missing).toEqual([])
		expect(result.php.orphaned).toEqual([])
	})
})
