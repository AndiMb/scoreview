import { describe, expect, it } from 'vitest'
import { keyTonicName, nameOf, spell, transposeKey } from './noteNames.js'

// tpc nach MuseScore: Quintenreihe, 14 = C
const T = { Ces: 7, Ges: 8, Des: 9, As: 10, Es: 11, B: 12, F: 13, C: 14, G: 15, D: 16, A: 17, E: 18, H: 19, Fis: 20, Cis: 21, Gis: 22, Dis: 23, Ais: 24, Eis: 25, His: 26, Fes: 6, Heses: 5, Eses: 4 }

describe('spell', () => {
	it('liest Stammton und Vorzeichen von der Quintenreihe', () => {
		expect(spell(T.C)).toEqual({ step: 'C', alter: 0 })
		expect(spell(T.Fis)).toEqual({ step: 'F', alter: 1 })
		expect(spell(T.B)).toEqual({ step: 'B', alter: -1 })
		expect(spell(-1)).toEqual({ step: 'F', alter: -2 })
		expect(spell(33)).toEqual({ step: 'B', alter: 2 })
	})
})

describe('deutsch', () => {
	const de = (tpc) => nameOf({ tpc, system: 'de' })

	it('nennt H und B nach deutscher Schreibweise', () => {
		expect(de(T.H)).toBe('H')
		expect(de(T.B)).toBe('B')
		expect(de(T.His)).toBe('His')
		expect(de(T.Heses)).toBe('Heses')
	})

	it('haengt -is und -es an, mit Es und As', () => {
		expect(de(T.Fis)).toBe('Fis')
		expect(de(T.Cis)).toBe('Cis')
		expect(de(T.Es)).toBe('Es')
		expect(de(T.As)).toBe('As')
		expect(de(T.Des)).toBe('Des')
		expect(de(T.Ges)).toBe('Ges')
		expect(de(T.Ces)).toBe('Ces')
		expect(de(T.Fes)).toBe('Fes')
		expect(de(T.Eis)).toBe('Eis')
	})

	it('kennt doppelte Vorzeichen', () => {
		expect(de(T.Eses)).toBe('Eses')
		expect(de(T.F + 14)).toBe('Fisis')
	})
})

describe('englisch und feste Solmisation', () => {
	it('zeigt Vorzeichen als Zeichen', () => {
		expect(nameOf({ tpc: T.Fis, system: 'en' })).toBe('F♯')
		expect(nameOf({ tpc: T.B, system: 'en' })).toBe('B♭')
		expect(nameOf({ tpc: T.H, system: 'en' })).toBe('B')
	})

	it('nennt do fest auf C', () => {
		expect(nameOf({ tpc: T.C, system: 'solfa-fixed' })).toBe('do')
		expect(nameOf({ tpc: T.H, system: 'solfa-fixed' })).toBe('si')
		expect(nameOf({ tpc: T.Fis, system: 'solfa-fixed' })).toBe('fa♯')
	})
})

describe('bewegliches Do', () => {
	const mv = (tpc, concertKey) => nameOf({ tpc, system: 'solfa-movable', concertKey })

	it('legt do auf die Dur-Tonika der Vorzeichen', () => {
		// Abnahme F3: in G-Dur heisst Fis "ti"
		expect(mv(T.G, 1)).toBe('do')
		expect(mv(T.Fis, 1)).toBe('ti')
		// nach der Modulation nach D-Dur ist do = D
		expect(mv(T.D, 2)).toBe('do')
	})

	it('nennt die Moll-Tonika la (la-basiert)', () => {
		// a-Moll: keine Vorzeichen, A = la
		expect(mv(T.A, 0)).toBe('la')
		// c-Moll (3 b): C = la, Es = do
		expect(mv(T.C, -3)).toBe('la')
		expect(mv(T.Es, -3)).toBe('do')
	})

	it('kennt die chromatischen Silben', () => {
		expect(mv(T.Cis, 0)).toBe('di')
		expect(mv(T.Fis, 0)).toBe('fi')
		expect(mv(T.Gis, 0)).toBe('si')
		expect(mv(T.B, 0)).toBe('te')
		expect(mv(T.Es, 0)).toBe('me')
		expect(mv(T.As, 0)).toBe('le')
	})

	it('zeigt Seltenes als Stufe mit Vorzeichen', () => {
		expect(mv(T.Eis, 0)).toBe('mi♯')
		expect(mv(T.Fes, 0)).toBe('fa♭')
	})

	it('nimmt ohne Tonart C-Dur', () => {
		expect(mv(T.C)).toBe('do')
	})
})

describe('transposeKey und keyTonicName', () => {
	it('verschiebt die Vorzeichnung um Quinten', () => {
		// D-Dur (2#) einen Ganzton tiefer -> C-Dur
		expect(transposeKey(2, -2)).toBe(0)
		// C-Dur einen Halbton hoeher -> Des statt Cis
		expect(transposeKey(0, 1)).toBe(-5)
		// G-Dur einen Halbton tiefer -> Fis (6#)
		expect(transposeKey(1, -1)).toBe(6)
	})

	it('nennt die Tonika in Dur und Moll', () => {
		expect(keyTonicName({ concertKey: 2, mode: 'major', system: 'de' })).toBe('D')
		expect(keyTonicName({ concertKey: 2, mode: 'minor', system: 'de' })).toBe('h')
		expect(keyTonicName({ concertKey: -3, mode: 'minor', system: 'de' })).toBe('c')
		expect(keyTonicName({ concertKey: -3, mode: null, system: 'en' })).toBe('E♭')
	})
})
