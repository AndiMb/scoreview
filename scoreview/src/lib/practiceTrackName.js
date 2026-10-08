// Der Dateiname eines Uebe-Tracks (H1): lesbar in jeder Dateiliste und im
// Autoradio, und so, dass zwei verschiedene Mischungen nicht denselben Namen
// tragen. Bereinigt wird nach denselben Regeln wie auf dem Server
// (Service\FileNames), damit der vorgeschlagene Name auch der gespeicherte ist.

/** Wie Service\FileNames::MAX_NAME_LENGTH (ohne Endung). */
export const MAX_NAME_LENGTH = 120

export const EXTENSION = '.mp3'

/**
 * @param {object} input
 * @param {string} input.title Titel der Partitur, sonst der Dateiname
 * @param {?string} input.part Name der eigenen Stimme, null = Gesamtmischung
 * @param {boolean} [input.coach]
 * @param {number} [input.tempoPercent] 100 = Originaltempo
 * @param {number} [input.transpose] Halbtoene
 * @param {boolean} [input.loop] nur der Loop-Bereich
 * @param {{fullMix: string, coach: string, loop: string}} labels uebersetzte
 *   Woerter - dieses Modul kennt keine Uebersetzung
 * @return {string} mit Endung
 */
export function practiceTrackName({ title, part, coach = false, tempoPercent = 100, transpose = 0, loop = false }, labels) {
	const extras = []
	if (coach && part) {
		extras.push(labels.coach)
	}
	if (Math.round(tempoPercent) !== 100) {
		extras.push(`${Math.round(tempoPercent)} %`)
	}
	if (transpose) {
		// U+2212 statt Bindestrich: "−2" liest sich als Zahl, "-2" in einem
		// Dateinamen oft als Trenner.
		extras.push(transpose > 0 ? `+${transpose}` : `−${Math.abs(transpose)}`)
	}
	if (loop) {
		extras.push(labels.loop)
	}
	const base = `${title || 'Score'} – ${part || labels.fullMix}`
	const name = extras.length > 0 ? `${base} (${extras.join(', ')})` : base
	return sanitize(name) + EXTENSION
}

/**
 * Ohne Pfadtrenner und Steuerzeichen, Leerraum zusammengezogen, Endung weg
 * (sie kommt immer dazu), gekuerzt. Ein Name nur aus Punkten waere versteckt
 * oder ein Pfadsegment - dann gilt ein fester.
 *
 * @param {string} name
 * @return {string} ohne Endung
 */
export function sanitize(name) {
	let n = String(name ?? '')
		// Steuerzeichen sind hier genau das Ziel - wie im Server-Regex.
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u001F\u007F/\\]+/gu, ' ')
		// Richtungszeichen wie der Server (FileNames::clean): kein Name, der
		// anders aussieht, als er ist.
		.replace(/[‎‏‪-‮⁦-⁩]+/gu, '')
		.replace(/\s+/gu, ' ')
		.trim()
	if (n.toLowerCase().endsWith(EXTENSION)) {
		n = n.slice(0, -EXTENSION.length).trimEnd()
	}
	n = [...n].slice(0, MAX_NAME_LENGTH).join('').trim()
	if (n.replace(/[. ]/g, '') === '') {
		return 'Practice track'
	}
	return n
}
