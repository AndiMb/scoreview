// How the tools and groups of the bar look: icon and name, by the ids of
// lib/barGroups.js. One map each for the row in the group and the pinned
// button (E23), so the two never show a different icon or name for the same
// tool. What is visible and what is on stays in lib/barGroups.js.
import AccountTieVoiceOutline from 'vue-material-design-icons/AccountTieVoiceOutline.vue'
import AccountVoice from 'vue-material-design-icons/AccountVoice.vue'
import Alphabetical from 'vue-material-design-icons/Alphabetical.vue'
import BookMusicOutline from 'vue-material-design-icons/BookMusicOutline.vue'
import BookOpenPageVariantOutline from 'vue-material-design-icons/BookOpenPageVariantOutline.vue'
import ChartBar from 'vue-material-design-icons/ChartBar.vue'
import ChevronDoubleDown from 'vue-material-design-icons/ChevronDoubleDown.vue'
import CloudDownloadOutline from 'vue-material-design-icons/CloudDownloadOutline.vue'
import EyeOutline from 'vue-material-design-icons/EyeOutline.vue'
import FileMusicOutline from 'vue-material-design-icons/FileMusicOutline.vue'
import FocusFieldHorizontal from 'vue-material-design-icons/FocusFieldHorizontal.vue'
import HeadphonesSettings from 'vue-material-design-icons/HeadphonesSettings.vue'
import InformationOutline from 'vue-material-design-icons/InformationOutline.vue'
import MessageTextOutline from 'vue-material-design-icons/MessageTextOutline.vue'
import Metronome from 'vue-material-design-icons/Metronome.vue'
import Microphone from 'vue-material-design-icons/Microphone.vue'
import MicrophoneVariant from 'vue-material-design-icons/MicrophoneVariant.vue'
import NotebookOutline from 'vue-material-design-icons/NotebookOutline.vue'
import Palette from 'vue-material-design-icons/Palette.vue'
import Piano from 'vue-material-design-icons/Piano.vue'
import PlaylistPlus from 'vue-material-design-icons/PlaylistPlus.vue'
import Printer from 'vue-material-design-icons/Printer.vue'
import Repeat from 'vue-material-design-icons/Repeat.vue'
import SineWave from 'vue-material-design-icons/SineWave.vue'
import Speedometer from 'vue-material-design-icons/Speedometer.vue'
import SwapVertical from 'vue-material-design-icons/SwapVertical.vue'
import TuneVertical from 'vue-material-design-icons/TuneVertical.vue'
import { translate } from '../l10n.js'

// Called when a name is shown, not at import: the language is known by then.
const t = (text) => translate('scoreview', text)

export const TOOL_ICONS = Object.freeze({
	loop: Repeat,
	metronome: Metronome,
	tempo: Speedometer,
	mixer: TuneVertical,
	transpose: SwapVertical,
	coach: Piano,
	recording: Microphone,
	tuner: SineWave,
	practiceLog: ChartBar,
	sing: MicrophoneVariant,
	autoScroll: ChevronDoubleDown,
	myPart: FocusFieldHorizontal,
	noteNames: Alphabetical,
	annotations: NotebookOutline,
	noteText: MessageTextOutline,
	layout: BookOpenPageVariantOutline,
	appearance: Palette,
	partChoice: AccountVoice,
	rehearsal: AccountTieVoiceOutline,
	newSetlist: PlaylistPlus,
	print: Printer,
	export: FileMusicOutline,
	offline: CloudDownloadOutline,
	info: InformationOutline,
})

const TOOL_LABELS = Object.freeze({
	loop: () => t('Loop'),
	metronome: () => t('Metronome'),
	tempo: () => t('Tempo'),
	mixer: () => t('Mixer'),
	transpose: () => t('Transpose'),
	coach: () => t('Coach'),
	recording: () => t('Recording and intonation'),
	tuner: () => t('Tuner'),
	practiceLog: () => t('Practice log'),
	sing: () => t('Scored singing'),
	autoScroll: () => t('Scroll along with playback'),
	myPart: () => t('Show only my part'),
	noteNames: () => t('Note names and counting'),
	annotations: () => t('Notes'),
	noteText: () => t('Show notes in the score'),
	layout: () => t('Pages and edition'),
	appearance: () => t('Colours'),
	partChoice: () => t('My part'),
	rehearsal: () => t('Leaders and “Follow me”'),
	newSetlist: () => t('New setlist'),
	print: () => t('Print'),
	export: () => t('Save as audio file'),
	offline: () => t('Save for offline use'),
	info: () => t('Info and diagnostics'),
})

export const GROUP_ICONS = Object.freeze({
	playback: HeadphonesSettings,
	view: EyeOutline,
	score: BookMusicOutline,
})

const GROUP_LABELS = Object.freeze({
	playback: () => t('Playback and practice'),
	view: () => t('View'),
	score: () => t('Score'),
})

/**
 * @param {string} id a tool of lib/barGroups.js
 * @return {string} its name - the same in its group and on its pinned button
 */
export function toolLabel(id) {
	return TOOL_LABELS[id]?.() ?? id
}

/**
 * @param {string} id a group of lib/barGroups.js
 * @return {string}
 */
export function groupLabel(id) {
	return GROUP_LABELS[id]?.()
}
