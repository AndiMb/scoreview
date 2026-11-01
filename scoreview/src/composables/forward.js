/**
 * A function handed to a composable before the one that answers it exists.
 *
 * The viewer's composables mostly take getters and do not import each other.
 * A few depend on each other in a circle - performance mode asks whether a
 * leader is followed, and following a leader needs the policy of
 * performance mode - so one side has to be built first and learn its
 * partner later. `forward()` makes that late binding visible at both ends:
 * the call site passes `x.call`, the place that can answer says `x.to(fn)`,
 * and until then the fallback answers.
 *
 * Bound once: a second `to()` would mean two places claim to answer, and
 * the order in setup() would decide silently which one wins.
 *
 * @template {(...args: unknown[]) => unknown} F
 * @param {F} fallback what the call returns before it is bound
 * @return {{call: F, to: (fn: F) => void}}
 */
export function forward(fallback) {
	let target = null
	return {
		call: (...args) => (target ?? fallback)(...args),
		to(fn) {
			if (target !== null) {
				throw new Error('ScoreView: a forwarded call is bound twice.')
			}
			target = fn
		},
	}
}
