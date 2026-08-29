// @vitest-environment jsdom
//
// Sicherheitsrelevanter Test: genau die Umgehungsmuster, an denen die
// frueher regexbasierte Fassung nachweislich gescheitert ist (9 von 15) -
// damit ein kuenftiger Umbau nicht unbemerkt dorthin zurueckfaellt. Braucht
// ein DOM, deshalb die jsdom-Umgebung oben.
import { describe, expect, it } from 'vitest'
import { sanitizeSvg } from './svgSanitizer.js'

/**
 * Enthaelt das Ergebnis noch einen ausfuehrbaren/nachladenden Vektor?
 *
 * `<use>` und `href` sind seit der Browser-Konvertierung nicht mehr pauschal
 * verdaechtig: die scoreview-engine schreibt Text als Glyph-Outlines mit
 * `<use xlink:href="#gN">` auf lokale `<defs>` (siehe svgSanitizer.js).
 * Gefaehrlich bleibt jedes href, dessen Wert NICHT ein lokales
 * "#fragment" ist - genau das prueft das zweite Muster.
 */
function isDangerous(svg) {
	return /<script|\son[a-z]+\s*=|javascript:|<foreignObject|<iframe|attributeName|<style/i.test(svg)
		|| /href\s*=\s*["'](?!#)/i.test(svg)
}

describe('sanitizeSvg - Umgehungsmuster, die die alte Regex-Fassung durchliess', () => {
	const vectors = [
		['script, ungeschlossen', '<svg><script>x()</svg>'],
		['onload OHNE Anfuehrungszeichen', '<svg onload=x()></svg>'],
		['onerror auf image', '<svg><image href="a" onerror=x()></svg>'],
		['javascript: in href', '<svg><a href="javascript:x()">t</a></svg>'],
		['javascript: in xlink:href', '<svg><a xlink:href="javascript:x()">t</a></svg>'],
		['foreignObject mit iframe', '<svg><foreignObject><iframe src="javascript:x()"></iframe></foreignObject></svg>'],
		['set/animate Attributinjektion', '<svg><set attributeName="onload" to="x()"/></svg>'],
		['use mit externem Verweis', '<svg><use href="http://evil/x.svg#a"/></svg>'],
		['style mit url()', '<svg><style>*{background:url("http://evil/x")}</style></svg>'],
	]

	for (const [name, input] of vectors) {
		it(`entschaerft: ${name}`, () => {
			expect(isDangerous(sanitizeSvg(input))).toBe(false)
		})
	}
})

describe('sanitizeSvg - Faelle, die die alte Fassung schon abdeckte', () => {
	it('entfernt script-Elemente', () => {
		expect(sanitizeSvg('<svg><script>alert(1)</script><rect/></svg>')).not.toMatch(/script/i)
	})

	it('entfernt on*-Eventhandler in beiden Anfuehrungszeichen-Varianten', () => {
		const out = sanitizeSvg('<svg><rect onclick="a()" onmouseover=\'b()\' fill="red"/></svg>')
		expect(out).not.toMatch(/onclick|onmouseover/i)
		expect(out).toMatch(/fill="red"/)
	})

	it('entfernt script auch in Grossschreibung', () => {
		expect(sanitizeSvg('<svg><SCRIPT>x()</SCRIPT></svg>')).not.toMatch(/script/i)
	})
})

describe('sanitizeSvg - das echte Notenbild darf nicht kaputtgehen', () => {
	it('behaelt die fuer den Cursor noetigen Attribute (viewBox, Groesse in mm)', () => {
		const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="215.9mm" height="279.4mm" viewBox="0 0 10200 13200"><path class="Note" d="M1 2"/></svg>'
		const out = sanitizeSvg(svg)
		expect(out).toMatch(/viewBox="0 0 10200 13200"/)
		expect(out).toMatch(/width="215\.9mm"/)
		expect(out).toMatch(/height="279\.4mm"/)
	})

	it('behaelt class-Attribute (M9: einzige Adressierbarkeit im MuseScore-SVG)', () => {
		const out = sanitizeSvg('<svg><path class="Note" d="M0 0"/><polyline class="StaffLines" points="1,2 3,4"/></svg>')
		expect(out).toMatch(/class="Note"/)
		expect(out).toMatch(/class="StaffLines"/)
		expect(out).toMatch(/points="1,2 3,4"/)
	})

	it('behaelt die Segment-, Zeilen- und Stimmenkennung (M10)', () => {
		// Ohne sie faende svgIndex.js den klingenden Notenkopf nicht mehr -
		// und zwar still: die Hervorhebung bliebe einfach aus.
		const out = sanitizeSvg('<svg><path class="Note seg-42 st-1 vc-0" d="M0 0"/></svg>')
		expect(out).toMatch(/class="Note seg-42 st-1 vc-0"/)
	})

	it('behaelt das leere class-Attribut des weissen Hintergrundpfads (M9)', () => {
		// ScorePage.vue schaltet genau dieses Element ueber path[class=""] auf
		// fill:none, damit der dahinterliegende Cursor sichtbar bleibt - geht
		// das Attribut verloren, ist der Cursor unsichtbar.
		const out = sanitizeSvg('<svg><path class="" fill="#ffffff" d="M0 0"/></svg>')
		expect(out).toMatch(/class=""/)
	})

	it('behaelt Text und Transformationen', () => {
		const out = sanitizeSvg('<svg><g transform="translate(10,20)"><text font-family="Edwin" font-size="20">Sopran</text></g></svg>')
		expect(out).toMatch(/transform="translate\(10,20\)"/)
		expect(out).toMatch(/Sopran/)
		expect(out).toMatch(/font-size="20"/)
	})

	it('behaelt Glyph-Referenzen der scoreview-engine (<use> auf lokale defs)', () => {
		// Browser-Backend: Text steht als <path id="gN"> in <defs> und wird
		// per <use xlink:href="#gN"> referenziert. Fliegt die Referenz raus,
		// ist jede Notenseite ohne sichtbaren Text.
		const svg = '<svg><defs><path id="g6" d="M1 2"/></defs><g class="VibratoSegment"><use xlink:href="#g6" transform="translate(0 0)"/></g></svg>'
		const out = sanitizeSvg(svg)
		expect(out).toMatch(/<use[^>]*href="#g6"/)
		expect(out).toMatch(/id="g6"/)
	})

	it('entfernt use-Referenzen, die KEIN lokales Fragment sind', () => {
		const out = sanitizeSvg('<svg><use xlink:href="http://evil/x.svg#a"/><use href="//evil/y#b"/></svg>')
		expect(out).not.toMatch(/href\s*=/i)
	})
})
