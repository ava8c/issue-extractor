import { app } from 'electron'
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { nativeAssetFetch } from '../../electron/network'

const profile = process.env.ATLAS_NETWORK_TEST_PROFILE!
mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)
app
  .whenReady()
  .then(async () => {
    const base = process.env.GITHUB_SIMULATION_URL ?? 'http://127.0.0.1:4900/github'
    const first = await nativeAssetFetch(`${base}/asset-start`, {
      headers: { Authorization: 'Bearer simulation-token' },
      redirect: 'manual',
      signal: AbortSignal.timeout(5000),
    })
    assert.equal(
      first.status,
      302,
      'Expose the redirect rather than rejecting it or following it automatically',
    )
    const location = new URL(first.headers.get('location')!, base)
    const image = await nativeAssetFetch(location, { signal: AbortSignal.timeout(5000) })
    assert.equal(image.status, 200)
    assert.equal(image.headers.get('content-type'), 'image/png')
    assert.equal(
      image.headers.get('x-received-authorization'),
      'no',
      'A new host must not inherit the GitHub token',
    )
    assert.deepEqual([...new Uint8Array(await image.arrayBuffer()).slice(0, 4)], [137, 80, 78, 71])
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      nativeAssetFetch(`${base}/asset-image`, { signal: controller.signal }),
      /interrotto/,
    )
    console.log(
      'PASS: Electron native redirects, image bytes, token isolation over real HTTP, and cancellation.',
    )
    app.exit(0)
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
