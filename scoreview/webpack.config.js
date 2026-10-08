const webpackConfig = require('@nextcloud/webpack-vue-config')
const CopyWebpackPlugin = require('copy-webpack-plugin')
const fs = require('fs')
const path = require('path')
const { DefinePlugin } = require('webpack')

// App-Version aus appinfo/info.xml, als Cache-Busting-Parameter fuer die
// AudioWorklets (src/lib/assetVersion.js): addModule(url) laedt sie unter
// einer festen Adresse, an der sonst nach einem Update ein alter Stand aus
// dem Browser-Cache haengen bliebe.
const appVersion = fs.readFileSync(path.join(__dirname, 'appinfo', 'info.xml'), 'utf8')
	.match(/<version>([^<]+)<\/version>/)[1]

// Entry-Name = Dateiname des erzeugten Bundles. Muss zu dem per
// Util::addScript geladenen Skript passen:
//   js/scoreview-settings.js -> addScript('scoreview', 'scoreview-settings')  (Settings\AdminSettings)
//   js/scoreview-viewer.js   -> addScript('scoreview', 'scoreview-viewer')    (Listener\FilesLoadAdditionalScriptsListener)
//   js/scoreview-standalone.js -> addScript('scoreview', 'scoreview-standalone') (DirectEditing\ScoreDirectEditor)
webpackConfig.entry = {
	'scoreview-settings': path.join(__dirname, 'src', 'settings.js'),
	'scoreview-viewer': path.join(__dirname, 'src', 'viewer.js'),
	// Die eigenstaendige Seite fuer die mobilen Apps - derselbe Viewer, nur
	// ohne Nextclouds Oberflaeche drumherum.
	'scoreview-standalone': path.join(__dirname, 'src', 'standalone.js'),
	// Das Aufnahme-Worklet (composables/useMicrophone.js laedt es per
	// audioWorklet.addModule). Ein eigener Einstieg statt eines nachgeladenen
	// Teils: Im AudioWorkletGlobalScope gibt es weder importScripts noch
	// fetch, das Bundle muss fuer sich allein stehen.
	'scoreview-capture-worklet': path.join(__dirname, 'src', 'worklets', 'captureWorklet.js'),
	// Der Render-Worker des Uebe-Tracks (H1). Ein eigener Einstieg statt
	// `new Worker(new URL(…))`: Als nachgeladener Teil spaltete die
	// Nextcloud-Vorlage spessasynth und lamejs in einen Vendor-Teil ab, den
	// der Worker dann unter dem festen Pfad /apps/scoreview/js/ suchte -
	// falsch, wenn die App unter custom_apps liegt (src/publicPath.js
	// korrigiert das nur fuer die Seite, nicht fuer einen Worker). Ein
	// Einstieg traegt seine Abhaengigkeiten in sich.
	'scoreview-render-worker': path.join(__dirname, 'src', 'workers', 'renderWorker.js'),
	// Die Offline-Seite (E14) und ihr Service Worker. Der Worker ist ein
	// eigener Einstieg aus demselben Grund wie der Render-Worker: Er laedt
	// keine nachgeladenen Teile nach und muss fuer sich allein stehen.
	'scoreview-offline': path.join(__dirname, 'src', 'offline.js'),
	'scoreview-offline-sw': path.join(__dirname, 'src', 'offline-sw.js'),
}

// Ausgabedateiname explizit festlegen (kein Content-Hash im Dateinamen),
// damit addScript die Datei zuverlässig findet.
webpackConfig.output = {
	...webpackConfig.output,
	filename: '[name].js',
}

// spessasynth_lib's AudioWorklet-Prozessor kann nicht importiert/gebündelt
// werden - er läuft in einem eigenen AudioWorkletGlobalScope und wird per
// `audioContext.audioWorklet.addModule(url)` als eigenständige Datei
// geladen (siehe lib/player.js). Deshalb Rohkopie statt Bundling, analog zu
// jedem anderen als URL referenzierten statischen Asset.
webpackConfig.plugins = [
	...(webpackConfig.plugins || []),
	new DefinePlugin({ SCOREVIEW_APP_VERSION: JSON.stringify(appVersion) }),
	new CopyWebpackPlugin({
		patterns: [
			{
				from: path.join(__dirname, 'node_modules', 'spessasynth_lib', 'dist', 'spessasynth_processor.min.js'),
				to: path.join(__dirname, 'js', 'spessasynth_processor.min.js'),
			},
		],
	}),
]

module.exports = webpackConfig
