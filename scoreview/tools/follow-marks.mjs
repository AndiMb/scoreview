#!/usr/bin/env node
// Draft the marks.json of a recording (follower plan, task 4.2).
//
//   node tools/follow-marks.mjs <audio> --score <dir> [--out <json>] [--from <s>] [--to <s>] [--plan <text>]
//
// <dir> holds the conversion artifacts of the score that is sung (score.mid,
// meta.json, measures.json - from converter/convert.mjs or the app's cache).
// The draft goes to <audio>.marks.json unless --out says otherwise, and is
// never overwritten: a corrected file is worth more than a fresh draft.
// --from/--to limit it to one piece of a longer rehearsal (seconds).
// --plan says what was sung, if the annotator knows it ("46-60",
// "1/2-8/2; 5/2-8/2*", syntax at parsePlan in tools/follow/align.mjs); then
// the bars are not searched but only placed in time, which is far more
// reliable for a rehearsal full of restarts.
//
// The draft is a starting point, not the truth: listen through, correct the
// bars with "check": true first, add "jump" where a stretch restarts without
// a pause, and delete the "sim"/"check" fields if you like - the replay
// ignores them. Format: tools/follow/recording.mjs. Not part of the release
// tarball (tools/ is excluded).

import { existsSync, writeFileSync } from 'node:fs'
import { buildFollowReference } from '../src/lib/followRef.js'
import { alignPlan, parsePlan, proposeMarks } from './follow/align.mjs'
import { loadAudio, loadScore } from './follow/recording.mjs'
import { featureFrames, fftSizeFor } from './follow/replay.mjs'

const args = process.argv.slice(2)
function option(name) {
	const i = args.indexOf(name)
	return i >= 0 ? args[i + 1] : null
}

const audioFile = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))
const scoreDir = option('--score')
if (!audioFile || !scoreDir) {
	console.error('usage: node tools/follow-marks.mjs <audio> --score <dir> [--out <json>] [--from <s>] [--to <s>]')
	process.exit(2)
}
const out = option('--out') ?? audioFile.replace(/\.[^./\\]+$/, '') + '.marks.json'
if (existsSync(out)) {
	console.error(`${out} exists - not overwriting it. Move it away or pass --out.`)
	process.exit(1)
}

const started = Date.now()
const score = loadScore(scoreDir)
const reference = buildFollowReference(score.notes, score.parts, {
	durationMs: score.durationMs,
	markersMs: score.markersMs,
	measureStartsMs: score.measureStartsMs,
	systemStartsMs: score.systemStartsMs,
})
const audio = loadAudio(audioFile)
const fromMs = Number(option('--from') ?? 0) * 1000
const toMs = option('--to') === null ? Infinity : Number(option('--to')) * 1000
const fftSize = fftSizeFor(audio.sampleRate)
const frames = featureFrames(audio.samples, audio.sampleRate, { fftSize })
	.filter((f) => f.atMs >= fromMs && f.atMs <= toMs)
const windowMs = (fftSize / audio.sampleRate) * 1000
const planText = option('--plan')
let marks
let stretches = []
if (planText) {
	const plan = parsePlan(planText, score.bars)
	const result = alignPlan(frames, reference, score.bars, plan, { windowMs, durationMs: score.durationMs })
	marks = result.marks
	console.log(`plan ${planText}  similarity ${result.similarity.toFixed(2)}${result.rotation ? `  ${result.rotation > 0 ? '+' : ''}${result.rotation} semitone` : ''}  times ${result.times.join(',')}`)
} else {
	({ marks, stretches } = proposeMarks(frames, reference, score.bars, { windowMs }))
}

writeFileSync(out, '[\n' + marks.map((m) => '\t' + JSON.stringify(m)).join(',\n') + '\n]\n')
const seconds = (ms) => (ms / 1000).toFixed(1)
for (const s of stretches) {
	console.log(`stretch ${seconds(s.fromMs)}-${seconds(s.toMs)} s  similarity ${s.similarity.toFixed(2)}${s.rotation ? `  ${s.rotation > 0 ? '+' : ''}${s.rotation} semitone` : ''}`)
}
const toCheck = marks.filter((m) => m.check).length
console.log(`${marks.filter((m) => m.measure).length} bar marks, ${toCheck} to check -> ${out}  (${Date.now() - started} ms)`)
