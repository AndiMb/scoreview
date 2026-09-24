import { describe, expect, it } from 'vitest'
import { withAppVersion } from './assetVersion.js'

describe('withAppVersion', () => {
	it('haengt die Version als ?v= an', () => {
		expect(withAppVersion('/custom_apps/scoreview/js/scoreview-capture-worklet.js', '1.10.0'))
			.toBe('/custom_apps/scoreview/js/scoreview-capture-worklet.js?v=1.10.0')
	})

	it('ergaenzt einen vorhandenen Abfrageteil mit &', () => {
		expect(withAppVersion('/index.php/apps/x?a=1', '1.10.0')).toBe('/index.php/apps/x?a=1&v=1.10.0')
	})

	it('kodiert die Version', () => {
		expect(withAppVersion('/a.js', '1.10.0-dev 1')).toBe('/a.js?v=1.10.0-dev%201')
	})

	it('laesst die Adresse ohne Version unveraendert', () => {
		expect(withAppVersion('/a.js', undefined)).toBe('/a.js')
		expect(withAppVersion('/a.js', '')).toBe('/a.js')
	})
})
