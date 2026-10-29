import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GrokConfig, validateGrokSettings } from '../electron/grok-config'
import { notificationEvent } from '../electron/grok-event'
import { GrokDispatcher } from '../electron/grok'
import { GitHubClient } from '../electron/github'
import { IssueCache } from '../electron/issue-cache'
import { detail, notification, secrets } from './fixtures/email'
const base = process.env.GROK_SIMULATION_URL

test('webhook secrets are encrypted, write-only, bound to URL and removable', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-grok-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'email.json'),
    config = new GrokConfig(path, secrets)
  await config.load()
  assert.equal(config.target(), null)
  const input = {
    enabled: true,
    webhookUrl: 'https://example.com/webhook',
    webhookKey: 'private-test-key',
  }
  const saved = await config.save(input)
  assert.equal(saved.hasCredentials, true)
  assert.ok(!JSON.stringify(saved).includes('private-test-key'))
  assert.ok(!(await readFile(path, 'utf8')).includes('private-test-key'))
  assert.equal((await stat(path)).mode & 0o777, 0o600)
  const revision = config.revision()
  await config.save({ ...input, webhookKey: '' })
  assert.equal(config.revision(), revision)
  const restored = new GrokConfig(path, secrets)
  await restored.load()
  assert.equal((await restored.credentials()).authorization, 'Bearer private-test-key')
  await assert.rejects(
    config.credentials({ ...input, webhookKey: '', webhookUrl: 'https://other.example/webhook' }),
  )
  await assert.rejects(config.save({ ...input, webhookKey: '', removeCredentials: true }))
  await config.save({ ...input, enabled: false, webhookKey: '', removeCredentials: true })
  assert.equal(config.settings().hasCredentials, false)
  assert.throws(() => validateGrokSettings({ ...input, webhookUrl: 'http://example.com' }))
})
test('SMTP v1 never enables webhook or reuses its password', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'atlas-grok-migration-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'email.json')
  await writeFile(
    path,
    JSON.stringify({ version: 1, enabled: true, encryptedPassword: 'obsolete' }),
  )
  const config = new GrokConfig(path, secrets)
  await config.load()
  assert.equal(config.target(), null)
  assert.equal(config.settings().hasCredentials, false)
})
test('issue payload preserves event state and recent comments with author and assignee', () => {
  const event = notificationEvent(notification, 'Progetto', {
    ...detail,
    assignees: [{ login: 'mattia', name: 'Mattia Avanzi' }],
    comments: [
      ...detail.comments,
      { ...detail.comments[1], id: 'later', body: 'Successivo', createdAt: '2026-10-25T10:00:00Z' },
    ],
  })
  assert.equal(event.tipo, 'issue')
  assert.equal(event.azione, 'commento')
  assert.equal(event.dati.id, '42')
  assert.equal(event.dati.assegnatario, 'Mattia Avanzi')
  assert.match(event.dati.commento!, /Nuovo commento/)
  assert.ok(!event.dati.commento!.includes('Vecchio'))
  assert.ok(!event.dati.commento!.includes('Successivo'))
  const status = notificationEvent(
    { ...notification, type: 'status', fromStatus: 'In test', toStatus: 'Chiusa' },
    'Progetto',
    { ...detail, status: 'Riaperta' },
  )
  assert.equal(status.azione, 'cambio_stato')
  assert.equal(status.dati.stato, 'Chiusa')
  assert.equal(status.dati.stato_precedente, 'In test')
  assert.equal(notificationEvent({ ...notification, type: 'new-issue' }, 'P', null).azione, 'nuova')
})
test(
  'real HTTP dispatcher persists receipt, coalesces sends and never resends accepted jobs',
  { skip: !base },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'atlas-grok-dispatch-'))
    t.after(() => rm(dir, { recursive: true, force: true }))
    const config = new GrokConfig(join(dir, 'email.json'), secrets)
    await config.save({ enabled: true, webhookUrl: `${base}/webhook`, webhookKey: 'synthetic-key' })
    const cache = new IssueCache(join(dir, 'cache.json'), 'test')
    await cache.configureEmail(config.target())
    await cache.recordActivity('P1', [], 100)
    await cache.recordActivity('P1', [notification.issue], 200)
    const dispatcher = new GrokDispatcher(cache, config, async () => detail)
    t.after(() => dispatcher.stop())
    const first = dispatcher.kick()
    assert.equal(dispatcher.kick(), first)
    await first
    assert.equal(cache.emailStatus(config.revision()).sent, 1)
    await dispatcher.kick()
    assert.equal(cache.emailStatus(config.revision()).sent, 1)
    const restored = new IssueCache(join(dir, 'cache.json'), 'test')
    await restored.load()
    assert.equal(restored.deliveryHistory()[0].state, 'sent')
  },
)
test(
  'real HTTP dispatcher leaves lost receipts uncertain and retries only explicit temporary rejections',
  { skip: !base },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'atlas-grok-failure-'))
    t.after(() => rm(dir, { recursive: true, force: true }))
    for (const [path, expected] of [
      ['reject/502', 'uncertain'],
      ['reject/429', 'pending'],
      ['reject/401', 'failed'],
    ]) {
      const config = new GrokConfig(join(dir, `${expected}.json`), secrets)
      await config.save({
        enabled: true,
        webhookUrl: `${base}/${path}`,
        webhookKey: 'synthetic-key',
      })
      const cache = new IssueCache(join(dir, `${expected}-cache.json`), 'test')
      await cache.configureEmail(config.target())
      await cache.recordActivity('P1', [], 100)
      await cache.recordActivity('P1', [notification.issue], 200)
      const dispatcher = new GrokDispatcher(cache, config, async () => detail)
      await dispatcher.kick()
      assert.equal(cache.deliveryHistory()[0].state, expected)
      dispatcher.stop()
    }
  },
)

test(
  'real HTTP: GitHub content is fetched then delivered as an issue event to Grok',
  { skip: !base || !process.env.GITHUB_SIMULATION_URL },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), 'atlas-grok-e2e-'))
    t.after(() => rm(dir, { recursive: true, force: true }))
    const config = new GrokConfig(join(dir, 'email.json'), secrets)
    await config.save({ enabled: true, webhookUrl: `${base}/webhook`, webhookKey: 'synthetic-key' })
    const cache = new IssueCache(join(dir, 'cache.json'), 'test')
    await cache.configureEmail(config.target())
    await cache.recordActivity('P1', [], 100)
    await cache.recordActivity('P1', [notification.issue], 200)
    const githubBase = process.env.GITHUB_SIMULATION_URL!
    const github = new GitHubClient(
      { host: 'https://github.example', organizations: [], projectUrls: [] },
      'simulation-token',
      { graphql: `${githubBase}/api/graphql`, rest: githubBase },
    )
    const dispatcher = new GrokDispatcher(cache, config, (event) =>
      github.notificationContent(event),
    )
    t.after(() => dispatcher.stop())
    await dispatcher.kick()
    assert.equal(cache.emailStatus(config.revision()).sent, 1)
    const requests: { event: { tipo: string; dati?: { descrizione?: string } } }[] = await (
      await fetch(`${base}/requests`)
    ).json()
    assert.ok(
      requests.some(
        (request) =>
          request.event.tipo === 'issue' && request.event.dati?.descrizione === 'A description',
      ),
    )
  },
)
