import { createApp } from 'vue'
import AdminSettings from './components/AdminSettings.vue'

// Eigenes Bundle statt Inline-<script> im PHP-Template: Nextclouds
// Content-Security-Policy blockt Inline-Scripts ohne Nonce, ein per
// Util::addScript geladenes Bundle bekommt die Nonce automatisch.
//
// Nur der Mountpunkt - die Seite selbst ist eine Vue-Komponente auf
// @nextcloud/vue (siehe components/AdminSettings.vue). Anders
// als der Viewer braucht sie dafuer keinen zweiten Vue-Baum: die
// Einstellungsseite wird von Nextcloud als gewoehnliches Template gerendert,
// es gibt hier keine fremde Vue-Instanz, mit der sich unsere stossen koennte
// (der Grund fuer die Wrapper-Konstruktion in src/viewer.js gilt nur dort).
createApp(AdminSettings).mount('#scoreview-admin-settings')
