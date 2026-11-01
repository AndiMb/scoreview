import { computed, ref, watch } from 'vue'
import { translate } from '../l10n.js'
import { readStored, writeStored } from '../lib/storage.js'
import { availableSource, FORMATS, keyForChoice, sourceOptions } from '../lib/variantChoice.js'

const t = (text, vars) => translate('scoreview', text, vars)

/** The page format belongs to the device, not to the person (E19). */
const FORMAT_KEY = 'scoreview-variant-format'
/** Asked once per device whether phone pages are wanted. */
const PHONE_HINT_KEY = 'scoreview-phone-pages-offered'
/** The last variant shown per score on this device - what the offline page saves (useOffline.js). */
export const LAST_VARIANT_PREFIX = 'scoreview-variant.'
/** Below this width, a phone page is offered once (CSS pixels). */
const NARROW_PX = 600
const DEBOUNCE_MS = 400

/**
 * The display variant of the open score (docs/architecture.md E19): which
 * one is wanted, fetching it, showing it, and saying why not.
 *
 * Where it comes from is not decided here - `requestVariant` belongs to
 * useConversionStatus, which knows whether server or browser converted the
 * base (E3, E7). What is decided here is only *which* variant: from the
 * person's choice per score (part or score, concert pitch, notation
 * transposed - stored with the practice settings), the device's page format,
 * and the transposition of the sound.
 *
 * While a variant is being made the picture stays as it is; if it cannot be
 * made, the base stays and a hint says why. The choice is kept either way.
 *
 * @param {object} deps
 * @param {() => (number|string)} deps.fileId
 * @param {() => ?object} deps.meta the base meta.json, null while loading
 * @param {() => ?string} deps.myPartId
 * @param {() => object} deps.practice useMyPart's practice settings
 * @param {(changes: object) => void} deps.setPractice
 * @param {() => number} deps.transpose the sound's transposition
 * @param {() => boolean} deps.supported conversion.variantsSupported
 * @param {(key: string) => Promise<?object>} deps.requestVariant
 * @param {(answer: ?object) => Promise<boolean>} deps.applyPicture session.applyPicture
 * @param {() => ?string} deps.shownKey the variant on screen now (session.variantKey)
 * @param {() => number} [deps.viewportWidth]
 * @return {object}
 */
