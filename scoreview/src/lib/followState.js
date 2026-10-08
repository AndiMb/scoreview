// „Folgt mir" im Browser (E10): Was ein Geraet mit einem neuen
// Stand der Leitung tut - rein, ohne Netz, ohne Uhr und ohne Viewer. Der
// Transport steht in composables/useFollowSession.js, die Ausfuehrung der
// Aktionen im Viewer.
//
// Der Server schickt keinen Befehlsstrom, sondern einen Zustand mit Zaehlern
// (Service\FollowService). Ob etwas zu tun ist, entscheidet sich hier am
// Vergleich der Zaehler mit dem, was dieses Geraet schon gesehen hat. Daraus
// folgt alles Weitere:
//
// - Ein Nachzuegler bekommt den letzten Stand und springt einmal.
// - Nach einem Funkloch gilt der letzte Stand; was dazwischen lag, wird
//   nicht nachgespielt.
// - Ein Zaehler, der nur „gesehen", aber nicht angewendet wurde (weil das
//   Geraet gerade nicht folgt), loest spaeter nichts mehr aus - „Zurueck zur
//   Leitung" wendet den letzten Stand gezielt an.

/**
 * So alt darf ein Anfangston hoechstens sein, gemessen an der Uhr des
 * Servers. Spaeter klingt er nicht mehr „auf Kommando", sondern
 * mitten in das, was die Leitung inzwischen sagt.
 */
export const TONE_MAX_AGE_MS = 2000

/**
 * Eigenes Navigieren, das das Folgen loest: Suchlauf, Takteingabe,
 * Studierbuchstabe, Klick auf eine Note, Sprung zu einer Notiz, Loop -
 * und eine eigene Transposition: Sonst ueberschriebe die naechste der
 * Leitung die eigene Wahl ungefragt.
 *
 * Blaettern und Zoom stehen bewusst NICHT darin: Wer am Notenstaender
 * umblaettert oder groesser zieht, will weiter der Leitung folgen - loeste
 * das das Folgen, waere es am Notenstaender nutzlos.
 */
export const UNFOLLOWING = Object.freeze(['seek', 'measure', 'mark', 'noteClick', 'annotationJump', 'loop', 'transpose'])

/** Was ausdruecklich NICHT loest - nur, damit die Tests es benennen koennen. */
export const KEEPS_FOLLOWING = Object.freeze(['page', 'zoom'])

/**
 * @return {object} der Ausgangszustand eines Geraets ohne Sitzung
 */
export function initialFollowState() {
	return {
		active: false,
		session: null,
		version: '0',
		leaderName: '',
		mine: false,
		// Voreingestellt wird gefolgt - auch schon vor der Sitzung, damit
		// der erste Stand gleich wirkt.
		following: true,
		seen: { position: 0, loop: 0, tone: 0, transpose: 0, moved: 0 },
		latest: { position: null, loop: null, transpose: null, moved: null },
		// Ob dieses Geraet gerade die Transposition der Leitung traegt - dann
		// gehoert beim Loesen oder Ende die eigene zurueck.
		sessionTranspose: false,
	}
}

/**
 * @param {object} local Zustand vor diesem Stand (initialFollowState)
 * @param {object} event
 *   - `{type: 'state', body, fileId?}` - Antwort des Servers (`version`,
 *     `active`, `leader`, `state`, `serverNow`); `fileId` ist die Partitur,
 *     die dieses Geraet gerade zeigt
 *   - `{type: 'navigate', kind}` - eigene Bedienung, siehe UNFOLLOWING
 *   - `{type: 'resume'}` - „Zurueck zur Leitung"
 * @return {{local: object, actions: Array<object>}}
 *   actions: `{type: 'seek', measure, mark}` | `{type: 'setLoop', from, to}`
 *   | `{type: 'clearLoop'}` | `{type: 'tone'}` | `{type: 'ended'}`
 *   | `{type: 'leaderChanged', name}` | `{type: 'setTranspose', semitones}`
 *   | `{type: 'restoreTranspose'}` | `{type: 'openPiece', fileId, setlistId}`
 *   | `{type: 'leaderMoved', fileId, setlistId}`
 */
