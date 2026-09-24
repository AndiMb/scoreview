import { computed, watch } from 'vue'
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
 *    zweiter Satz Lautstaerken ueber seine Mute-/Solo-Werte.
 * 2. **Stereobild:** nach lib/panLayout.js, wenn die Nutzerin es
 *    eingeschaltet hat. Mute und Solo gehen vor, weil sie auf CC7
 *    im Synthesizer wirken, das Panorama erst dahinter - ein Kanal ohne
 *    Lautstaerke ist auch rechts nicht zu hoeren.
 *
 * @param {object} deps
 * @param {() => boolean} deps.hasRealPlayer
 * @param {() => Array} deps.mixerChannels
 * @param {() => ?string} deps.myPartId
 * @param {() => boolean} deps.stereoMyPart Nutzereinstellung
 * @param {() => boolean} deps.mixerOpen ob ScoreMixer gerade angezeigt wird
 * @param {(volumes: Map<number, number>) => void} deps.applyChannelVolumes
 * @param {(pans: Map<number, number>) => void} deps.applyChannelPans
 */
export function useMyPartSound({ hasRealPlayer, mixerChannels, myPartId, stereoMyPart, mixerOpen, applyChannelVolumes, applyChannelPans }) {
	// Die Kanalnummern als Text: Ein neues, aber gleiches Array (zweiter
	// resolveMixerChannels()-Lauf) soll nicht erneut anwenden.
	const channelKey = computed(() => mixerChannels().map((ch) => `${ch.partId}:${ch.channel}`).join(','))

	watch(
		() => [hasRealPlayer(), channelKey.value, myPartId()],
		([real]) => {
			if (!real || mixerOpen()) {
				return
			}
			const focus = voiceFocusForPart(mixerChannels(), myPartId())
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
		() => [hasRealPlayer(), channelKey.value, myPartId(), stereoMyPart()],
		([real, , partId, enabled]) => {
			if (!real) {
				return
			}
			const channels = mixerChannels().map((ch) => ch.channel)
			applyChannelPans(computePans(channels, channelsOfPart(mixerChannels(), partId), enabled))
		},
		{ immediate: true },
	)
}
