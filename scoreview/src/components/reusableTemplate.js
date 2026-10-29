import { defineComponent, shallowRef } from 'vue'

/**
 * One piece of template, rendered in two places - like VueUse's
 * createReusableTemplate, which is all this app would take from VueUse.
 *
 * Used for the tool pages of the bar (E23): a page opens inside its group
 * and, once pinned, in a popover of its own. Written out twice, the ten pages
 * with their bindings would drift apart with the first change made to only
 * one of them.
 *
 * `Define` renders nothing and keeps its default slot; `Reuse` calls it with
 * its attributes as the slot props. Reactive reads happen in the render of
 * `Reuse`, so a page updates where it is shown. `Define` has to come first in
 * the template. Create one pair per component instance (in setup()).
 *
 * @return {{Define: object, Reuse: object}}
 */
export function createReusableTemplate() {
	const render = shallowRef(null)
	const Define = defineComponent({
		setup(_, { slots }) {
			return () => {
				render.value = slots.default
			}
		},
	})
	const Reuse = defineComponent({
		inheritAttrs: false,
		setup(_, { attrs }) {
			return () => render.value?.(attrs)
		},
	})
	return { Define, Reuse }
}