export function reduce(local, event) {
	switch (event?.type) {
		case 'state':
			return applyState(local, event.body, event.fileId ?? null)
		case 'navigate':
			return navigate(local, event.kind)
		case 'resume':
			return resume(local)
		default:
			return { local, actions: [] }
	}
}

function applyState(local, body, fileId) {
	if (!body || typeof body !== 'object') {
		return { local, actions: [] }
	}
	if (!body.active) {
		// Beendet oder abgelaufen. Loop und Stelle bleiben, wie sie sind:
		// Mitten in der Probe soll das Ende der Sitzung nichts verstellen.
		const actions = local.active ? [{ type: 'ended' }] : []
		if (local.sessionTranspose) {
			actions.push({ type: 'restoreTranspose' })
		}
		return { local: { ...initialFollowState(), version: String(body.version ?? '0') }, actions }
	}

	const state = body.state ?? {}
	const newSession = state.session !== local.session
	// Eine neue Sitzung faengt fuer dieses Geraet von vorn an: alte Zaehler
	// gelten nicht mehr, und gefolgt wird wieder - auch wer die
	// letzte Sitzung verlassen hatte.
	const base = newSession ? { ...initialFollowState() } : local
	const mine = body.leader?.me === true
	const leaderName = String(body.leader?.displayName ?? '')
	const following = base.following
	// Die Leitung selbst folgt niemandem: Ihr eigenes Geraet setzt nur die
	// Zaehler nach, damit nach einer Uebergabe nichts Altes nachkommt.
	const applies = following && !mine
	const actions = []

	if (!newSession && local.leaderName && leaderName !== local.leaderName) {
		// Uebernahme durch eine andere Leitung - das wird allen angezeigt.
		actions.push({ type: 'leaderChanged', name: leaderName })
	}

	const seen = { ...base.seen }
	const latest = { ...base.latest }

	// Stelle und Loop gelten der Partitur, auf der die Sitzung sie gesetzt
	// hat. Waehrend eines Umzugs (V6) kann ein Stand der alten Datei noch
	// unterwegs sein - auf der neuen waere Takt 12 ein anderer Takt 12.
	const here = (part) => fileId === null || part.fileId === undefined || part.fileId === null
		|| String(part.fileId) === String(fileId)

	const position = state.position
	if (position && seq(position) > 0) {
		latest.position = { seq: seq(position), measure: position.measure, mark: position.mark ?? null, fileId: position.fileId ?? null }
		if (seq(position) > seen.position) {
			if (applies && here(position) && Number(position.measure) > 0) {
				actions.push({ type: 'seek', measure: Number(position.measure), mark: position.mark ?? null })
			}
			seen.position = seq(position)
		}
	}

	const loop = state.loop
	if (loop && seq(loop) > 0) {
		latest.loop = { seq: seq(loop), from: loop.from ?? null, to: loop.to ?? null, fileId: loop.fileId ?? null }
		if (seq(loop) > seen.loop && here(loop)) {
			const set = loop.from !== null && loop.from !== undefined
			// Beim ersten Stand einer Sitzung wird ein aufgehobener Loop nicht
			// „aufgehoben": Dieses Geraet hatte den Loop der Leitung nie, ein
			// Loop, den es vorher selbst gesetzt hat, soll nicht verschwinden,
			// nur weil es der Sitzung beitritt.
			if (applies && (set || !newSession)) {
				actions.push(set ? { type: 'setLoop', from: Number(loop.from), to: Number(loop.to) } : { type: 'clearLoop' })
			}
			seen.loop = seq(loop)
		}
	}

	const tone = state.tone
	if (tone && seq(tone) > seen.tone) {
		const age = Number(body.serverNow) - Number(tone.issuedAt)
		// Nur ein frischer Ton klingt, und nur, solange gefolgt wird:
		// Ein Geraet, das woanders steht, spielte sonst den Ton seiner Stimme
		// an SEINER Stelle - also womoeglich einen falschen.
		if (applies && Number.isFinite(age) && age <= TONE_MAX_AGE_MS) {
			actions.push({ type: 'tone' })
		}
		seen.tone = seq(tone)
	}

	let sessionTranspose = newSession ? false : base.sessionTranspose
	const transpose = state.transpose
	if (transpose && seq(transpose) > 0) {
		latest.transpose = { seq: seq(transpose), semitones: Number(transpose.semitones) || 0 }
		if (seq(transpose) > seen.transpose) {
			if (applies) {
				actions.push({ type: 'setTranspose', semitones: latest.transpose.semitones })
				sessionTranspose = true
			}
			seen.transpose = seq(transpose)
		}
	}

	const moved = state.moved
	if (!moved || seq(moved) === 0) {
		// Die Sitzung, in der dieses Geraet jetzt steht, ist nicht (mehr)
		// umgezogen - etwa die neue auf B. Ein gemerkter Umzug verfiele sonst
		// nicht, und „Zurueck zur Leitung" oeffnete nur B erneut.
		latest.moved = null
	} else if (moved.fileId !== null && moved.fileId !== undefined) {
		latest.moved = { seq: seq(moved), fileId: Number(moved.fileId), setlistId: moved.setlistId ?? null }
		if (seq(moved) > seen.moved) {
			// Die Leitung selbst ist schon dort; wer folgt, kommt mit;
			// wer sich geloest hat, bekommt nur den Hinweis (D5).
			if (applies) {
				actions.push({ type: 'openPiece', fileId: latest.moved.fileId, setlistId: latest.moved.setlistId })
			} else if (!mine) {
				actions.push({ type: 'leaderMoved', fileId: latest.moved.fileId, setlistId: latest.moved.setlistId })
			}
			seen.moved = seq(moved)
		}
	}

	return {
		local: {
			...base,
			active: true,
			session: state.session ?? null,
			version: String(body.version ?? '0'),
			leaderName,
			mine,
			following,
			seen,
			latest,
			sessionTranspose,
		},
		actions,
	}
}

