// Tries everything a converter run must not do and reports, per attempt,
// whether the runtime refused it. Started by tests/Sandbox/SandboxTest.php
// with exactly the grants LocalConverter gives convert.mjs (S11).
//
// Usage: sandbox-probe.mjs <granted-write-dir> <forbidden-file> <forbidden-dir> <port>
//
// "denied" means the permission model said no. Any other failure is
// reported as "error:<code>" so that a missing network or a typo cannot pass
// for a working sandbox.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [grantedDir, forbiddenFile, forbiddenDir, port] = process.argv.slice(2)

function verdict(error) {
	const code = error?.code ?? error?.cause?.code ?? error?.name
	return code === 'ERR_ACCESS_DENIED' || code === 'NotCapable' ? 'denied' : `error:${code}`
}

async function attempt(action) {
	try {
		await action()
		return 'allowed'
	} catch (error) {
		return verdict(error)
	}
}

const result = {
	readGranted: await attempt(() => readFileSync(fileURLToPath(import.meta.url))),
	writeGranted: await attempt(() => writeFileSync(join(grantedDir, 'probe.txt'), 'x')),
	readOutside: await attempt(() => readFileSync(forbiddenFile)),
	writeOutside: await attempt(() => writeFileSync(join(forbiddenDir, 'escape.txt'), 'x')),
	childProcess: await attempt(async () => (await import('node:child_process')).execFileSync(process.execPath, ['--version'])),
	network: await attempt(async () => {
		const net = await import('node:net')
		await new Promise((resolve, reject) => {
			const socket = net.connect(Number(port), '127.0.0.1')
			socket.on('connect', () => {
				socket.destroy()
				resolve()
			})
			socket.on('error', reject)
		})
	}),
}

process.stdout.write(JSON.stringify(result) + '\n')
process.exit(0)
