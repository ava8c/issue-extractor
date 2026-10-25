import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assetAccess, validateAssetTarget } from '../electron/assets'
import { errorMessage } from '../src/shared/errors'

const github = 'https://github.servizi.allitude.it'
const privateDns = async () => [{ address: '10.24.3.19', family: 4 }]

test('corporate attachment hosts work on private VPN addresses while the GitHub token stays on its exact origin', async () => {
  const original = await validateAssetTarget(`${github}/assets/image.png`, github, [], privateDns)
  assert.equal(original.authenticated, true)
  const storage = await validateAssetTarget(
    'https://uploads.servizi.allitude.it/image.png',
    github,
    [],
    privateDns,
  )
  assert.equal(storage.allowPrivate, true)
  assert.equal(storage.authenticated, false)
  const otherPort = assetAccess(`${github}:8443/image.png`, github)
  assert.equal(otherPort.authenticated, false)
})
test('explicitly approved alternate asset hosts work without receiving the token', async () => {
  const access = await validateAssetTarget(
    'https://storage.internal.example/image.png',
    github,
    ['https://storage.internal.example'],
    privateDns,
  )
  assert.equal(access.allowPrivate, true)
  assert.equal(access.authenticated, false)
})
test('unrelated private hosts and lookalike domains are blocked with an actionable hostname', async () => {
  await assert.rejects(
    validateAssetTarget('https://allitude.it.evil.example/a.png', github, [], privateDns),
    /Host allegati/,
  )
  await assert.rejects(
    validateAssetTarget('https://evilallitude.it/a.png', github, [], privateDns),
    /non autorizzato/,
  )
  assert.equal(
    assetAccess('https://uploads.github.com/a.png', 'https://github.com').allowPrivate,
    false,
  )
})
test('loopback and metadata targets remain blocked even for an approved corporate host, including mapped IPv6', async () => {
  for (const address of [
    '127.0.0.1',
    '169.254.169.254',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    'fe80::1',
  ]) {
    await assert.rejects(
      validateAssetTarget('https://uploads.allitude.it/a.png', github, [], async () => [
        { address, family: address.includes(':') ? 6 : 4 },
      ]),
      /non autorizzato/,
      address,
    )
  }
})
test('public remote images work, HTTPS validation remains active, and renderer errors hide IPC internals', async () => {
  const access = await validateAssetTarget(
    'https://images.example.org/a.png',
    github,
    [],
    async () => [{ address: '8.8.8.8', family: 4 }],
  )
  assert.equal(access.authenticated, false)
  assert.throws(() => assetAccess('http://uploads.allitude.it/a.png', github), /HTTPS/)
  assert.throws(() => assetAccess('https://token@uploads.allitude.it/a.png', github), /credenziali/)
  assert.equal(
    errorMessage(new Error("Error invoking remote method 'asset:get': Error: Specific failure")),
    'Specific failure',
  )
})
