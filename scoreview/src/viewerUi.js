// The heavy part of the Files entry (viewer.js): the viewer itself with the
// synthesizer, the mixer and every panel. viewer.js runs on EVERY Files page,
// with or without a score in sight, and used to carry all of this - ~2.2 MB
// of JavaScript parsed and compiled on each folder change, on a phone too.
// It now loads this chunk only when a score is actually opened.
import ScoreModal from './components/ScoreModal.vue'
import ScoreViewer from './components/ScoreViewer.vue'

export { ScoreModal, ScoreViewer }
