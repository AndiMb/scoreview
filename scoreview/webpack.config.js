const webpackConfig = require('@nextcloud/webpack-vue-config')
const CopyWebpackPlugin = require('copy-webpack-plugin')
const path = require('path')

// Entry-Name = Dateiname des erzeugten Bundles. Muss zu dem per
// Util::addScript geladenen Skript passen:
//   js/scoreview-settings.js -> addScript('scoreview', 'scoreview-settings')  (Settings\AdminSettings)
//   js/scoreview-viewer.js   -> addScript('scoreview', 'scoreview-viewer')    (Listener\FilesLoadAdditionalScriptsListener)
webpackConfig.entry = {
	'scoreview-settings': path.join(__dirname, 'src', 'settings.js'),
	'scoreview-viewer': path.join(__dirname, 'src', 'viewer.js'),
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
