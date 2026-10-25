import { build } from 'esbuild'
await build({
  entryPoints: ['electron/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: 'dist-electron/main.js',
  external: ['electron', 'nodemailer', '@modelcontextprotocol/sdk', 'zod'],
  sourcemap: true,
})
await build({
  entryPoints: ['electron/preload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: 'dist-electron/preload.cjs',
  external: ['electron'],
})
