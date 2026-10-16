/**
 * A small cache that forgets the least recently used entry first. For values
 * that are expensive to build and safe to share - the sanitized page SVG in
 * ScorePage.vue: in the system band, several frames show the same page, and
 * every frame that scrolls back into view would fetch and sanitize it again.
 *
 * @param {number} max entries kept
 * @return {{get: (key: string) => (object|undefined), set: (key: string, value: object) => void, clear: () => void}}
 */
export function createLru(max) {
	const map = new Map()
	return {
		get(key) {
			if (!map.has(key)) {
				return undefined
			}
			// Re-insert: a Map iterates in insertion order, so the oldest
			// entry is always the first one.
			const value = map.get(key)
			map.delete(key)
			map.set(key, value)
			return value
		},
		set(key, value) {
			map.delete(key)
			map.set(key, value)
			while (map.size > max) {
				map.delete(map.keys().next().value)
			}
		},
		clear() {
			map.clear()
		},
	}
}
