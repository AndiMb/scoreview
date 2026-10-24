#!/usr/bin/env node
// Measuring rig of the microphone follower (follower plan, phase 1).
//
//   node tools/follow-replay.mjs [--case <name>|all] [--follow] [--csv <file>] [--wav <dir>]
//   node tools/follow-replay.mjs --recording <audio> --score <dir> [--marks <json>] [--anchored] [--csv <file>]
//
// Renders the synthetic cases of tools/follow/replay.mjs, runs them through
// the same feature chain as the viewer and prints the feature diagnosis:
// similarity at the true position and whether the best match lies near it.
// With --follow, it runs the score follower instead (started at an anchor
// where the performance begins) and prints the acceptance figures.
// With --wav, the rendered cases are also written as WAV files (to listen,
// or to feed a browser as a fake microphone). Not part of the release
// tarball (tools/ is excluded).
//
// With --recording, a real recording is followed instead: --score names a
// directory with the conversion artifacts (score.mid, meta.json,
// measures.json), the marks default to <audio>.marks.json next to the
// recording (format in tools/follow/recording.mjs; draft them with
// tools/follow-marks.mjs). Recordings stay out of the repository.

import { Buffer } from 'node:buffer'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { buildFollowReference } from '../src/lib/followRef.js'
import { encodeWav } from '../src/lib/wavCodec.js'
import { generatePiece } from './follow/piece.mjs'
import { loadAudio, loadScore, marksFileFor, marksToTruth } from './follow/recording.mjs'
import { diagnose, featureFrames, fftSizeFor, followCase, followFrames, syntheticCase, syntheticCases } from './follow/replay.mjs'

const args = process.argv.slice(2)
function option(name) {
	const i = args.indexOf(name)
	return i >= 0 ? args[i + 1] : null
}

const recording = option('--recording')
const wanted = option('--case') ?? 'all'
const names = recording ? [] : wanted === 'all' ? Object.keys(syntheticCases(generatePiece())) : [wanted]
const csv = option('--csv')
const wavDir = option('--wav')
const csvRows = [args.includes('--follow') || recording
	? 'case,atMs,truthMs,shownMs,confirmedMs,phase,ensemble,tuningCents'
	: 'case,atMs,truthMs,similarityAtTruth,betterPositions,bestMs,tuningCents']
const pct = (v) => (v === null ? '-' : `${(100 * v).toFixed(1)} %`)

if (recording) {
	followRecording(recording)
}

for (const name of names) {
	const started = Date.now()
	const kase = syntheticCase(name)
	const { samples, sampleRate, truth } = kase.performance
	if (wavDir) {
		mkdirSync(wavDir, { recursive: true })
		writeFileSync(path.join(wavDir, `${name}.wav`), Buffer.from(encodeWav(samples, sampleRate)))
		writeFileSync(path.join(wavDir, `${name}.truth.json`), JSON.stringify(truth))
	}
	if (args.includes('--follow')) {
		const { metrics, replay } = followCase(kase)
		report(name, metrics, replay, started)
		continue
	}
	const frames = featureFrames(samples, sampleRate)
	const result = diagnose(frames, kase.reference, truth)
	for (const r of result.rows) {
		csvRows.push([name, r.atMs.toFixed(0), r.truthMs.toFixed(0), r.similarityAtTruth.toFixed(3), r.betterPositions, r.bestMs.toFixed(0), r.tuningCents.toFixed(1)].join(','))
	}
	console.log(`${name.padEnd(16)} median similarity at truth ${result.medianSimilarity?.toFixed(3)}  best match within 2 s of truth ${(100 * result.shareBestNearTruth).toFixed(0)} %  (${frames.length} frames, ${Date.now() - started} ms)`)
}

if (csv) {
	writeFileSync(csv, csvRows.join('\n') + '\n')
}

function report(name, m, replay, started) {
	console.log(`${name.padEnd(16)} A1 ${pct(m.a1WithinOneBar)}  error median/p95/max ${m.errorMs.median.toFixed(0)}/${m.errorMs.p95.toFixed(0)}/${m.errorMs.max.toFixed(0)} ms  A2 jumps ${m.a2WrongJumps} turns ${m.a2WrongTurns ?? '-'}  A9 ${pct(m.a9Punctual ?? null)}  tuning ${replay.at(-1).tuningCents.toFixed(0)} ct  (${Date.now() - started} ms)`)
	for (const r of replay) {
		csvRows.push([name, r.atMs.toFixed(0), r.truthMs?.toFixed(0) ?? '', r.shownMs?.toFixed(0) ?? '', r.confirmedMs?.toFixed(0) ?? '', r.phase, r.ensemble ?? '', r.tuningCents.toFixed(1)].join(','))
	}
}

function followRecording(audioFile) {
	const started = Date.now()
	const scoreDir = option('--score')
	const marksFile = option('--marks') ?? marksFileFor(audioFile)
	if (!scoreDir || !marksFile) {
		console.error('--recording needs --score <dir> and marks (--marks <json> or <audio>.marks.json); draft them with tools/follow-marks.mjs')
		process.exit(2)
	}
	const score = loadScore(scoreDir)
	const { truth, warnings } = marksToTruth(JSON.parse(readFileSync(marksFile, 'utf8')), score)
	warnings.forEach((w) => console.warn(`warning: ${w}`))
	const { samples, sampleRate } = loadAudio(audioFile)
	const fftSize = fftSizeFor(sampleRate)
	const frames = featureFrames(samples, sampleRate, { fftSize })
	const reference = buildFollowReference(score.notes, score.parts, {
		durationMs: score.durationMs,
		markersMs: score.markersMs,
		measureStartsMs: score.measureStartsMs,
		systemStartsMs: score.systemStartsMs,
	})
	const { metrics, replay } = followFrames(frames, reference, truth, {
		measureStartsMs: score.measureStartsMs,
		rows: score.slices,
		anchored: args.includes('--anchored'),
		windowMs: (fftSize / sampleRate) * 1000,
	})
	report(path.basename(audioFile), metrics, replay, started)
}
