const webpackConfig = require('@nextcloud/webpack-vue-config')
const path = require('path')

// Entry-Name = Dateiname des erzeugten Bundles. Muss zu dem per
// Util::addScript geladenen Skript passen:
//   js/scoreview-main.js     -> addScript('scoreview', 'scoreview-main')      (PageController)
//   js/scoreview-settings.js -> addScript('scoreview', 'scoreview-settings')  (Settings\AdminSettings)
//   js/scoreview-viewer.js   -> addScript('scoreview', 'scoreview-viewer')    (Listener\FilesLoadAdditionalScriptsListener)
webpackConfig.entry = {
	'scoreview-main': path.join(__dirname, 'src', 'main.js'),
	'scoreview-settings': path.join(__dirname, 'src', 'settings.js'),
	'scoreview-viewer': path.join(__dirname, 'src', 'viewer.js'),
}

// Ausgabedateiname explizit festlegen (kein Content-Hash im Dateinamen),
// damit addScript die Datei zuverlässig findet.
webpackConfig.output = {
	...webpackConfig.output,
	filename: '[name].js',
}

module.exports = webpackConfig
