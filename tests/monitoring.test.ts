import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { MonitoringConfig, monitoringUrl } from '../electron/monitoring-config'
import { MonitoringService, monitoringPayload, verifyMonitoring } from '../electron/monitoring'
import type { IssueEstimate } from '../src/shared/estimates'
import type { Project } from '../src/shared/types'
import { detail, secrets } from './fixtures/email'

const base = process.env.MONITORING_SIMULATION_URL
const tokenFor = (letter = 'a') => `iat_${letter.repeat(24)}.${'A'.repeat(43)}`
async function setup(t: TestContext, url = base ?? 'https://monitoraggio.example', letter = 'a') {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-monitoring-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const config = new MonitoringConfig(join(directory, 'config.json'), secrets)
  await config.save({ enabled: true, baseUrl: url, token: tokenFor(letter) })
  const service = new MonitoringService(join(directory, 'queue.json'), 'test-scope', config)
  t.after(() => service.stop())
  return { directory, config, service }
}
export function payloadFixture() {
  const estimate: IssueEstimate = {
    issueId: detail.id,
    projectId: randomUUID(),
    checkedAt: Date.now() - 1000,
    model: 'test',
    hoursPerDay: 8,
    state: 'ready',
    needsReview: false,
    note: '',
    entries: [
      {
        sourceId: 'description',
        min: 2,
        max: 2,
        unit: 'days',
        label: 'Sviluppo',
        excerpt: '2 giorni',
      },
      { sourceId: 'C1', min: 4, max: 4, unit: 'hours', label: 'Test', excerpt: '4 ore' },
    ],
  }
  const project = {
    id: estimate.projectId,
    title: 'Project',
    url: 'https://github.example/orgs/org/projects/1',
  } as Project
  return monitoringPayload('https://github.example', project, { issue: detail, estimate })
}

test('Monitoraggio requires HTTPS, binds encrypted keys to the complete base URL and supports removal', async (t) => {
  for (const bad of [
    'http://monitoraggio.example',
    'https://user:pass@monitoraggio.example',
    'https://monitoraggio.example?token=x',
    'https://monitoraggio.example#x',
    'file:///tmp/test',
  ])
    assert.throws(() => monitoringUrl(bad))
  assert.equal(
    monitoringUrl(' https://MONITORAGGIO.example/path/ '),
    'https://monitoraggio.example/path',
  )
  assert.equal(monitoringUrl('http://127.0.0.1:4902'), 'http://127.0.0.1:4902')
  const { directory, config } = await setup(t, 'https://monitoraggio.example')
  assert.ok(!(await readFile(join(directory, 'config.json'), 'utf8')).includes(tokenFor()))
  assert.equal((await stat(join(directory, 'config.json'))).mode & 0o777, 0o600)
  assert.ok(!JSON.stringify(config.settings()).includes(tokenFor()))
  await config.save({ enabled: true, baseUrl: 'https://monitoraggio.example' })
  assert.equal((await config.credentials()).token, tokenFor())
  const restored = new MonitoringConfig(join(directory, 'config.json'), secrets)
  await restored.load()
  assert.equal((await restored.credentials()).token, tokenFor())
  await assert.rejects(
    config.save({ enabled: true, baseUrl: 'https://other.example' }),
    /chiave API/,
  )
  await config.save({ enabled: false, baseUrl: 'https://other.example' })
  assert.equal(config.settings().hasToken, false)
  await config.save({ enabled: false, baseUrl: 'https://other.example', token: tokenFor() })
  await config.save({ enabled: false, baseUrl: 'https://other.example', removeToken: true })
  assert.equal(config.settings().hasToken, false)
})

test('payload converts mixed units and only includes estimate metadata and evidence', () => {
  const payload = payloadFixture()
  assert.equal(payload.estimate.total_hours, 20)
  assert.ok(!JSON.stringify(payload).includes('Testo **importante**'))
  assert.equal(payload.estimate.entries.length, 2)
  assert.ok(!('body' in payload.issue))
})

test('persistent outbox recovers across restart, respects account scope and skips issues with no estimate', async (t) => {
  const { directory, config, service } = await setup(t)
  const payload = payloadFixture()
  await service.sync([
    { ...payload, estimate: { ...payload.estimate, state: 'none', total_hours: 0, entries: [] } },
  ])
  assert.equal(service.status().pending, 0)
  await service.sync([payload])
  assert.equal(service.status().pending, 1)
  const loaded = new MonitoringService(join(directory, 'queue.json'), 'test-scope', config)
  await loaded.load()
  assert.equal(loaded.status().pending, 1)
  const other = new MonitoringService(join(directory, 'queue.json'), 'other-account', config)
  await other.load()
  assert.equal(other.status().pending, 0)
  assert.ok(!(await readFile(join(directory, 'queue.json'), 'utf8')).includes(tokenFor()))
})