function navigate(local, kind) {
	if (!local.active || local.mine || !local.following || !UNFOLLOWING.includes(kind)) {
		return { local, actions: [] }
	}
	const actions = local.sessionTranspose ? [{ type: 'restoreTranspose' }] : []
	return { local: { ...local, following: false, sessionTranspose: false }, actions }
}

/**
 * „Zurueck zur Leitung": den letzten Stand anwenden und wieder folgen.
 * Der Anfangston ist nicht dabei - er galt einem Augenblick, der vorbei ist.
 *
 * @param {object} local Zustand vor dem Zurueckkehren
 * @return {{local: object, actions: Array<object>}}
 */
function resume(local) {
	if (!local.active || local.mine) {
		return { local, actions: [] }
	}
	const actions = []
	const { position, loop, transpose, moved } = local.latest
	// Ist die Leitung inzwischen bei einem anderen Stueck, geht es zuerst
	// dorthin; Stelle und Loop der neuen Datei kommen mit ihrer Sitzung.
	if (moved) {
		actions.push({ type: 'openPiece', fileId: moved.fileId, setlistId: moved.setlistId })
		return { local: { ...local, following: true }, actions }
	}
	if (transpose) {
		actions.push({ type: 'setTranspose', semitones: transpose.semitones })
	}
	if (position && Number(position.measure) > 0) {
		actions.push({ type: 'seek', measure: Number(position.measure), mark: position.mark ?? null })
	}
	if (loop) {
		actions.push(loop.from !== null && loop.from !== undefined
			? { type: 'setLoop', from: Number(loop.from), to: Number(loop.to) }
			: { type: 'clearLoop' })
	}
	return { local: { ...local, following: true, sessionTranspose: Boolean(transpose) }, actions }
}

function seq(part) {
	const n = Number(part?.seq)
	return Number.isFinite(n) ? n : 0
}
