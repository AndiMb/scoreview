/**
 * Haengt die App-Version als Abfrageparameter an die Adresse eines Assets,
 * das nicht ueber Nextclouds `Util::addScript` hinausgeht.
 *
 * Warum: Nextcloud versieht per addScript geladene Bundles selbst mit `?v=`,
 * nachgeladene webpack-Teile (etwa der Tonhoehen-Worker) tragen ihren
 * Inhalts-Hash. Die beiden AudioWorklets aber (`spessasynth_processor.min.js`,
 * `scoreview-capture-worklet.js`) laedt der Browser per
 * `audioWorklet.addModule(url)` unter einer festen Adresse - nach einem
 * App-Update koennte er sonst einen alten Stand aus dem Cache nehmen, der
 * nicht mehr zum neuen Viewer passt. Die Version kommt beim Bauen aus
 * `appinfo/info.xml` (webpack.config.js), dieselbe Zahl, an der auch das
 * uebrige Cache-Busting haengt.
 *
 * @param {string} url Adresse ohne Abfrageteil oder mit
 * @param {string|undefined} version leer/undefiniert: Adresse unveraendert
 * @return {string}
 */
export function withAppVersion(url, version) {
	if (!version) {
		return url
	}
	const separator = url.includes('?') ? '&' : '?'
	return `${url}${separator}v=${encodeURIComponent(version)}`
}
