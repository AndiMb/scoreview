// The entry of the print page (E16) - served under /apps/scoreview/print/{fileId}
// (PageController::print). Every page of one score at once, laid out for the
// browser's print dialog; opened from the viewer in Files.

import { createApp } from 'vue'
import PrintApp from './components/PrintApp.vue'

import './publicPath.js'

createApp(PrintApp).mount('#scoreview-print')
