// Die Schalter der Administration fuer die Probe- und Konzertfunktionen,
// wie sie im Anfangszustand der Seite ankommen (Service\FeatureConfig,
// Schluessel `features`).
//
// Fehlt der Anfangszustand - eine Seite, auf der ihn niemand hinterlegt
// hat -, ist alles AUS. Das ist die sichere Richtung: Eine Funktion, die
// der Server nicht angekuendigt hat, soll der Viewer auch nicht anbieten; ihre
// Endpunkte antworteten ohnehin 404.

/** Grenzen wie auf dem Server (FeatureConfig::NUMBERS) - hier nur zur Abwehr von Unsinn. */
const NUMBERS = {
	followPollMs: [800, 500, 3000],
	maxRecordingsPerScore: [5, 1, 50],
	maxRecordingSeconds: [600, 10, 3600],
}

// `scoreFollower` is read by nobody in the viewer: the microphone follower
// is parked (see the PARKED note in lib/scoreFollower.js). The switch stays
// so the server's announcement and this list keep agreeing, and turning the
// work back on needs no change here.
const SWITCHES = ['followSession', 'recording', 'intonation', 'scoreFollower', 'practiceExport', 'offline', 'practiceLog', 'singScore']

/**
 * @param {?object} raw der Anfangszustand `features`, oder null
 * @return {{followSession:boolean, recording:boolean, intonation:boolean, scoreFollower:boolean, practiceExport:boolean, offline:boolean, practiceLog:boolean, singScore:boolean, followPollMs:number, maxRecordingsPerScore:number, maxRecordingSeconds:number}}
 */
export function normalizeFeatures(raw) {
	const result = {}
	for (const key of SWITCHES) {
		result[key] = raw?.[key] === true
	}
	for (const [key, [fallback, min, max]] of Object.entries(NUMBERS)) {
		const value = Number(raw?.[key])
		result[key] = Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback
	}
	return result
}
