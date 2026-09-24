/**
 * Saetze des Viewers, die aus einem Zustand ausgewaehlt werden - als
 * Tabellen statt als if-Ketten, und mit `t` als Argument, damit sie ohne
 * Nextcloud pruefbar sind. Die Aufrufe bleiben woertliche t-Aufrufe mit dem
 * Quellstring als Literal: tools/l10n.mjs findet die Quellstrings genau daran.
 */

/**
 * Womit diese Seiten gesetzt wurden, als ein Satz.
 *
 * Der aufgezeichnete Weg DIESER Konvertierung, nicht die aktuelle
 * Einstellung der Instanz: Nach einem Wechsel stammt eine gecachte
 * Partitur weiterhin vom alten Weg, und genau dann wird die Frage
 * gestellt. `null` heisst "vor Einfuehrung der Aufzeichnung
 * konvertiert" - eine ehrliche Luecke statt einer Vermutung.
 *
 * Rein beschreibend (E3): Der Viewer verzweigt nirgends nach dem Weg, er
 * waehlt hier nur den Satz dazu aus.
 *
 * Bewusst OHNE Versionsnummer des Konvertierers: Die einzige
 * Versionsangabe, die vorliegt, ist `meta.mscoreVersion` - und die ist die
 * Version, mit der die PARTITUR geschrieben wurde, nicht die des
 * Konvertierers (nachgeprueft: sie stimmt mit `<programVersion>` in der
 * .mscz ueberein, nicht mit dem Engine-Release). Sie steht deshalb als
 * eigene Zeile daneben, mit ihrer eigenen Beschriftung.
 *
 * @param {?string} backend 'local' | 'sidecar' | 'client' | null
 * @param {(text: string, vars?: object) => string} t Uebersetzung
 * @return {string}
 */
export function rendererText(backend, t) {
	const texts = {
		local: () => t('scoreview-engine on this server (MuseScore as WebAssembly)'),
		sidecar: () => t('Sidecar container (MuseScore 4)'),
		// Kein gespeicherter Wert wie die beiden oben, sondern eine Aussage
		// ueber DIESE Sitzung: Auf diesem Weg wird nichts gecacht, die
		// Darstellung ist gerade eben hier entstanden.
		client: () => t('this browser (MuseScore as WebAssembly)'),
	}
	return typeof backend === 'string' && Object.hasOwn(texts, backend)
		? texts[backend]()
		: t('Unknown – converted by an earlier version of the app.')
}

/**
 * Was gerade passiert, waehrend konvertiert wird.
 *
 * Im Browser meldet die Engine keinen echten Fortschritt - nur die
 * Seitenschleife ist zaehlbar. Wichtiger als eine Prozentzahl ist ohnehin die
 * Stufe davor: Beim ersten Oeffnen laedt der Browser rund 14 MB Engine, und
 * das soll dastehen, statt als Stille zu erscheinen.
 *
 * Serverseitig konvertiert steht hier sonst nichts, weil es nichts zu melden
 * gibt. Dauert es ungewoehnlich lange, ist genau dieses Schweigen die
 * Fehlinformation - dann steht hier der haeufigste Grund, waehrend der
 * Kreisel weiterlaeuft. Wann es „ungewoehnlich lange" ist, entscheidet
 * useConversionStatus.js (`longWait`), nicht diese Funktion.
 *
 * @param {?{phase:string, page?:number, of?:number}} progress Fortschritt im Browser, null serverseitig
 * @param {boolean} longWait ob die Frist fuer den Hinweis verstrichen ist
 * @param {(text: string, vars?: object) => string} t Uebersetzung
 * @return {string} leer, wenn es nichts zu sagen gibt
 */
export function conversionProgressText(progress, longWait, t) {
	if (!progress) {
		return longWait
			? t('This is taking longer than usual. If it never finishes, check that background job processing (cron) is running on this server.')
			: ''
	}
	const phases = {
		source: () => t('Loading score…'),
		engine: () => t('Loading the conversion engine (about 14 MB, once per browser)…'),
		layout: () => t('Laying out the score…'),
		pages: () => t('Page {n} of {total}', { n: progress.page, total: progress.of }),
	}
	return typeof progress.phase === 'string' && Object.hasOwn(phases, progress.phase)
		? phases[progress.phase]()
		: ''
}
