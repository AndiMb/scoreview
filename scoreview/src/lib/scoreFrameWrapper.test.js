// The public link page's Viewer component: a frame only for the file Viewer
// shows, none for the neighbours it mounts hidden to preload.
import { describe, expect, it, vi } from 'vitest'
import { scoreFrameWrapper } from './scoreFrameWrapper.js'

vi.mock('@nextcloud/files', () => ({ DefaultType: { DEFAULT: 'default' }, registerFileAction: vi.fn() }))

/** A component instance as Vue would hand it to the hooks, without Vue. */
function instance(props) {
	const def = scoreFrameWrapper((fileId) => ({ fileId, remove: vi.fn() }))
	const inserted = []
	const vm = {
		...props,
		frame: null,
		$el: { parentNode: { insertBefore: (node) => inserted.push(node) }, nextSibling: null },
		$emit: vi.fn(),
	}
	for (const [name, fn] of Object.entries(def.methods)) {
		vm[name] = fn.bind(vm)
	}
	return { def, vm, inserted }
}

describe('scoreFrameWrapper', () => {
	it('frames the active file and reports it loaded', () => {
		const { def, vm, inserted } = instance({ fileid: 7, active: true })
		def.mounted.call(vm)
		expect(inserted).toHaveLength(1)
		expect(inserted[0].fileId).toBe(7)
		expect(vm.$emit).toHaveBeenCalledWith('update:loaded', true)
	})

	it('mounts no frame for a hidden neighbour', () => {
		const { def, vm, inserted } = instance({ fileid: 8, active: false })
		def.mounted.call(vm)
		expect(inserted).toHaveLength(0)
	})

	it('frames a neighbour once it becomes the shown file, and drops it again', () => {
		const { def, vm, inserted } = instance({ fileid: 8, active: false })
		def.mounted.call(vm)
		vm.active = true
		def.watch.active.call(vm)
		expect(inserted).toHaveLength(1)
		const frame = vm.frame
		def.watch.active.call(vm)
		expect(inserted).toHaveLength(1)
		vm.active = false
		def.watch.active.call(vm)
		expect(frame.remove).toHaveBeenCalled()
		expect(vm.frame).toBe(null)
	})

	it('replaces the frame when the file changes', () => {
		const { def, vm, inserted } = instance({ fileid: 1, active: true })
		def.mounted.call(vm)
		const first = vm.frame
		vm.fileid = 2
		def.watch.fileid.call(vm)
		expect(first.remove).toHaveBeenCalled()
		expect(inserted.map((f) => f.fileId)).toEqual([1, 2])
	})

	it('declares the active prop Viewer passes to the shown file only', () => {
		expect(scoreFrameWrapper(() => null).props.active).toEqual({ type: Boolean, default: false })
	})
})

describe('registerScoreHandler', () => {
	it('passes a group only when asked, so Files keeps its single-file viewer', async () => {
		const registerHandler = vi.fn()
		vi.stubGlobal('OCA', { Viewer: { registerHandler } })
		const { registerScoreHandler } = await import('./scoreHandler.js')
		registerScoreHandler({ name: 'A' })
		registerScoreHandler({ name: 'B' }, { group: 'scoreview' })
		expect(registerHandler.mock.calls[0][0]).not.toHaveProperty('group')
		expect(registerHandler.mock.calls[1][0].group).toBe('scoreview')
		vi.unstubAllGlobals()
	})
})
