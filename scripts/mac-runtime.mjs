import { execFile } from 'node:child_process'
import { mkdir, rm, copyFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const run = promisify(execFile)
const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

async function signLocalApp(bundle) {
  await run('codesign', ['--force', '--deep', '--sign', '-', bundle])
  await run('codesign', ['--verify', '--deep', '--strict', bundle])
}

// Electron 42+ needs a complete bundle signature for macOS notifications.
// Cache a dedicated development bundle, leaving npm's runtime untouched.
export async function developmentElectron() {
  const executable = require('electron')
  if (process.platform !== 'darwin') return executable
  const version = require('electron/package.json').version
  const directory = join(root, 'node_modules/.cache/issue-atlas', `electron-${version}-v1`)
  const bundle = join(directory, 'Issue Atlas.app')
  const result = join(bundle, 'Contents/MacOS', basename(executable))
  try {
    await run('codesign', ['--verify', '--deep', '--strict', bundle])
    return result
  } catch {
    // Missing, outdated or interrupted preparation: rebuild the managed copy.
  }
  console.log('Preparazione del runtime macOS per le notifiche native…')
  await mkdir(directory, { recursive: true })
  await rm(bundle, { recursive: true, force: true })
  await run('ditto', [resolve(dirname(executable), '../..'), bundle])
  const plist = join(bundle, 'Contents/Info.plist')
  await run('plutil', [
    '-replace',
    'CFBundleIdentifier',
    '-string',
    'it.issueatlas.desktop.dev',
    plist,
  ])
  await run('plutil', ['-replace', 'CFBundleName', '-string', 'Issue Atlas', plist])
  await run('plutil', ['-replace', 'CFBundleDisplayName', '-string', 'Issue Atlas (dev)', plist])
  await copyFile(join(root, 'build/icon.icns'), join(bundle, 'Contents/Resources/electron.icns'))
  await signLocalApp(bundle)
  return result
}

// Run before electron-builder's normal signing. A configured Developer ID can
// still replace this local signature; builds without a certificate also work locally.
export default async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  await signLocalApp(join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`))
}
