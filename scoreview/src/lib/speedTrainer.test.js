import { describe, expect, it } from 'vitest'
import { createSpeedTrainer, MAX_STEP_BPM } from './speedTrainer.js'

/**
 * Das Tempo jedes Durchlaufs, wie es der Nutzer hoert: der erste mit dem
 * Starttempo, jeder weitere nach einem Rueckspung.
 *
 * @param {object} trainer
 * @param {number} n
 */
function durchlaeufe(trainer, n) {
	const tempi = [trainer.current()]
	for (let i = 1; i < n; i++) {
		tempi.push(trainer.onLoopWrap())
	}
	return tempi
}

describe('speedTrainer', () => {
	it('60 → 80 in Schritten von 5 = fuenf Durchlaeufe, danach 80 konstant', () => {
		const trainer = createSpeedTrainer({ startBpm: 60, targetBpm: 80, stepBpm: 5 })
		expect(durchlaeufe(trainer, 8)).toEqual([60, 65, 70, 75, 80, 80, 80, 80])
		expect(trainer.finished()).toBe(true)
		expect(trainer.passes()).toBe(8)
	})

	it('schiesst nicht ueber das Ziel hinaus, wenn der Schritt nicht aufgeht', () => {
		const trainer = createSpeedTrainer({ startBpm: 60, targetBpm: 72, stepBpm: 5 })
		expect(durchlaeufe(trainer, 5)).toEqual([60, 65, 70, 72, 72])
	})

	it('kann auch langsamer werden', () => {
		const trainer = createSpeedTrainer({ startBpm: 100, targetBpm: 90, stepBpm: 4 })
		expect(durchlaeufe(trainer, 5)).toEqual([100, 96, 92, 90, 90])
	})

	it('ist sofort fertig, wenn Start und Ziel gleich sind', () => {
		const trainer = createSpeedTrainer({ startBpm: 80, targetBpm: 80, stepBpm: 5 })
		expect(trainer.finished()).toBe(true)
		expect(trainer.onLoopWrap()).toBe(80)
	})

	it('begrenzt den Schritt auf einen sinnvollen Bereich', () => {
		expect(durchlaeufe(createSpeedTrainer({ startBpm: 60, targetBpm: 63, stepBpm: 0 }), 4)).toEqual([60, 61, 62, 63])
		expect(durchlaeufe(createSpeedTrainer({ startBpm: 40, targetBpm: 200, stepBpm: 500 }), 2)).toEqual([40, 40 + MAX_STEP_BPM])
		expect(durchlaeufe(createSpeedTrainer({ startBpm: 60, targetBpm: 70, stepBpm: -5 }), 3)).toEqual([60, 65, 70])
	})
})
