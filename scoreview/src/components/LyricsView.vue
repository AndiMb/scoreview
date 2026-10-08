<template>
	<!--
		Liedtext-Ansicht (H2): nur der Text der eigenen Stimme, die Strophen
		untereinander, ein Block je System. Lesbar auf dem Handy ohne Reflow
		des Notenbilds (E2) - Text darf umbrechen, Noten nicht.

		Die gesungene Silbe leuchtet ueber eine Klasse am Knoten, nicht ueber
		eine Vue-Eigenschaft: Die Zeit aendert sich in jedem Rahmen, und ein
		Neurendern aller Silben je Rahmen kostete auf dem Handy die Fluessigkeit
		(dasselbe Muster wie die Hervorhebung im Notenbild).
	-->
	<div ref="root" class="scoreview-lyrics" @pointerup="onPointerUp">
		<p v-if="blocks.length === 0" class="scoreview-lyrics-empty">
			{{ t('This part has no lyrics.') }}
		</p>
		<section
			v-for="block in blocks"
			:key="block.key"
			class="scoreview-lyrics-block">
			<p
				v-for="verse in block.verses"
				:key="verse.verse"
				class="scoreview-lyrics-verse"
				:class="{ 'scoreview-lyrics-verse--multi': verseCount > 1 }">
				<span v-if="verseCount > 1" class="scoreview-lyrics-number" aria-hidden="true">{{ verse.verse + 1 }}.</span>
				<span
					v-for="word in verse.words"
					:key="word.index"
					class="scoreview-lyrics-word"
					:data-word="word.index"
					@pointerdown="onPointerDown(word)"><span
						v-for="syl in word.syllables"
						:key="syl.id"
						:data-syl="syl.id">{{ syl.text }}</span></span>
			</p>
		</section>
	</div>
</template>

<script>
import { translate } from '@nextcloud/l10n'
import { activeSyllable, buildLyrics, occurrences, seekTimeFor, systemKeyFor, versesByElid } from '../lib/lyricsLayout.js'
import { findStepIndex } from '../lib/timingSync.js'

/** Klasse der gesungenen Silbe. */
const ACTIVE = 'scoreview-lyrics-active'

