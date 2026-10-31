<template>
	<!--
		The singing lane (E24): target bars, the sung line and a word per
		judged note, on one canvas. No DOM element per note - under Nextcloud's
		stylesheet every element costs (measured in 1.26.x), and the lane
		changes sixty times a second. It paints only on the viewer's frame loop,
		which sleeps when the music stops.
	-->
	<div class="scoreview-sing-lane" :class="`scoreview-sing-lane--${mode}`">
		<canvas ref="canvas" class="scoreview-sing-canvas" aria-hidden="true" />
		<p class="scoreview-sing-hud" aria-live="off">
			<span class="scoreview-sing-pct">{{ livePct === null ? '–' : `${livePct} %` }}</span>
			<span class="scoreview-sing-meta">{{ metaText }}</span>
			<span v-if="liveOnly" class="scoreview-sing-unscored">{{ t('without score') }}</span>
		</p>
	</div>
</template>

<script>
import { translate } from '../l10n.js'
import { labelText, laneWindow, pitchRange, sungPitch, xOf, yOf } from '../lib/singLane.js'

/** Space for the lyrics under the lane in the stage view, CSS px. */
const LYRICS_HEIGHT = 44
/** A gap in the sung line longer than this breaks it, score ms per tempo. */
const LINE_GAP_MS = 70
/** Sharper than this is wasted on a phone's battery. */
const MAX_PIXEL_RATIO = 2

export default {
	name: 'SingLane',

	props: {
		/** 'band' under the score, or 'stage' over it with lyrics. */
		mode: { type: String, default: 'band' },
		readTimeMs: { type: Function, required: true },
		subscribeFrame: { type: Function, required: true },
		tempoFactor: { type: Number, default: 1 },
		/** My notes, all of them. */
		notes: { type: Array, default: () => [] },
		/** Judged chords by onset (useSingScore.results). */
		results: { type: Map, default: () => new Map() },
		readFrames: { type: Function, required: true },
		/** (fromMs, toMs) => [{scoreMs, text}] - only in the stage view. */
		syllablesFor: { type: Function, default: null },
		livePct: { type: Number, default: null },
		levelLabel: { type: String, default: '' },
		unitLabel: { type: String, default: '' },
		liveOnly: { type: Boolean, default: false },
	},

	computed: {
		range() {
			return pitchRange(this.notes)
		},

		metaText() {
			return [this.levelLabel, this.unitLabel].filter(Boolean).join(' · ')
		},

		sortedNotes() {
			return [...this.notes].sort((a, b) => a.onMs - b.onMs)
		},
	},

	watch: {
		results() {
			this.requestDraw()
		},

		mode() {
			this.$nextTick(() => this.resize())
		},
	},

	mounted() {
		this.colors = null
		this.resize()
		this.observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null
		this.observer?.observe(this.$el)
		this.offFrame = this.subscribeFrame(() => this.draw())
	},

	beforeUnmount() {
		this.offFrame?.()
		this.observer?.disconnect()
		if (this.pending) {
			cancelAnimationFrame(this.pending)
		}
	},

	methods: {
		t(text, vars) {
			return translate('scoreview', text, vars)
		},

		resize() {
			const canvas = this.$refs.canvas
			if (!canvas) {
				return
			}
			const box = canvas.getBoundingClientRect()
			const ratio = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1)
			canvas.width = Math.max(1, Math.round(box.width * ratio))
			canvas.height = Math.max(1, Math.round(box.height * ratio))
			this.ratio = ratio
			// Read once per size, not per frame: getComputedStyle forces style.
			const style = getComputedStyle(this.$el)
			const v = (name, fallback) => style.getPropertyValue(name).trim() || fallback
			this.colors = {
				green: v('--scoreview-intonation-green', '#43a047'),
				yellow: v('--scoreview-intonation-yellow', '#f9a825'),
				red: v('--scoreview-intonation-red', '#d32f2f'),
				open: 'rgba(255, 255, 255, 0.28)',
				grid: 'rgba(255, 255, 255, 0.07)',
				gridC: 'rgba(255, 255, 255, 0.16)',
				line: '#4fc3f7',
				now: 'rgba(255, 255, 255, 0.6)',
				text: '#e8eaf0',
				dim: '#9aa3b5',
			}
			this.draw()
		},

		requestDraw() {
			if (this.pending) {
				return
			}
			this.pending = requestAnimationFrame(() => {
				this.pending = null
				this.draw()
			})
		},

		draw() {
			const canvas = this.$refs.canvas
			const ctx = canvas?.getContext?.('2d')
			if (!ctx || !this.colors) {
				return
			}
			const c = this.colors
			const ratio = this.ratio
			const width = canvas.width / ratio
			const fullHeight = canvas.height / ratio
			const lyricsHeight = this.mode === 'stage' && this.syllablesFor ? LYRICS_HEIGHT : 0
			const height = fullHeight - lyricsHeight - 16
			ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
			ctx.clearRect(0, 0, width, fullHeight)

			const nowMs = this.readTimeMs()
			const win = laneWindow(nowMs, this.tempoFactor || 1)
			const range = this.range
			const row = height / (range.high - range.low + 1)
			const top = 8
			const y = (pitch) => top + yOf(pitch, range, height)

			// Semitone rows, the Cs a little brighter for orientation.
			for (let p = range.low; p <= range.high; p++) {
				ctx.fillStyle = p % 12 === 0 ? c.gridC : c.grid
				ctx.fillRect(0, y(p) - 0.5, width, 1)
			}

			// Target bars and their words.
			const barH = Math.max(4, Math.min(16, row * 0.7))
			ctx.font = `${Math.max(10, Math.min(13, row * 0.9))}px sans-serif`
			ctx.textBaseline = 'top'
			for (const n of this.sortedNotes) {
				if (n.offMs < win.fromMs) {
					continue
				}
				if (n.onMs > win.toMs) {
					break
				}
				const x1 = xOf(n.onMs, win, width)
				const x2 = Math.max(x1 + 3, xOf(n.offMs, win, width) - 2)
				const result = this.results.get(n.onMs)
				const judged = result && result.note.pitch === n.pitch
				ctx.fillStyle = judged ? c[result.cls] ?? c.open : (result ? 'rgba(255, 255, 255, 0.12)' : c.open)
				roundRect(ctx, x1, y(n.pitch) - barH / 2, x2 - x1, barH, barH / 2)
				if (judged) {
					// A bar sliding out to the left keeps its word in view.
					const tx = Math.max(2, Math.min(x1 >= 0 ? x1 : 2, x2 - 30))
					ctx.fillStyle = c.text
					ctx.fillText(labelText(result.label, this.t), tx, y(n.pitch) + barH / 2 + 2, Math.max(40, x2 - tx + 30))
				}
			}

			// The sung line, folded onto the note sung at that moment.
			ctx.strokeStyle = c.line
			ctx.lineWidth = 2.5
			ctx.lineJoin = 'round'
			ctx.beginPath()
			let ref = null
			let lastMs = null
			let open = false
			let noteIndex = 0
			const notes = this.sortedNotes
			for (const f of this.readFrames()) {
				if (f.scoreMs < win.fromMs || f.scoreMs > nowMs + 50) {
					continue
				}
				while (noteIndex < notes.length && notes[noteIndex].offMs <= f.scoreMs) {
					noteIndex++
				}
				const target = notes[noteIndex] && notes[noteIndex].onMs <= f.scoreMs ? notes[noteIndex] : null
				ref = target?.pitch ?? ref ?? Math.round((range.low + range.high) / 2)
				const pitch = sungPitch(f, ref)
				if (pitch === null || (lastMs !== null && f.scoreMs - lastMs > LINE_GAP_MS * (this.tempoFactor || 1))) {
					open = false
				}
				if (pitch !== null) {
					const px = xOf(f.scoreMs, win, width)
					const py = y(Math.max(range.low - 0.5, Math.min(range.high + 0.5, pitch)))
					if (open) {
						ctx.lineTo(px, py)
					} else {
						ctx.moveTo(px, py)
						open = true
					}
					ref = Math.round(pitch)
				}
				lastMs = f.scoreMs
			}
			ctx.stroke()

			// Now.
			const nowX = xOf(nowMs, win, width)
			ctx.fillStyle = c.now
			ctx.fillRect(nowX - 1, 0, 2, height + top + 8)

			if (lyricsHeight > 0) {
				ctx.font = '16px sans-serif'
				ctx.textBaseline = 'middle'
				const base = fullHeight - lyricsHeight / 2
				for (const s of this.syllablesFor(win.fromMs, win.toMs)) {
					ctx.fillStyle = s.scoreMs <= nowMs ? c.line : c.text
					ctx.fillText(s.text, xOf(s.scoreMs, win, width), base)
				}
			}
		},
	},
}

