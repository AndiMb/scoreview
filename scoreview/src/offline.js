// Der Einstieg der Offline-Seite (E14, H9) - ausgeliefert unter
// /apps/scoreview/offline (PageController::offline). Zeigt nur, was in
// DIESEM Browser vorgemerkt wurde, und oeffnet es im selben Viewer wie Files.

import { createApp } from 'vue'
import OfflineApp from './components/OfflineApp.vue'

import './publicPath.js'

createApp(OfflineApp).mount('#scoreview-offline')
