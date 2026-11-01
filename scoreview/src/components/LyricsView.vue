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
		<!--
			All parts at once: a row per part and system, and the parts that
			start a syllable light up together - who sings now, and who comes
			in next, without reading the full score.
		-->
		<NcCheckboxRadioSwitch
			v-if="choirPossible"
			class="scoreview-lyrics-switch"
			:modelValue="allParts"
			type="switch"
			@update:modelValue="setAllParts">
			{{ t('All parts') }}
		</NcCheckboxRadioSwitch>
		<template v-if="choirMode">
			<section
				v-for="block in choirBlocks"
				:key="block.key"
				class="scoreview-lyrics-block"
				:class="{ 'scoreview-lyrics-block--dimmed': focusKeys !== null && !focusKeys.has(block.key) }">
				<div
					v-for="row in block.rows"
					:key="row.staff"
					class="scoreview-lyrics-row"
					:class="{ 'scoreview-lyrics-row--mine': myStaffSet.has(row.staff) }">
					<span class="scoreview-lyrics-part">{{ row.label }}</span>
					<div class="scoreview-lyrics-row-text">
						<p
							v-for="verse in row.verses"
							:key="verse.verse"
							class="scoreview-lyrics-verse"
							:class="{ 'scoreview-lyrics-verse--multi': choirVerseCount > 1 }">
							<span v-if="choirVerseCount > 1" class="scoreview-lyrics-number" aria-hidden="true">{{ verse.verse + 1 }}.</span>
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
					</div>
				</div>
			</section>
		</template>
		<p v-else-if="blocks.length === 0" class="scoreview-lyrics-empty">
			{{ t('This part has no lyrics.') }}
		</p>
		<section
			v-for="block in (choirMode ? [] : blocks)"
			:key="block.key"
			class="scoreview-lyrics-block"
			:class="{ 'scoreview-lyrics-block--dimmed': focusKeys !== null && !focusKeys.has(block.key) }">
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
import NcCheckboxRadioSwitch from '@nextcloud/vue/components/NcCheckboxRadioSwitch'
import { translate } from '../l10n.js'
import { activeSyllable, buildChoirLyrics, buildLyrics, choirActiveSyllables, choirVersesByElid, occurrences, seekTimeFor, systemKeyFor, versesByElid } from '../lib/lyricsLayout.js'
import { spanInView } from '../lib/scrollPlan.js'
import { readStored, writeStored } from '../lib/storage.js'
import { findStepIndex } from '../lib/timingSync.js'

/** Klasse der gesungenen Silbe. */
const ACTIVE = 'scoreview-lyrics-active'

/** Class of a part's row that starts a syllable now (all parts). */
const SINGING = 'scoreview-lyrics-row--singing'

/** The "all parts" choice, per device: a phone may want one part, a tablet all. */
const ALL_PARTS_KEY = 'scoreview.lyricsAllParts'

/** @return {boolean} */
function readAllParts() {
	return readStored(ALL_PARTS_KEY) === '1'
}

