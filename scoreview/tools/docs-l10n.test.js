import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	anchorsOf,
	checkDocs,
	germanLineOf,
	hashOf,
	languageLineOf,
	linksOf,
	markerOf,
	PAIRED,
	slug,
	stamp,
} from './docs-l10n.mjs'

describe('slug (GitHub-Anker)', () => {
	it('entspricht den Ankern, auf die die Doku heute verweist', () => {
		expect(slug('E6: Drei Einstiege in Files – Mimetype, Dateiendung, Setliste')).toBe('e6-drei-einstiege-in-files--mimetype-dateiendung-setliste')
		expect(slug('Bekannte Lücken')).toBe('bekannte-lücken')
		expect(slug('E10: „Folgt mir“ – ein Zustand mit Zählern, abgefragt oder gepusht')).toBe('e10-folgt-mir--ein-zustand-mit-zählern-abgefragt-oder-gepusht')
		expect(slug('5. Background-Jobs sicherstellen')).toBe('5-background-jobs-sicherstellen')
	})

	it('nimmt Inline-Markdown aus dem Text', () => {
		expect(slug('E5: `@nextcloud/vue` als UI-Basis')).toBe('e5-nextcloudvue-als-ui-basis')
		expect(slug('The [sidecar](x.md) and **you**')).toBe('the-sidecar-and-you')
	})
})

describe('anchorsOf / linksOf', () => {
	it('zaehlt doppelte Ueberschriften hoch und uebergeht Codebloecke', () => {
		const text = '# A\n## Setup\n```sh\n# not a heading [x](nope.md)\n```\n## Setup\n<a id="custom"></a>\n'
		expect(anchorsOf(text)).toEqual(new Set(['a', 'setup', 'setup-1', 'custom']))
		expect(linksOf(text)).toEqual([])
	})

	it('findet Inline-, Bild- und Referenzlinks, nicht aber Links in Inline-Code', () => {
		const text = 'See [x](a.md#b "t") and ![s](img/s.png).\n`[no](c.md)`\n[ref]: d.md#e\n'
		expect(linksOf(text).map((l) => l.target)).toEqual(['a.md#b', 'img/s.png', 'd.md#e'])
	})
})

describe('hashOf', () => {
	it('haengt nicht an der Sprachzeile, wohl aber an jedem anderen Zeichen', () => {
		const body = '# Install\n\nText.\n'
		const withLine = `# Install\n\n${languageLineOf('docs/installation.md')}\n\nText.\n`
		expect(hashOf(withLine, 'docs/installation.md')).toBe(hashOf('# Install\n\n\nText.\n', 'docs/installation.md'))
		expect(hashOf(body, 'docs/installation.md')).not.toBe(hashOf(body.replace('Text', 'Texts'), 'docs/installation.md'))
		expect(hashOf(body.replace(/\n/g, '\r\n'), 'docs/installation.md')).toBe(hashOf(body, 'docs/installation.md'))
	})
})

describe('checkDocs (Wegwerf-Repo)', () => {
	let root

	const write = async (file, text) => {
		await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true })
		await fs.writeFile(path.join(root, file), text)
	}
	const english = (file, body = '') => `# Title\n\n${languageLineOf(file)}\n\n## Setup\n${body}`
	const german = async (file, body = '') => {
		const original = await fs.readFile(path.join(root, file), 'utf8')
		return `${markerOf(original, file)}\n# Titel\n\n${germanLineOf(file)}\n\n## Einrichtung\n${body}`
	}

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-l10n-'))
		await write('docs/img/viewer.png', '')
		await write('docs/img/viewer.de.png', '')
		for (const file of PAIRED) {
			await write(file, english(file))
		}
		for (const file of PAIRED) {
			await write(file.replace(/\.md$/, '.de.md'), await german(file))
		}
		await write('docs/architecture.md', '# Architektur\n\nSiehe [Einrichtung](installation.de.md#einrichtung).\n')
	})

	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true })
	})

	it('ist mit vollstaendigen, aktuellen Paaren gruen', async () => {
		expect(await checkDocs(root)).toEqual([])
	})

	it('meldet eine veraltete deutsche Fassung und ist nach --stamp wieder gruen', async () => {
		await write('docs/limits.md', english('docs/limits.md', 'New paragraph.\n'))
		expect(await checkDocs(root)).toEqual([expect.stringMatching(/^docs\/limits\.de\.md: older than docs\/limits\.md/)])
		await stamp(['docs/limits.de.md'], root)
		expect(await checkDocs(root)).toEqual([])
	})

	it('meldet fehlende Gegenfassung, fehlende Sprachzeile und fehlenden Screenshot', async () => {
		await fs.rm(path.join(root, 'docs/troubleshooting.de.md'))
		await write('README.md', '# Title\n\n## Setup\n')
		await fs.rm(path.join(root, 'docs/img/viewer.de.png'))
		const findings = (await checkDocs(root)).join('\n')
		expect(findings).toMatch(/docs\/troubleshooting\.de\.md: missing/)
		expect(findings).toMatch(/README\.md: the language line/)
		expect(findings).toMatch(/viewer\.png: no viewer\.de\.png/)
	})

	it('meldet kaputte Dateien und Anker, auch aus der Entwicklerdoku', async () => {
		await write('docs/architecture.md', '# A\n\n[x](installation.de.md#setup) [y](gone.md) [z](#a)\n')
		const findings = await checkDocs(root)
		expect(findings).toEqual([
			'docs/architecture.md:3: installation.de.md#setup - no heading with this anchor in docs/installation.de.md',
			'docs/architecture.md:3: gone.md - file not found',
		])
	})

	it('meldet Links und Screenshots ueber die Sprachgrenze (D4, A6)', async () => {
		await write('docs/installation.de.md', await german('docs/installation.md', '[x](limits.md) ![s](img/viewer.png)\n'))
		await write('docs/installation.md', english('docs/installation.md', '[x](limits.de.md) ![s](img/viewer.de.png)\n'))
		await stamp(['docs/installation.de.md'], root)
		const findings = (await checkDocs(root)).join('\n')
		expect(findings).toMatch(/German text links the English docs\/limits\.md/)
		expect(findings).toMatch(/English text links the German docs\/limits\.de\.md/)
		expect(findings).toMatch(/German screenshot in the English text/)
		expect(findings).toMatch(/English screenshot in the German text/)
	})
})