function roundRect(ctx, x, y, w, h, r) {
	ctx.beginPath()
	if (ctx.roundRect) {
		ctx.roundRect(x, y, w, h, r)
	} else {
		ctx.rect(x, y, w, h)
	}
	ctx.fill()
}
</script>

<style scoped>
.scoreview-sing-lane {
	position: relative;
	box-sizing: border-box;
	/* A stage, dark in the light theme too: the bars and the line read best on it. */
	background: #1e2330;
	color: #e8eaf0;
	overflow: hidden;
}

.scoreview-sing-lane--band {
	flex: 0 0 28%;
	min-height: 120px;
	border-top: 1px solid var(--color-border-dark);
}

.scoreview-sing-lane--stage {
	position: absolute;
	inset: 0;
	/* Over the score (z-index 1 and 2 in ScorePage.vue), under the panels (20). */
	z-index: 12;
}

.scoreview-sing-canvas {
	display: block;
	width: 100%;
	height: 100%;
}

.scoreview-sing-hud {
	position: absolute;
	top: 6px;
	inset-inline-end: 10px;
	margin: 0;
	display: flex;
	flex-direction: column;
	align-items: flex-end;
	pointer-events: none;
}

.scoreview-sing-pct {
	font-size: 22px;
	font-weight: bold;
	font-variant-numeric: tabular-nums;
}

.scoreview-sing-meta {
	font-size: 12px;
	color: #9aa3b5;
}

.scoreview-sing-unscored {
	font-size: 12px;
	color: #ffd54f;
}
</style>
