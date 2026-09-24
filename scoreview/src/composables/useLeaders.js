import axios from '@nextcloud/axios'
import { translate } from '@nextcloud/l10n'
import { generateUrl } from '@nextcloud/router'
import { ref } from 'vue'
import { candidateQuery, normalizeLeaders } from '../lib/leaders.js'

/**
 * Die Leitungen der offenen Partitur (E9, Controller\LeaderController).
 *
 * Geladen wird beim Oeffnen der Datei, nicht erst beim Aufklappen der
 * Probe: Ob man selbst Leitung ist, brauchen auch Stimmnotizen und
 * „Folgt mir" - die Frage soll an einer Stelle beantwortet sein.
 *
 * `isLeader` ist hier eine Anzeigehilfe, keine Absicherung: Jeder
 * schreibende Aufruf wird auf dem Server geprueft (403), und ein Fehler von
 * dort landet in `error`, statt still zu verschwinden.
 *
 * @param {object} deps
 * @param {() => (number|string)} deps.fileId aktuelle fileId
 * @return {object}
 */
export function useLeaders({ fileId }) {
	const t = (text) => translate('scoreview', text)
	const leaders = ref([])
	const isLeader = ref(false)
	const error = ref('')
	const candidates = ref([])
	const visible = ref(false)

	// Wie in useMyPart: Eine Antwort, die nach einem Dateiwechsel oder einer
	// neueren Suche eintrifft, ist veraltet und darf nichts ueberschreiben.
	let generation = 0
	let searchGeneration = 0

	const url = (suffix = '') => generateUrl(`/apps/scoreview/api/scores/{fileId}/${suffix}`, { fileId: fileId() })

	function apply(data) {
		const normalized = normalizeLeaders(data)
		leaders.value = normalized.leaders
		isLeader.value = normalized.isLeader
	}

	/**
	 * Die Meldung des Servers, wenn er eine hat - sie nennt den Grund
	 * (Eigentuemerin, kein Zugriff) genauer, als es hier ein fester Text
	 * koennte.
	 *
	 * @param {Error} err Fehler aus axios
	 * @param {string} fallback Text, wenn der Server keinen mitschickt
	 * @return {string}
	 */
	function message(err, fallback) {
		return err?.response?.data?.error ?? fallback
	}

	async function load() {
		const mine = ++generation
		try {
			const res = await axios.get(url('leaders'))
			if (mine === generation) {
				apply(res.data)
			}
		} catch (err) {
			// Ohne Liste geht die Partitur trotzdem - kein Banner ueber den
			// Noten fuer eine Zusatzangabe.
			// eslint-disable-next-line no-console
			console.error('ScoreView: Leitungen konnten nicht geladen werden.', err)
		}
	}

	async function appoint(userId) {
		error.value = ''
		const mine = ++generation
		try {
			const res = await axios.post(url('leaders'), { userId })
			if (mine === generation) {
				apply(res.data)
				candidates.value = candidates.value.filter((c) => c.userId !== userId)
			}
		} catch (err) {
			error.value = message(err, t('Could not appoint this person.'))
		}
	}

	async function revoke(userId) {
		error.value = ''
		const mine = ++generation
		try {
			const res = await axios.delete(url('leaders/' + encodeURIComponent(userId)))
			if (mine === generation) {
				apply(res.data)
			}
		} catch (err) {
			error.value = message(err, t('Could not remove this leader.'))
			// Die Liste kann sich inzwischen geaendert haben (jemand anderes
			// hat zuerst abberufen) - neu laden statt einen alten Stand zu zeigen.
			load()
		}
	}

	async function search(query) {
		const mine = ++searchGeneration
		const q = candidateQuery(query)
		if (q === null) {
			candidates.value = []
			return
		}
		try {
			const res = await axios.get(url('leader-candidates'), { params: { q } })
			if (mine === searchGeneration) {
				candidates.value = Array.isArray(res.data) ? res.data : []
			}
		} catch (err) {
			if (mine === searchGeneration) {
				candidates.value = []
				error.value = message(err, t('Search failed.'))
			}
		}
	}

	function reset() {
		generation++
		searchGeneration++
		leaders.value = []
		isLeader.value = false
		error.value = ''
		candidates.value = []
	}

	return { leaders, isLeader, error, candidates, visible, load, appoint, revoke, search, reset }
}