test(
  'real HTTP client verifies auth, delivers, coalesces unchanged analyses and sends withdrawals',
  { skip: !base },
  async (t) => {
    const { service, config } = await setup(t)
    await verifyMonitoring(config, { enabled: true, baseUrl: base! })
    const payload = payloadFixture()
    await service.sync([payload])
    await Promise.all([service.flush(), service.flush()])
    assert.equal(service.status().delivered, 1)
    await service.sync([{ ...payload, checked_at: new Date().toISOString() }])
    await service.flush()
    const received = async () =>
      (
        await fetch(`${base}/__test/received/${payload.project.id}`, {
          headers: { authorization: `Bearer ${tokenFor()}` },
        })
      ).json()
    assert.equal((await received()).requests, 1)
    const removed = {
      ...payload,
      checked_at: new Date().toISOString(),
      estimate: { ...payload.estimate, state: 'none' as const, total_hours: 0, entries: [] },
    }
    await service.sync([removed])
    await service.flush()
    const record = await received()
    assert.equal(record.requests, 2)
    assert.equal(record.payload.estimate.state, 'none')
    assert.equal(service.status().delivered, 1)
  },
)

for (const [letter, expected] of [
  ['b', /Chiave API/],
  ['c', /HTTP 503/],
  ['d', /limitato/],
  ['e', /non valida/],
  ['f', /non raggiungibile/],
] as const) {
  test(
    `HTTP failure ${letter} persists a sanitized error, keeps the estimate and retries after correction`,
    { skip: !base },
    async (t) => {
      const { service, config } = await setup(t, base, letter)
      const payload = payloadFixture()
      await service.sync([payload])
      await service.flush()
      assert.equal(service.status().failed, 1)
      assert.match(service.status().lastError!, expected)
      assert.ok(!service.status().lastError!.includes(tokenFor(letter)))
      await config.save({ enabled: true, baseUrl: base!, token: tokenFor() })
      await service.retry()
      assert.equal(service.status().delivered, 1)
      assert.equal(service.status().failed, 0)
    },
  )
}

test(
  'disabled integration pauses delivery and a changed destination gets its own acknowledgements',
  { skip: !base },
  async (t) => {
    const { service, config } = await setup(t)
    const payload = payloadFixture()
    await service.sync([payload])
    await config.save({ enabled: false, baseUrl: base! })
    await service.flush()
    assert.equal(service.status().pending, 1)
    await config.save({ enabled: true, baseUrl: base! })
    await service.flush()
    assert.equal(service.status().delivered, 1)
    await config.save({ enabled: true, baseUrl: `${base}/other`, token: tokenFor() })
    await service.sync([payload])
    assert.equal(service.status().pending, 1)
    assert.equal(service.status().delivered, 0)
  },
)

test(
  'a new revision queued during an in-flight delivery remains pending',
  { skip: !base },
  async (t) => {
    const { service } = await setup(t)
    const payload = payloadFixture()
    await service.sync([payload])
    const sending = service.flush()
    const updated = {
      ...payload,
      checked_at: new Date().toISOString(),
      issue: { ...payload.issue, title: 'Changed while sending' },
    }
    await service.sync([updated])
    await sending
    assert.equal(service.status().pending, 1)
    await service.flush()
    assert.equal(service.status().delivered, 1)
  },
)

test(
  'live local Monitoraggio receives the actual client payload into staging',
  { skip: !process.env.MONITORING_LIVE_URL },
  async (t) => {
    const { service, config } = await setup(t, process.env.MONITORING_LIVE_URL)
    await config.save({
      enabled: true,
      baseUrl: process.env.MONITORING_LIVE_URL!,
      token: process.env.MONITORING_LIVE_TOKEN!,
    })
    await verifyMonitoring(config, { enabled: true, baseUrl: process.env.MONITORING_LIVE_URL! })
    await service.sync([payloadFixture()])
    await service.flush()
    assert.equal(service.status().failed, 0, service.status().lastError)
    assert.equal(service.status().delivered, 1)
  },
)