export function useScoreVariant(deps) {
	const storedFormat = readStored(FORMAT_KEY)
	const format = ref(FORMATS.includes(storedFormat) ? storedFormat : 'orig')
	// 'idle' | 'loading' | 'error'
	const status = ref('idle')
	const errorCode = ref('')
	const phoneHintDismissed = ref(readStored(PHONE_HINT_KEY) !== null)
	let request = 0

	const options = computed(() => sourceOptions(deps.meta(), deps.myPartId()))
	const source = computed(() => availableSource(deps.practice().source, deps.meta()))
	const concert = computed(() => deps.practice().concert === true)
	const transposeNotation = computed(() => deps.practice().transposeNotation === true)
	const hasTransposingParts = computed(() => deps.meta()?.hasTransposingParts === true)

	const wantedKey = computed(() => keyForChoice({
		source: source.value,
		format: format.value,
		// Concert pitch means nothing without a transposing instrument -
		// asking for it would only engrave the same page again.
		concert: concert.value && hasTransposingParts.value,
		transposeNotation: transposeNotation.value,
		transpose: deps.transpose(),
	}))

	// Debounced: stepping through a transposition one semitone at a time
	// would otherwise start a run for every step on the way (S4).
	let pending = null
	watch(
		() => [wantedKey.value, deps.meta() !== null, deps.supported()],
		() => {
			clearTimeout(pending)
			pending = setTimeout(show, DEBOUNCE_MS)
		},
	)

	async function show() {
		const mine = ++request
		const key = deps.meta() ? wantedKey.value : null
		if (!deps.meta()) {
			status.value = 'idle'
			return
		}
		if (key === deps.shownKey()) {
			status.value = 'idle'
			return
		}
		if (key === null) {
			await deps.applyPicture(null)
			if (mine === request) {
				status.value = 'idle'
				errorCode.value = ''
			}
			return
		}
		if (!deps.supported()) {
			// Shown as unavailable in the controls; the base stays.
			status.value = 'idle'
			return
		}
		status.value = 'loading'
		const answer = await deps.requestVariant(key)
		if (mine !== request || answer === null) {
			return
		}
		if (answer.status === 'ready' && await deps.applyPicture(answer)) {
			if (mine === request) {
				status.value = 'idle'
				errorCode.value = ''
				writeStored(LAST_VARIANT_PREFIX + deps.fileId(), key)
			}
			return
		}
		// A score switch while the picture was loading makes applyPicture
		// answer false - that is no failure of the variant, and an error
		// set now would stand over the next score.
		if (mine !== request) {
			return
		}
		status.value = 'error'
		errorCode.value = answer.errorCode || 'unknown'
		// Back to the base rather than keep a picture the choice no longer means.
		if (deps.shownKey() !== null) {
			await deps.applyPicture(null)
		}
	}

	function setSource(value) {
		deps.setPractice({ source: value })
	}

	function setFormat(value) {
		format.value = FORMATS.includes(value) ? value : 'orig'
		writeStored(FORMAT_KEY, format.value === 'orig' ? null : format.value)
	}

	function setConcert(value) {
		deps.setPractice({ concert: value === true })
	}

	function setTransposeNotation(value) {
		deps.setPractice({ transposeNotation: value === true })
	}

	/** Once per device, on a narrow screen, while pages are still A4. */
	const offerPhonePages = computed(() => deps.supported()
		&& deps.meta() !== null
		&& !phoneHintDismissed.value
		&& format.value === 'orig'
		&& (deps.viewportWidth?.() ?? window.innerWidth) < NARROW_PX)

	function answerPhoneOffer(accept) {
		phoneHintDismissed.value = true
		writeStored(PHONE_HINT_KEY, '1')
		if (accept) {
			setFormat('phone')
		}
	}

	/** Why the choices are greyed out - empty when they are not. */
	const unavailableReason = computed(() => (deps.supported()
		? ''
		: t('This server engraves no parts or phone pages; the score is shown as the file has it.')))

	const errorText = computed(() => {
		const texts = {
			variant_unsupported: t('This server engraves no parts or phone pages.'),
			rate_limited: t('Too many new parts or page formats in a short time. Please try again later.'),
			too_large: t('The score is too large to be engraved again.'),
			client_too_large: t('This score is too large to be set in this browser.'),
			client_engine_unavailable: t('The engraving engine could not be started in this browser.'),
			base_not_ready: t('The score changed in the meantime. Please open it again.'),
			// The sidecar engraves variants too (E19); these two are about the
			// service, not the score, and the server tries again after a minute.
			sidecar_busy: t('The conversion service is busy. Please try again in a moment.'),
			sidecar_unreachable: t('The conversion service could not be reached.'),
		}
		return texts[errorCode.value] ?? t('This part or page format could not be engraved. The score is shown as the file has it.')
	})

	/**
	 * The person has read the hint. It goes until the choice changes; on a
	 * phone it would otherwise keep a good part of the screen for good.
	 */
	function dismissError() {
		if (status.value === 'error') {
			status.value = 'idle'
		}
	}

	/** A failed variant again - most failures on a phone are a lost connection. */
	function retry() {
		clearTimeout(pending)
		return show()
	}

	/** On a score switch: nothing is shown or loading for the next one yet. */
	function reset() {
		clearTimeout(pending)
		request++
		status.value = 'idle'
		errorCode.value = ''
	}

	return {
		options,
		source,
		format,
		concert,
		transposeNotation,
		hasTransposingParts,
		wantedKey,
		status,
		errorCode,
		errorText,
		unavailableReason,
		offerPhonePages,
		answerPhoneOffer,
		setSource,
		setFormat,
		setConcert,
		setTransposeNotation,
		show,
		retry,
		dismissError,
		reset,
	}
}
