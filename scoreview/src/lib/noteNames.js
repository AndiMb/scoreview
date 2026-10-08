// Tonnamen (H3) aus der Schreibweise, die die Engine je Notenkopf liefert
// (`noteSpellings`, tpc = MuseScores "tonal pitch class"). Rein, ohne DOM.
//
// Warum tpc und nicht die MIDI-Tonhoehe: Aus 66 allein ist nicht zu sagen,
// ob dort Fis oder Ges steht. Der Name soll lesen, was gedruckt ist - die
// geschriebene Note (D12), auch bei Transposition des Klangs.

/**
 * tpc liegt auf der Quintenreihe: 14 = C, 15 = G, 13 = F, 21 = Cis, 7 = Ces.
 * Stammton und Vorzeichen ergeben sich daraus ohne Tabelle je Ton.
 *
 * @param {number} tpc
 * @return {{step: string, alter: number}} step C..B, alter -2..2
 */
export function spell(tpc) {
	const i = tpc + 1
	return {
		step: 'FCGDAEB'[((i % 7) + 7) % 7],
		alter: Math.floor(i / 7) - 2,
	}
}

const EN_ALTER = { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' }

/**
 * Deutsch: H statt B, B fuer Hes; Es und As statt Ees und Aes. Doppelte
 * Vorzeichen als Eses, Fisis - so steht es in jeder Harmonielehre.
 *
 * @param {string} step
 * @param {number} alter
 * @return {string}
 */
function german(step, alter) {
	if (step === 'B') {
		if (alter === -1) {
			return 'B'
		}
		if (alter === -2) {
			return 'Heses'
		}
		return 'H' + 'is'.repeat(Math.max(0, alter))
	}
	if (alter > 0) {
		return step + 'is'.repeat(alter)
	}
	if (alter < 0) {
		// Vokale ziehen das e zusammen: Es, As - doppelt Eses, Asas.
		if (step === 'E') {
			return alter === -2 ? 'Eses' : 'Es'
		}
		if (step === 'A') {
			return alter === -2 ? 'Asas' : 'As'
		}
		return step + (alter === -2 ? 'eses' : 'es')
	}
	return step
}

const FIXED = { C: 'do', D: 're', E: 'mi', F: 'fa', G: 'sol', A: 'la', B: 'si' }

/**
 * Bewegliches Do, la-basiertes Moll: do liegt auf der Dur-Tonika der
 * Vorzeichnung, eine Moll-Tonika heisst la. Damit haengt die Silbe nur an
 * den Vorzeichen, nicht am Modus - auch dort, wo kein Artefakt Dur/Moll
 * traegt (M-F), stimmt sie.
 *
 * Abstand auf der Quintenreihe zur Tonika -> Silbe; die chromatischen
 * Silben der Tonic-Sol-fa-Tradition fuer erhoehte (di ri fi si li) und
 * erniedrigte (ra me se le te) Stufen.
 */
const MOVABLE = {
	0: 'do',
	2: 're',
	4: 'mi',
	'-1': 'fa',
	1: 'sol',
	3: 'la',
	5: 'ti',
	7: 'di',
	9: 'ri',
	6: 'fi',
	8: 'si',
	10: 'li',
	'-5': 'ra',
	'-3': 'me',
	'-6': 'se',
	'-4': 'le',
	'-2': 'te',
}
const MOVABLE_BASE = { 0: 'do', 1: 're', 2: 'mi', 3: 'fa', 4: 'sol', 5: 'la', 6: 'ti' }

/**
 * @param {object} input
 * @param {number} input.tpc geschriebene Schreibweise
 * @param {'de'|'en'|'solfa-fixed'|'solfa-movable'} input.system
 * @param {?number} [input.concertKey] Vorzeichen an der Stelle (-7..7),
 *   nur fuer das bewegliche Do; ohne gilt C-Dur
 * @return {string}
 */
export function nameOf({ tpc, system, concertKey = null }) {
	const { step, alter } = spell(tpc)
	switch (system) {
		case 'de':
			return german(step, alter)
		case 'solfa-fixed':
			return FIXED[step] + (EN_ALTER[alter] ?? '')
		case 'solfa-movable':
			return movable(tpc, concertKey ?? 0)
		case 'en':
		default:
			return step + (EN_ALTER[alter] ?? '')
	}
}

/**
 * @param {number} tpc
 * @param {number} concertKey
 * @return {string}
 */
function movable(tpc, concertKey) {
	const tonic = 14 + concertKey
	const d = tpc - tonic
	if (Object.hasOwn(MOVABLE, d)) {
		return MOVABLE[d]
	}
	// Seltenes (eis in C-Dur, doppelte Vorzeichen): Stufe aus dem Stammton,
	// Vorzeichen als Zeichen - lieber "mi♯" als eine erfundene Silbe.
	const steps = 'CDEFGAB'
	const tonicStep = spell(tonic).step
	const degree = (steps.indexOf(spell(tpc).step) - steps.indexOf(tonicStep) + 7) % 7
	// Vorzeichen relativ zur Tonleiter: Abstand auf der Quintenreihe zur
	// leitereigenen Stufe, je 7 ein Halbton.
	const own = [0, 2, 4, -1, 1, 3, 5][degree]
	const rel = Math.round((d - own) / 7)
	return MOVABLE_BASE[degree] + (EN_ALTER[rel] ?? '')
}

/** Die waehlbaren Systeme, in der Reihenfolge der Auswahl. */
export const SYSTEMS = Object.freeze(['de', 'en', 'solfa-fixed', 'solfa-movable'])

/**
 * Die Vorzeichnung nach einer Transposition um `semitones`: jede Quinte ein
 * Kreuz mehr, gefaltet auf -5..6 - "Es" statt "Dis", "Fis" statt "Ges", wie
 * Chorleitungen es ansagen.
 *
 * @param {number} concertKey -7..7
 * @param {number} semitones
 * @return {number} -5..6
 */
export function transposeKey(concertKey, semitones) {
	const raw = concertKey + 7 * semitones
	return ((((raw + 5) % 12) + 12) % 12) - 5
}

/**
 * Der Name der Tonika einer Tonart - fuer die Anzeige „D → C" an der
 * Transposition. Moll heisst nach der Quintenreihe drei Stufen weiter
 * (a-Moll hat die Vorzeichen von C-Dur).
 *
 * @param {object} input
 * @param {number} input.concertKey
 * @param {?string} input.mode `minor` | `major` | null (= Dur)
 * @param {'de'|'en'} input.system
 * @return {string}
 */
export function keyTonicName({ concertKey, mode, system }) {
	const minor = mode === 'minor' || mode === 'aeolian'
	const name = nameOf({ tpc: 14 + concertKey + (minor ? 3 : 0), system: system === 'de' ? 'de' : 'en' })
	// Deutsche Schreibweise: Moll klein (a-Moll), Dur gross.
	return minor && system === 'de' ? name.toLowerCase() : name
}
