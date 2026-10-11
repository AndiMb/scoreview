#!/usr/bin/env node
// Checks the bilingual user documentation: the English file is the
// original, `<name>.de.md` next to it the maintained German translation.
//
//   node tools/docs-l10n.mjs                         check, exit code 1 on findings
//   node tools/docs-l10n.mjs --stamp <file.de.md>…   mark German files as up to date
//
// Why a content hash instead of git history: English and German usually
// change in the same commit, whose hash does not exist while it is being
// written, and comparing commit dates would need the full history in CI.
// The German file carries the hash of the English text it was checked
// against; any change to the English text - a typo fix included - makes it
// stale until someone has looked at the German side and stamped it again.
// Stamp only after that look, never as a reflex to make CI green.
//
// The link check exists because headings ARE anchors: the German developer
// documentation links into the user documentation by German anchors, and
// translating a heading silently breaks every such link.

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// English originals that have a German translation (D1).
export const PAIRED = ['README.md', 'docs/installation.md', 'docs/troubleshooting.md', 'docs/limits.md']

// Markdown files whose links are checked. A fixed list rather than a walk:
// the repository also holds node_modules, vendored packages and local
// scratch directories whose Markdown is none of our business.
const LINK_SCOPE = [
	'*.md',
	'docs/*.md',
	'docs/agents/*.md',
	'scoreview/*.md',
	'sidecar/*.md',
	'sidecar/testdata/*.md',
	'.github/**/*.md',
]

const IMAGE_DIR = 'docs/img'

const MARKER_PATTERN = /^<!-- translation-of: (\S+) sha256:([0-9a-f]{12}) -->$/m

// --- headings and anchors -----------------------------------------------------

function stripInline(text) {
	return text
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[([^\]]*)\]\[[^\]]*\]/g, '$1')
		.replace(/<[^>]+>/g, '')
		.replace(/`([^`]*)`/g, '$1')
		.replace(/(\*\*|__)(.*?)\1/g, '$2')
		.replace(/(\*|_)(.*?)\1/g, '$2')
}

/**
 * GitHub's anchor for a heading (github-slugger): lower case, every
 * character that is not a letter, mark, number, connector, hyphen or space
 * removed, then each space becomes a hyphen - without collapsing, which is
 * why "Files – Mimetype" turns into "files--mimetype".
 *
 * @param heading heading text as written in Markdown
 */
export function slug(heading) {
	return stripInline(heading)
		.trim()
		.toLowerCase()
		.replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
		.replace(/ /g, '-')
}

// Lines outside fenced code blocks, with their 1-based number.
function proseLines(text) {
	const lines = []
	let fence = null
	text.replace(/\r\n?/g, '\n').split('\n').forEach((line, index) => {
		const opening = /^\s*(```|~~~)/.exec(line)
		if (opening) {
			if (fence === null) {
				fence = opening[1]
			} else if (line.trim().startsWith(fence)) {
				fence = null
			}
			return
		}
		if (fence === null) {
			lines.push({ line, number: index + 1 })
		}
	})
	return lines
}

export function anchorsOf(text) {
	const anchors = new Set()
	const seen = new Map()
	for (const { line } of proseLines(text)) {
		const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)
		if (heading) {
			const base = slug(heading[1])
			const count = seen.get(base) ?? 0
			seen.set(base, count + 1)
			anchors.add(count === 0 ? base : `${base}-${count}`)
		}
		for (const html of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) {
			anchors.add(html[1])
		}
	}
	return anchors
}

// --- links --------------------------------------------------------------------

