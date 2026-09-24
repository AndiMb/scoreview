// „Meine Stimme" im Stereobild: die eigene Stimme auf ein Ohr, alle
// uebrigen auf das andere - das Cyberbass-Prinzip. Rein, ohne Synth: player.js
// setzt nur, was hier berechnet wird (ein StereoPannerNode je Kanal, warum
// nicht CC10, steht dort).
//
// Ganz aussen, nicht nur Richtung Rand: Die Abnahme verlangt die eigene
// Stimme „eindeutig auf einem Ohr", und in einer Probe mit Kopfhoerer ist
// genau diese Trennung der Nutzen.

/** Die eigene Stimme: ganz rechts (Web-Audio-Panorama, -1..1). */
export const PAN_MINE = 1
/** Alle uebrigen: ganz links. */
export const PAN_OTHERS = -1
/** Die Mitte - dort wirkt nur das Panorama der Partitur selbst. */
export const PAN_CENTER = 0

/**
 * @param {number[]} channels alle Kanaele des Mixers
 * @param {?number[]} myChannels Kanaele meiner Stimme; null/leer = keine gewaehlt
 * @param {boolean} enabled die Nutzereinstellung `stereo_my_part`
 * @return {Map<number, number>} channel -> -1 (links) .. 1 (rechts)
 */
export function computePans(channels, myChannels, enabled) {
	const mine = new Set(myChannels ?? [])
	// Ohne gewaehlte Stimme bleibt es bei der Mitte, auch mit Schalter: Es
	// gaebe nichts, was auf die eine Seite gehoerte, und alles links waere nur
	// ein schiefes Klangbild.
	const aktiv = enabled === true && mine.size > 0
	const result = new Map()
	for (const channel of channels ?? []) {
		if (!aktiv) {
			result.set(channel, PAN_CENTER)
		} else {
			result.set(channel, mine.has(channel) ? PAN_MINE : PAN_OTHERS)
		}
	}
	return result
}

/**
 * Die Kanaele einer Stimme aus den Mixerkanaelen (mixerLayout.js) - eine
 * Stimme kann mehrere haben (Divisi).
 *
 * @param {Array<{channel:number, partId:?string}>} mixerChannels
 * @param {?string} partId
 * @return {?number[]} null, wenn keine Stimme gewaehlt ist oder sie keine Kanaele hat
 */
export function channelsOfPart(mixerChannels, partId) {
	if (partId === null || partId === undefined) {
		return null
	}
	const channels = (mixerChannels ?? [])
		.filter((ch) => String(ch.partId) === String(partId))
		.map((ch) => ch.channel)
	return channels.length > 0 ? channels : null
}
