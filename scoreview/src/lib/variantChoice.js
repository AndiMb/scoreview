// What the viewer offers as display variants (docs/architecture.md E19) and
// which variant key a choice means. Pure: no DOM, no network, no Vue.
//
// The key grammar itself lives in converter/lib/variantKey.mjs, shared with
// the converter and mirrored by the server (Service\VariantKey).

import { BASE_KEY, FORMATS, parseVariantKey, variantKey } from '../../converter/lib/variantKey.mjs'

export { BASE_KEY, FORMATS }

/**
 * The sources a score offers: the full score, the parts it stores, and a
 * generated part for every part that has no stored part of its own.
 *
 * A stored part is what the arranger set; it comes first and is never
 * replaced by a generated one of the same part. With "my part" chosen, the
 * option that shows exactly that part moves to the top, right after the
 * full score - it is the one a singer is looking for.
 *
 * Names are score content (stored part names, part names) and are not
 * translated (E4); the caller labels `full` and marks generated ones.
 *
 * @param {?object} meta the base meta.json
 * @param {?(string|number)} myPartId
 * @return {Array<{value: string, kind: 'full'|'stored'|'generated', name: string, partIds: string[], mine: boolean}>}
 */
export function sourceOptions(meta, myPartId = null) {
	const parts = Array.isArray(meta?.parts) ? meta.parts : []
	const stored = Array.isArray(meta?.excerpts) ? meta.excerpts : []
	const mine = myPartId === null || myPartId === undefined ? null : String(myPartId)

	const options = [{ value: 'full', kind: 'full', name: '', partIds: parts.map((p) => String(p.id)), mine: false }]
	const ownStored = new Set()
	stored.forEach((excerpt, index) => {
		const partIds = (excerpt.partIds ?? []).map(String)
		if (partIds.length === 1) {
			ownStored.add(partIds[0])
		}
		options.push({
			value: `ex${index}`,
			kind: 'stored',
			name: String(excerpt.name ?? ''),
			partIds,
			mine: mine !== null && partIds.length === 1 && partIds[0] === mine,
		})
	})
	for (const part of parts) {
		const id = String(part.id)
		if (ownStored.has(id) || !/^[A-Za-z0-9_-]{1,40}$/.test(id)) {
			continue
		}
		options.push({ value: `part${id}`, kind: 'generated', name: String(part.name ?? ''), partIds: [id], mine: id === mine })
	}

	const top = options.findIndex((o) => o.mine)
	if (top > 1) {
		options.splice(1, 0, ...options.splice(top, 1))
	}
	return options
}

/**
 * A remembered source if this score still has it, else the full score - a
 * choice stored for another version of the file must not ask for a part
 * that is gone.
 *
 * @param {?string} source
 * @param {?object} meta
 * @return {string}
 */
export function availableSource(source, meta) {
	return sourceOptions(meta).some((o) => o.value === source) ? source : 'full'
}

/**
 * The key for a choice, or null for the base conversion itself.
 *
 * @param {object} choice
 * @param {string} choice.source 'full' | 'ex<N>' | 'part<id>'
 * @param {string} choice.format 'orig' | 'phone' | 'phonel'
 * @param {boolean} choice.concert concert pitch
 * @param {boolean} choice.transposeNotation notation follows the sound's transposition
 * @param {number} choice.transpose the sound's transposition in semitones
 * @return {?string}
 */
export function keyForChoice({ source, format, concert, transposeNotation, transpose }) {
	const parsed = parseVariantKey(`${source}~orig~w~1`)
	if (!parsed) {
		return null
	}
	return variantKey({
		source: parsed.source,
		format: FORMATS.includes(format) ? format : 'orig',
		pitch: concert ? 'c' : 'w',
		transpose: transposeNotation && Number.isInteger(transpose) ? transpose : 0,
	})
}

/**
 * Segment numbers between a variant and its base (I3). `toBase` is the
 * variant's own table; `toPicture` its inverse, the first variant segment
 * for each base segment - a multimeasure rest can stand for several.
 *
 * @param {?object} variantMeta meta.json of the variant, null for the base
 * @return {{toBase: (elid: ?number) => ?number, toPicture: (elid: ?number) => ?number}}
 */
export function elidMapping(variantMeta) {
	if (!variantMeta?.baseElid) {
		const same = (elid) => elid ?? null
		return { toBase: same, toPicture: same }
	}
	const toBase = new Map()
	const toPicture = new Map()
	for (const [own, base] of Object.entries(variantMeta.baseElid)) {
		const ownElid = Number(own)
		toBase.set(ownElid, base)
		const known = toPicture.get(base)
		if (known === undefined || ownElid < known) {
			toPicture.set(base, ownElid)
		}
	}
	return {
		toBase: (elid) => (elid === null || elid === undefined ? null : toBase.get(Number(elid)) ?? null),
		toPicture: (elid) => (elid === null || elid === undefined ? null : toPicture.get(Number(elid)) ?? null),
	}
}