export function linksOf(text) {
	const links = []
	for (const { line, number } of proseLines(text)) {
		// Inline code may show link syntax as an example.
		const prose = line.replace(/`[^`]*`/g, '')
		for (const match of prose.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
			links.push({ target: match[1], line: number })
		}
		const reference = /^\s*\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+"[^"]*")?\s*$/.exec(prose)
		if (reference) {
			links.push({ target: reference[1], line: number })
		}
	}
	return links
}

function isExternal(target) {
	return /^[a-z][a-z0-9+.-]*:/i.test(target)
}

// --- hashing ------------------------------------------------------------------

function normalize(text) {
	return text.replace(/\r\n?/g, '\n')
}

export function languageLineOf(englishFile) {
	const german = path.posix.basename(englishFile).replace(/\.md$/, '.de.md')
	return `**English** · [Deutsch](${german})`
}

export function germanLineOf(englishFile) {
	return `[English](${path.posix.basename(englishFile)}) · **Deutsch** — Die englische Fassung ist maßgeblich.`
}

// Hashed without its language line, so the hash does not depend on itself
// and reformatting that line does not mark the translation stale.
export function hashOf(englishText, englishFile) {
	const line = languageLineOf(englishFile)
	const body = normalize(englishText).split('\n').filter((l) => l.trim() !== line).join('\n')
	return createHash('sha256').update(body, 'utf8').digest('hex').slice(0, 12)
}

export function markerOf(englishText, englishFile) {
	return `<!-- translation-of: ${path.posix.basename(englishFile)} sha256:${hashOf(englishText, englishFile)} -->`
}

// --- files --------------------------------------------------------------------

async function exists(file) {
	try {
		await fs.access(file)
		return true
	} catch {
		return false
	}
}

async function expandScope(root) {
	const files = new Set()
	for (const pattern of LINK_SCOPE) {
		for await (const file of fs.glob(pattern, { cwd: root })) {
			files.add(file.split(path.sep).join('/'))
		}
	}
	return [...files].sort()
}

export function germanOf(englishFile) {
	return englishFile.replace(/\.md$/, '.de.md')
}

/**
 * @param root repository root
 * @return {Promise<string[]>} findings, empty when everything is fine
 */
export async function checkDocs(root = REPO) {
	const findings = []
	const read = (file) => fs.readFile(path.join(root, file), 'utf8')

	// Pairs, language lines, freshness.
	const germanToEnglish = new Map()
	for (const english of PAIRED) {
		const german = germanOf(english)
		germanToEnglish.set(german, english)
		const [hasEnglish, hasGerman] = await Promise.all([exists(path.join(root, english)), exists(path.join(root, german))])
		if (!hasEnglish || !hasGerman) {
			findings.push(`${hasEnglish ? german : english}: missing - every paired document needs both languages`)
			continue
		}
		const [englishText, germanText] = await Promise.all([read(english), read(german)])
		const head = (text) => normalize(text).split('\n').slice(0, 10).map((l) => l.trim())
		if (!head(englishText).includes(languageLineOf(english))) {
			findings.push(`${english}: the language line "${languageLineOf(english)}" is missing from the first lines`)
		}
		if (!head(germanText).includes(germanLineOf(english))) {
			findings.push(`${german}: the language line "${germanLineOf(english)}" is missing from the first lines`)
		}
		const marker = MARKER_PATTERN.exec(normalize(germanText))
		if (!marker) {
			findings.push(`${german}: no "<!-- translation-of: … sha256:… -->" marker`)
		} else if (marker[1] !== path.posix.basename(english)) {
			findings.push(`${german}: the marker names ${marker[1]}, expected ${path.posix.basename(english)}`)
		} else if (marker[2] !== hashOf(englishText, english)) {
			findings.push(`${german}: older than ${english} - update the German text, then run \`npm run docs:l10n -- --stamp ${german}\``)
		}
	}

	// Screenshots: every motif in both languages (A6).
	const images = (await fs.readdir(path.join(root, IMAGE_DIR))).filter((f) => f.endsWith('.png'))
	for (const image of images) {
		const counterpart = image.endsWith('.de.png') ? image.replace(/\.de\.png$/, '.png') : image.replace(/\.png$/, '.de.png')
		if (!images.includes(counterpart)) {
			findings.push(`${IMAGE_DIR}/${image}: no ${counterpart} - screenshots exist in English and German`)
		}
	}

	// Links and anchors.
	const anchorCache = new Map()
	const anchorsFor = async (file) => {
		if (!anchorCache.has(file)) {
			anchorCache.set(file, anchorsOf(await read(file)))
		}
		return anchorCache.get(file)
	}
	const englishPaired = new Set(PAIRED)
	for (const file of await expandScope(root)) {
		const text = await read(file)
		const isGerman = germanToEnglish.has(file)
		const isEnglish = englishPaired.has(file)
		for (const { target, line } of linksOf(text)) {
			if (isExternal(target)) {
				continue
			}
			const [rawPath, anchor] = target.split('#')
			const decoded = decodeURIComponent(rawPath)
			const targetFile = decoded === '' ? file : path.posix.normalize(path.posix.join(path.posix.dirname(file), decoded))
			const where = `${file}:${line}`
			if (!(await exists(path.join(root, targetFile)))) {
				findings.push(`${where}: ${target} - file not found`)
				continue
			}
			if (anchor !== undefined && targetFile.endsWith('.md')) {
				if (!(await anchorsFor(targetFile)).has(decodeURIComponent(anchor))) {
					findings.push(`${where}: ${target} - no heading with this anchor in ${targetFile}`)
				}
			}
			// D4: each language links to its own side of a pair.
			if (isGerman && englishPaired.has(targetFile) && targetFile !== germanToEnglish.get(file)) {
				findings.push(`${where}: ${target} - the German text links the English ${targetFile}, use ${path.posix.basename(germanOf(targetFile))}`)
			}
			if (isEnglish && germanToEnglish.has(targetFile) && targetFile !== germanOf(file)) {
				findings.push(`${where}: ${target} - the English text links the German ${targetFile}`)
			}
			const isImage = /\.png$/.test(targetFile) && targetFile.startsWith(`${IMAGE_DIR}/`)
			if (isImage && isEnglish && targetFile.endsWith('.de.png')) {
				findings.push(`${where}: ${target} - German screenshot in the English text`)
			}
			if (isImage && isGerman && !targetFile.endsWith('.de.png')) {
				findings.push(`${where}: ${target} - English screenshot in the German text`)
			}
		}
	}
	return findings
}

export async function stamp(files, root = REPO) {
	for (const german of files.map((f) => f.split(path.sep).join('/'))) {
		const english = PAIRED.find((p) => germanOf(p) === german)
		if (!english) {
			throw new Error(`${german} is not the German side of a paired document (${PAIRED.join(', ')})`)
		}
		const marker = markerOf(await fs.readFile(path.join(root, english), 'utf8'), english)
		const file = path.join(root, german)
		const text = normalize(await fs.readFile(file, 'utf8'))
		const next = MARKER_PATTERN.test(text) ? text.replace(MARKER_PATTERN, marker) : `${marker}\n${text}`
		await fs.writeFile(file, next)
		console.log(`${german}: ${marker}`)
	}
}

async function main(args) {
	if (args[0] === '--stamp') {
		if (args.length < 2) {
			console.error('usage: node tools/docs-l10n.mjs --stamp <file.de.md>…  (paths from the repository root)')
			process.exitCode = 2
			return
		}
		await stamp(args.slice(1))
		return
	}
	const findings = await checkDocs()
	findings.forEach((finding) => console.error(finding))
	if (findings.length === 0) {
		console.log(`docs: ${PAIRED.length} documents in English and German, links and anchors ok.`)
	}
	process.exitCode = findings.length > 0 ? 1 : 0
}

if (path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1] ?? '')) {
	main(process.argv.slice(2)).catch((error) => {
		console.error(error.message)
		process.exitCode = 1
	})
}
