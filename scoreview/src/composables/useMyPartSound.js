import { computed, watch } from 'vue'
import { COACH_PROGRAM, coachMix } from '../lib/coachMix.js'
import { voiceFocusForPart } from '../lib/mixerLayout.js'
import { channelsOfPart, computePans } from '../lib/panLayout.js'

/**
 * Wie „Meine Stimme" klingt, unabhaengig davon, ob der Mixer offen ist:
 *
 * 1. **Lautstaerke:** Die serverseitig gemerkte Stimme (useMyPart.js) trifft
 *    ein, waehrend der Mixer zu ist - der haelt seinen Zustand nur, solange er
 *    angezeigt wird. Ohne diesen Schritt waere die Stimme nach dem Oeffnen
 *    markiert, klaenge aber wie alle anderen. Bei offenem Mixer stellt er
 *    selbst ein (ScoreMixer.vue beobachtet `myPartId`), sonst liefe hier ein
 *    zweiter Satz Lautstaerken ueber seine Mute-/Solo-Werte. Wie leise die
 *    anderen sind, sagt der Regler „andere Stimmen" (H4).
 * 2. **Stereobild:** nach lib/panLayout.js, wenn die Nutzerin es
 *    eingeschaltet hat. Mute und Solo gehen vor, weil sie auf CC7
 *    im Synthesizer wirken, das Panorama erst dahinter - ein Kanal ohne
 *    Lautstaerke ist auch rechts nicht zu hoeren.
 * 3. **Coach (H4):** die eigene Stimme als Klavier, rechts, die anderen
 *    links - unabhaengig vom Schalter fuers Stereobild, denn genau diese
 *    Trennung ist der Coach. Das Klavier wird beim Ausschalten wieder zum
 *    Instrument der Partitur; nur die Kanaele, die Coach umgestellt hat.
 *
 * @param {object} deps
 * @param {() => boolean} deps.hasRealPlayer
 * @param {() => Array} deps.mixerChannels
 * @param {() => ?string} deps.myPartId
 * @param {() => boolean} deps.stereoMyPart Nutzereinstellung
 * @param {() => boolean} deps.mixerOpen ob ScoreMixer gerade angezeigt wird
 * @param {(volumes: Map<number, number>) => void} deps.applyChannelVolumes
 * @param {(pans: Map<number, number>) => void} deps.applyChannelPans
 * @param {() => boolean} [deps.coach]
 * @param {() => number} [deps.othersLevel] 0..127
 * @param {(change: {channel: number, program: number}) => void} [deps.setProgram]
 */
export function useMyPartSound({ hasRealPlayer, mixerChannels, myPartId, stereoMyPart, mixerOpen, applyChannelVolumes, applyChannelPans, coach = () => false, othersLevel = () => 40, setProgram = () => {} }) {
	// Die Kanalnummern als Text: Ein neues, aber gleiches Array (zweiter
	// resolveMixerChannels()-Lauf) soll nicht erneut anwenden.
	const channelKey = computed(() => mixerChannels().map((ch) => `${ch.partId}:${ch.channel}`).join(','))

	const coachState = () => {
		if (!coach()) {
			return null
		}
		const channels = mixerChannels().map((ch) => ch.channel)
		return coachMix({ channels, myChannels: channelsOfPart(mixerChannels(), myPartId()), othersLevel: othersLevel() })
	}

	watch(
		() => [hasRealPlayer(), channelKey.value, myPartId(), coach(), othersLevel()],
		([real]) => {
			if (!real || mixerOpen()) {
				return
			}
			const mix = coachState()
			if (mix) {
				applyChannelVolumes(mix.volumes)
				return
			}
			const focus = voiceFocusForPart(mixerChannels(), myPartId(), { quiet: othersLevel() })
			if (focus) {
				applyChannelVolumes(focus.volumes)
			}
		},
		{ immediate: true },
	)

	// Ausgeschaltet heisst Mitte - und die Mitte laesst das Panorama der
	// Partitur unberuehrt (player.js), wer die Funktion nicht nutzt, merkt
	// also nichts davon.
	watch(
		() => [hasRealPlayer(), channelKey.value, myPartId(), stereoMyPart(), coach()],
		([real, , partId, enabled]) => {
			if (!real) {
				return
			}
			const mix = coachState()
			if (mix) {
				applyChannelPans(mix.pans)
				return
			}
			const channels = mixerChannels().map((ch) => ch.channel)
			applyChannelPans(computePans(channels, channelsOfPart(mixerChannels(), partId), enabled))
		},
		{ immediate: true },
	)

	// Kanaele, die Coach gerade aufs Klavier gestellt hat - nur diese
	// bekommen beim Ausschalten oder Stimmwechsel ihr Instrument zurueck.
	let coached = new Set()
	watch(
		() => [hasRealPlayer(), channelKey.value, myPartId(), coach()],
		([real]) => {
			if (!real) {
				coached = new Set()
				return
			}
			const mine = coach() ? new Set(channelsOfPart(mixerChannels(), myPartId()) ?? []) : new Set()
			const programOf = new Map(mixerChannels().map((ch) => [ch.channel, ch.program ?? 0]))
			for (const channel of coached) {
				if (!mine.has(channel)) {
					setProgram({ channel, program: programOf.get(channel) ?? 0 })
				}
			}
			for (const channel of mine) {
				if (!coached.has(channel)) {
					setProgram({ channel, program: COACH_PROGRAM })
				}
			}
			coached = mine
		},
		{ immediate: true },
	)
}
