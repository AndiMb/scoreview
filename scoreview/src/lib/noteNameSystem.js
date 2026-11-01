/**
 * Which note-name system to use: the user's choice, or - when names are
 * "off" but a name is needed anyway (tuner, tapped note, key label) - the
 * one of the interface language. German speakers read H where English
 * readers read B.
 *
 * @param {?string} preference 'de' | 'en' | 'solfa-fixed' | 'solfa-movable' | 'off' | null
 * @param {string} language a Nextcloud language code such as 'de_DE'
 * @return {string}
 */
export function noteNameSystem(preference, language) {
	if (preference && preference !== 'off') {
		return preference
	}
	return String(language ?? '').toLowerCase().startsWith('de') ? 'de' : 'en'
}

/**
 * Which staves carry note names: only the one of "my part" when that is
 * asked for and staves map to parts (lib/staffBands.js), else all (null).
 * Without a mapping, "only mine" cannot be honoured - showing all beats
 * showing none.
 *
 * @param {boolean} onlyMine the "only my part" preference
 * @param {?number} myPartIndex index of my part among the picture's parts
 * @param {boolean} mappingOk whether staves map to parts on these pages
 * @return {?number[]}
 */
export function noteNameStaves(onlyMine, myPartIndex, mappingOk) {
	if (!onlyMine || myPartIndex === null || myPartIndex === undefined || !mappingOk) {
		return null
	}
	return [myPartIndex]
}
