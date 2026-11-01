/**
 * Errors of a conversion that the caller has to tell apart from "it failed",
 * carried as the process exit code.
 *
 * Why an exit code and not the message: three paths run this converter or
 * an equivalent - the app's local path (Service\LocalConverter), the
 * sidecar's engine renderer (scoreview_sidecar/engine.py) and, for the same
 * codes, the sidecar's MuseScore renderer - and the viewer translates the
 * code, not the text (E4). A message is free prose that differs per path
 * and per engine release; matching on it made the same score show a
 * different error depending on which path converted it (E3). An exit code
 * survives every runtime (Node, Deno) and needs no parsing of a stderr that
 * also carries MuseScore's log noise.
 *
 * The names are those of ScoreConversion::ERROR_* in the app. The numbers
 * are mirrored in LocalConverter::EXIT_CODES and in the sidecar's
 * errors.CONVERTER_EXIT_CODES; tests on both sides read this file to keep
 * them in step. 1 stays "failed for any other reason" - that is what Node
 * itself exits with on an uncaught error.
 */

export const EXIT_CODES = Object.freeze({
	no_pages: 3,
})

/** A failure with a code from EXIT_CODES. */
export class ConversionError extends Error {
	/**
	 * @param {keyof EXIT_CODES} errorCode
	 * @param {string} message
	 */
	constructor(errorCode, message) {
		super(message)
		this.name = 'ConversionError'
		// Not `code`: Node's own errors use that for ENOENT and friends, and
		// such a code must not be mistaken for one of ours.
		this.errorCode = errorCode
	}
}

/**
 * The exit code for an error thrown by a conversion.
 *
 * @param {unknown} error
 * @return {number}
 */
export function exitCodeOf(error) {
	if (error instanceof ConversionError && Object.hasOwn(EXIT_CODES, error.errorCode)) {
		return EXIT_CODES[error.errorCode]
	}
	return 1
}
