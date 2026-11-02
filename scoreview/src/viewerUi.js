// The heavy part of the Files entry (viewer.js): the viewer itself with the
// synthesizer, the mixer and every panel. viewer.js runs on EVERY Files page,
// with or without a score in sight, so this chunk - about 2 MB of JavaScript
// to parse and compile - loads only when a score is actually opened.
import ScoreModal from './components/ScoreModal.vue'
import ScoreViewer from './components/ScoreViewer.vue'

export { ScoreModal, ScoreViewer }