export default {
	name: 'LyricsView',

	components: { NcCheckboxRadioSwitch },

	props: {
		// The part names by staff (lyricsLayout.staffPartNames), or null
		// where staves and parts do not match - then the rows say "Staff n".
		partNames: {
			type: Array,
			default: null,
		},

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

		// The viewer's time loop as a subscription (useScoreSession.onFrame):
		// the active syllable follows its beat and sleeps with it - a loop
		// of its own ran every frame, paused or not.
		subscribeFrame: {
			type: Function,
			required: true,
		},

		// Ob ein Tipp springen darf (interactionPolicy 'seek')
		canSeek: {
			type: Boolean,
			required: true,
		},

		// Whether the sung syllable scrolls into view by itself - off when
		// the user switched autoscroll off (issue #12), on again for a jump.
		follow: {
			type: Boolean,
			required: true,
		},

		// Focus on the loop (B4): the block keys (lib/loopFocus.js
		// loopSystemKeys) the loop touches - the other blocks step back.
		// null = no focus.
		focusKeys: {
			type: Set,
			default: null,
		},
	},

	emits: ['seek', 'loop', 'cursorVisible'],

	data() {
		return {
			allParts: readAllParts(),
		}
	},

	computed: {
		choirLayout() {
			return buildChoirLyrics({
				syllables: this.syllables,
				blockKeyOf: (elid) => systemKeyFor(this.timeline.elements?.[elid] ?? null, this.measureRectsByPage),
				labelOf: (staff) => this.partNames?.[staff] || this.t('Staff {n}', { n: staff + 1 }),
			})
		},

		/** Only worth offering where more than one staff has text. */
		choirPossible() {
			return this.choirLayout.staves.length > 1
		},

		choirMode() {
			return this.allParts && this.choirPossible
		},

		choirBlocks() {
			return this.choirLayout.blocks
		},

		choirVerseCount() {
			return this.choirLayout.verseCount
		},

		choirIndex() {
			return {
				byStaff: choirVersesByElid(this.choirBlocks),
				events: this.timeline.events ?? [],
				occ: this.index.occ,
			}
		},

		// Only a chosen part is "mine" - the single-part view's fallback to
		// the top staff is not a choice.
		myStaffSet() {
			return new Set(this.staves ?? [])
		},

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
			if (this.choirMode) {
				for (const b of this.choirBlocks) {
					for (const row of b.rows) {
						for (const v of row.verses) {
							for (const w of v.words) {
								map.set(w.index, w)
							}
						}
					}
				}
				return map
			}
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

		choirMode() {
			this.$nextTick(() => {
				this.indexNodes()
				this.updateActive()
			})
		},

		// The syllable changes in the frame loop, `follow` only with the
		// viewer's next render - after a jump the new syllable is set while
		// `follow` is still false, and the same syllable does not come again.
		// So catch up here.
		follow(on) {
			if (on && this.activeNode) {
				this.keepInView(this.activeNode)
			}
		},
	},

	created() {
		// DOM-Knoten und Rahmenzustand ausserhalb von data(), siehe oben.
		this.nodes = new Map()
		this.activeNode = null
		this.activeId = null
		// All parts: every lit syllable and row, to switch them off again.
		this.litNodes = []
		this.litRows = []
		this.offFrame = null
		this.dragFrom = null
		// Last visibility reported - an event per change, not per syllable.
		this.syllableShown = true
	},

	mounted() {
		this.indexNodes()
		this.offFrame = this.subscribeFrame(() => this.updateActive())
		this.updateActive()
	},

	beforeUnmount() {
		this.offFrame?.()
	},

	methods: {
		indexNodes() {
			this.nodes = new Map()
			for (const el of this.$refs.root?.querySelectorAll('[data-syl]') ?? []) {
				this.nodes.set(el.dataset.syl, el)
			}
			this.activeId = null
			this.activeNode = null
			this.clearLit()
		},

		clearLit() {
			for (const node of this.litNodes) {
				node.classList.remove(ACTIVE)
			}
			for (const row of this.litRows) {
				row.classList.remove(SINGING)
			}
			this.litNodes = []
			this.litRows = []
		},

		/** @param {boolean} on */
		setAllParts(on) {
			this.allParts = on
			writeStored(ALL_PARTS_KEY, on ? '1' : '0')
		},

		/**
		 * All parts: light every part that starts a syllable here. During a
		 * melisma or a rest nobody starts one - then the last stay lit, as in
		 * the single-part view.
		 *
		 * @param {number} step
		 */
		updateChoirActive(step) {
			const lit = choirActiveSyllables(this.choirIndex, step)
			const key = lit.map((l) => l.id).join('|')
			if (lit.length === 0 || key === this.activeId) {
				return
			}
			this.clearLit()
			for (const { id } of lit) {
				const node = this.nodes.get(id)
				if (!node) {
					continue
				}
				node.classList.add(ACTIVE)
				this.litNodes.push(node)
				const row = node.closest('.scoreview-lyrics-row')
				if (row && !this.litRows.includes(row)) {
					row.classList.add(SINGING)
					this.litRows.push(row)
				}
			}
			this.activeId = key
			// Scroll along with the own part where it sings, else the first.
			const mine = lit.find((l) => this.myStaffSet.has(l.staff))
			const node = this.nodes.get((mine ?? lit[0]).id) ?? null
			this.activeNode = node
			if (node) {
				this.keepInView(node)
			}
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
			if (this.choirMode) {
				this.updateChoirActive(step)
				return
			}
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
			if (!this.follow) {
				this.report(spanInView({ start: r.top, size: r.height, viewStart: b.top, viewSize: b.height }))
				return
			}
			if (r.top < b.top + b.height * 0.2 || r.bottom > b.top + b.height * 0.75) {
				node.scrollIntoView({ block: 'center', behavior: 'smooth' })
			}
			this.report(true)
		},

		/** To the sung syllable - the button back to it, and switching autoscroll on again. */
		reveal() {
			this.activeNode?.scrollIntoView({ block: 'center', behavior: 'smooth' })
			this.report(true)
		},

		/** After a manual scroll: is the sung syllable still on screen? */
		reportVisibility() {
			const box = this.$el.closest?.('.scoreview-scroll') ?? this.$refs.root
			if (!box || !this.activeNode) {
				return
			}
			const r = this.activeNode.getBoundingClientRect()
			const b = box.getBoundingClientRect()
			this.report(spanInView({ start: r.top, size: r.height, viewStart: b.top, viewSize: b.height }))
		},

		/** @param {boolean} visible */
		report(visible) {
			if (visible !== this.syllableShown) {
				this.syllableShown = visible
				this.$emit('cursorVisible', visible)
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
				const verses = this.choirMode ? (this.choirIndex.byStaff.get(word.staff) ?? new Map()) : this.index.syllableVerses
				return seekTimeFor(this.index.events, verses, syl.elid, word.verse)
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

.scoreview-lyrics-block--dimmed {
	opacity: 0.35;
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

.scoreview-lyrics-switch {
	margin-block-end: 8px;
	font-size: var(--default-font-size, 15px);
}

/* All parts: the part's name in a narrow column, the text beside it. */
.scoreview-lyrics-row {
	display: flex;
	gap: 0.6em;
	align-items: baseline;
	border-inline-start: 3px solid transparent;
	padding-inline-start: 6px;
}

.scoreview-lyrics-row-text {
	flex: 1;
	min-inline-size: 0;
}

.scoreview-lyrics-part {
	flex: 0 0 5.5em;
	overflow: hidden;
	color: var(--color-text-maxcontrast, #767676);
	font-size: 0.75em;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.scoreview-lyrics-row--mine .scoreview-lyrics-part {
	color: inherit;
	font-weight: bold;
}

/* Who starts a syllable now: a bar in the highlight colour at the row. */
.scoreview-lyrics-row--singing {
	border-inline-start-color: var(--scoreview-highlight, #d32f2f);
}

.scoreview-lyrics-empty {
	color: var(--color-text-maxcontrast, #767676);
	text-align: center;
}
</style>
