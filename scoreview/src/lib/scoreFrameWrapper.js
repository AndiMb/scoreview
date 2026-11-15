/**
 * The Viewer component of the public link page (src/public.js): an iframe on
 * the app's own page, nothing of the viewer UI.
 *
 * A plain-object component without a template, like ScoreViewerWrapper in
 * viewer.js: Viewer bundles its own copy of Vue, which cannot render a
 * template compiled against ours. render() returns null - a comment
 * placeholder - and the iframe is inserted next to it from plain DOM, which
 * also avoids importing Vue just for h() in a bundle loaded on every share
 * page.
 *
 * Only the ACTIVE file gets a frame. The handler is registered with a group
 * so that Viewer steps through the scores of a shared folder, and for a
 * grouped handler Viewer also mounts the previous and the next file, hidden,
 * to preload them (its template passes `active` only to the current one).
 * For a picture that is a cheap prefetch; for a score it would be two more
 * complete viewers - SoundFont, engine, audio context - and two status
 * requests that may queue conversions against the link's quota (S12). When
 * the visitor steps on, Viewer either re-renders the neighbour as the active
 * file or mounts it anew; both arrive here.
 *
 * @param {(fileId: number|string) => HTMLElement} createFrame builds the iframe
 * @return {object} the component definition
 */
export function scoreFrameWrapper(createFrame) {
	return {
		name: 'ScoreFrameWrapper',

		props: {
			fileid: {
				type: [Number, String],
				required: true,
			},
			// true only for the file Viewer shows; its hidden neighbours get false.
			active: {
				type: Boolean,
				default: false,
			},
			// Passed by Viewer as :loaded.sync; without update:loaded its spinner
			// would stay on top of the frame for good.
			loaded: {
				type: Boolean,
				default: false,
			},
		},

		emits: ['update:loaded'],

		render() {
			return null
		},

		mounted() {
			this.syncFrame()
			// At once: the framed page shows its own conversion and error
			// states, so Viewer's generic spinner would only cover them.
			this.$emit('update:loaded', true)
		},

		// beforeDestroy (Vue 2) and beforeUnmount (Vue 3): only the one of the
		// running Vue exists for it; the other name is ignored.
		beforeDestroy() {
			this.unmountFrame()
		},
		beforeUnmount() {
			this.unmountFrame()
		},

		watch: {
			fileid() {
				this.unmountFrame()
				this.syncFrame()
			},
			active() {
				this.syncFrame()
			},
		},

		methods: {
			/** A frame exactly while this is the file Viewer shows. */
			syncFrame() {
				if (!this.active) {
					this.unmountFrame()
					return
				}
				if (this.frame) {
					return
				}
				// Next to the placeholder, in its real parent: this.$el is a
				// comment node and cannot take children, and its own parent
				// belongs to Viewer's Vue, which never sees a node it did not
				// create.
				const parent = this.$el?.parentNode
				if (!parent) {
					return
				}
				this.frame = createFrame(this.fileid)
				parent.insertBefore(this.frame, this.$el.nextSibling)
			},
			unmountFrame() {
				this.frame?.remove()
				this.frame = null
			},
		},
	}
}