export default {
	name: 'LyricsView',

	props: {
		// meta.lyricSyllables (E15)
		syllables: {
			type: Array,
			required: true,
		},

		// Notenzeilen der eigenen Stimme, null = oberste Zeile mit Text (D8)
		staves: {
			type: Array,
			default: null,
		},

		// Timeline aus timing.json (events, times, elements)
		timeline: {
			type: Object,
			required: true,
		},

		// measures.json-Rechtecke je Seite (scoreLayout.groupRectsByPage)
		measureRectsByPage: {
			type: Array,
			default: () => [],
		},

		// Die gehoerte Zeit als FUNKTION (wie TempoControls): Als Wert
		// rendete die Ansicht in jedem Rahmen neu.
		readTimeMs: {
			type: Function,
			required: true,
		},

		// Ob ein Tipp springen darf (interactionPolicy 'seek')
		canSeek: {
			type: Boolean,
			required: true,
		},
	},

	emits: ['seek', 'loop'],

	computed: {
		layout() {
			return buildLyrics({
				syllables: this.syllables,
				staves: this.staves,
				blockKeyOf: (elid) => systemKeyFor(this.timeline.elements?.[elid] ?? null, this.measureRectsByPage),
			})
		},

		blocks() {
			return this.layout.blocks
		},

		verseCount() {
			return this.layout.verses.length
		},

		index() {
			return {
				syllableVerses: versesByElid(this.blocks),
				events: this.timeline.events ?? [],
				occ: occurrences(this.timeline.events ?? []),
			}
		},

		/** Wort-Index -> Wort, fuer Tippen und Ziehen. */
		wordsByIndex() {
			const map = new Map()
			for (const b of this.blocks) {
				for (const v of b.verses) {
					for (const w of v.words) {
						map.set(w.index, w)
					}
				}
			}
			return map
		},
	},

	watch: {
		blocks() {
			this.$nextTick(() => this.indexNodes())
		},
	},

	created() {
		// DOM-Knoten und Rahmenzustand ausserhalb von data(), siehe oben.
		this.nodes = new Map()
		this.activeNode = null
		this.activeId = null
		this.frame = null
		this.dragFrom = null
	},

	mounted() {
		this.indexNodes()
		const tick = () => {
			this.updateActive()
			this.frame = requestAnimationFrame(tick)
		}
		this.frame = requestAnimationFrame(tick)
	},

	beforeUnmount() {
		cancelAnimationFrame(this.frame)
	},

	methods: {
		indexNodes() {
			this.nodes = new Map()
			for (const el of this.$refs.root?.querySelectorAll('[data-syl]') ?? []) {
				this.nodes.set(el.dataset.syl, el)
			}
			this.activeId = null
			this.activeNode = null
		},

		/**
		 * Die gesungene Silbe nachfuehren. Bei einem Melisma oder einer Pause
		 * gibt es keine - dann bleibt die letzte stehen.
		 */
		updateActive() {
			const events = this.index.events
			if (events.length === 0) {
				return
			}
			const step = findStepIndex(this.timeline.times, this.readTimeMs())
			const id = activeSyllable(this.index, step)
			if (id === null || id === this.activeId) {
				return
			}
			this.activeNode?.classList.remove(ACTIVE)
			const node = this.nodes.get(id) ?? null
			node?.classList.add(ACTIVE)
			this.activeId = id
			this.activeNode = node
			if (node) {
				this.keepInView(node)
			}
		},

		/**
		 * Mitscrollen, aber nur, wenn die Silbe den mittleren Bereich verlaesst
		 * - ein staendig ruckelnder Text liesse sich nicht lesen.
		 *
		 * @param {Element} node
		 */
		keepInView(node) {
			// Gescrollt wird der Viewer, nicht diese Ansicht.
			const box = this.$el.closest?.('.scoreview-scroll') ?? this.$refs.root
			if (!box) {
				return
			}
			const r = node.getBoundingClientRect()
			const b = box.getBoundingClientRect()
			if (r.top < b.top + b.height * 0.2 || r.bottom > b.top + b.height * 0.75) {
				node.scrollIntoView({ block: 'center', behavior: 'smooth' })
			}
		},

		onPointerDown(word) {
			this.dragFrom = word
		},

		/**
		 * Tipp auf ein Wort: dorthin springen, in dem Durchlauf, in dem diese
		 * Strophe gesungen wird. Ziehen ueber mehrere Woerter: ein Loop von
		 * der ersten zur letzten Stelle.
		 *
		 * @param {PointerEvent} event
		 */
		onPointerUp(event) {
			const from = this.dragFrom
			this.dragFrom = null
			if (!from || !this.canSeek) {
				return
			}
			const target = event.target?.closest?.('[data-word]')
			const to = target ? this.wordsByIndex.get(Number(target.dataset.word)) : from
			const timeOf = (word, last) => {
				const syl = last ? word.syllables[word.syllables.length - 1] : word.syllables[0]
				return seekTimeFor(this.index.events, this.index.syllableVerses, syl.elid, word.verse)
			}
			if (!to || to.index === from.index) {
				const ms = timeOf(from, false)
				if (ms !== null) {
					this.$emit('seek', ms)
				}
				return
			}
			const [a, b] = from.index < to.index ? [from, to] : [to, from]
			const fromMs = timeOf(a, false)
			const toMs = timeOf(b, true)
			if (fromMs !== null && toMs !== null) {
				this.$emit('loop', { fromMs, toMs })
			}
		},

		t(text, vars) {
			return translate('scoreview', text, vars)
		},
	},
}
</script>

<style scoped>
.scoreview-lyrics {
	max-width: 46em;
	margin: 0 auto;
	padding: 12px 16px 40vh;
	font-size: 1.25rem;
	line-height: 1.6;
	box-sizing: border-box;
}

.scoreview-lyrics-block {
	padding: 10px 0;
	border-bottom: 1px solid var(--color-border, #ddd);
}

.scoreview-lyrics-verse {
	margin: 4px 0;
}

.scoreview-lyrics-verse--multi {
	padding-inline-start: 1.6em;
	text-indent: -1.6em;
}

.scoreview-lyrics-number {
	display: inline-block;
	width: 1.6em;
	text-indent: 0;
	color: var(--color-text-maxcontrast, #767676);
}

/* inline-block, weil zwischen den Woertern kein Leerraum steht (Vue entfernt
   ihn zwischen Elementen): Als blosse Inline-Elemente boten sie keine
   Umbruchstelle, und eine lange Strophe rutschte am Telefon als Ganzes unter
   ihre Nummer (gemessen am S23, 411 px). */
.scoreview-lyrics-word {
	display: inline-block;
	text-indent: 0;
	margin-inline-end: 0.35em;
	cursor: pointer;
	user-select: none;
}

.scoreview-lyrics-word :deep(.scoreview-lyrics-active) {
	background: var(--scoreview-highlight, #d32f2f);
	color: #fff;
	border-radius: 3px;
}

.scoreview-lyrics-empty {
	color: var(--color-text-maxcontrast, #767676);
	text-align: center;
}
</style>
