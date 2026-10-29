import { spawn } from 'node:child_process'
import { createServer } from 'vite'
import { developmentElectron } from './mac-runtime.mjs'
await import('./build.mjs')
const executable = await developmentElectron()
const server = await createServer()
await server.listen()
const child = spawn(executable, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' },
})
child.on('exit', async (code) => {
  await server.close()
  process.exit(code ?? 0)
})
process.on('SIGINT', () => child.kill('SIGINT'))
