import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const directory = await mkdtemp(join(tmpdir(), 'issue-atlas-network-'))
const outfile = join(directory, 'smoke.cjs')
await build({
  entryPoints: ['tests/electron/network.smoke.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
})
const child = spawn('node_modules/.bin/electron', [outfile], {
  stdio: 'inherit',
  env: { ...process.env, ATLAS_NETWORK_TEST_PROFILE: join(directory, 'profile') },
})
const code = await new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1)))
await rm(directory, { force: true, recursive: true })
process.exit(code)
