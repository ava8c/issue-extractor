import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IssueCache } from '../electron/issue-cache'
import { notification } from './fixtures/email'
const smtpSettings = { recipients: ['legacy-a@example.com', 'legacy-b@example.com'] }
test('the durable email outbox only queues new events after opt-in, survives restart, and isolates changed recipients', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-email-outbox-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'cache.json')
  const cache = new IssueCache(path, 'account')
  await cache.recordActivity('P1', [notification.issue], 100)
  await cache.configureEmail({ revision: 'mail-v1', recipients: smtpSettings.recipients })
  assert.equal(cache.emailStatus('mail-v1').pending, 0)
  const changed = { ...notification.issue, status: 'Ready', commentCount: 3 }
  await cache.recordActivity('P1', [changed], 200)
  assert.equal(cache.emailStatus('mail-v1').pending, 4)
  const job = cache.nextEmail('mail-v1', 300)!
  await cache.startEmail(job.id)
  await cache.finishEmail(job.id, 'sent')
  const second = cache.nextEmail('mail-v1', 300)!
  await cache.startEmail(second.id)
  const restored = new IssueCache(path, 'account')
  await restored.load()
  await restored.configureEmail({ revision: 'mail-v1', recipients: smtpSettings.recipients })
  assert.equal(restored.emailStatus('mail-v1').sent, 1)
  assert.equal(restored.emailStatus('mail-v1').uncertain, 1)
  assert.equal(restored.emailStatus('mail-v1').pending, 2)
  await restored.recordActivity('P1', [changed], 300)
  assert.equal(restored.emailStatus('mail-v1').pending, 2)
  await restored.configureEmail({ revision: 'mail-v2', recipients: ['new@example.com'] })
  assert.equal(restored.nextEmail('mail-v1'), undefined)
  assert.equal(restored.emailStatus('mail-v2').pending, 0)
  await restored.recordActivity('P1', [{ ...changed, status: 'Done' }], 400)
  assert.equal(restored.emailStatus('mail-v2').pending, 1)
  assert.equal(restored.nextEmail('mail-v2')?.recipient, 'new@example.com')
  await restored.configureEmail(null)
  assert.equal(restored.emailStatus('mail-v2').pending, 0)
  const serialized = await readFile(path, 'utf8')
  assert.ok(!serialized.includes('Testo **importante**'))
})

test('excluded states and drafts never enter the email outbox, and saved exclusions block queued sends and retries after restart', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-email-exclusions-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'cache.json')
  const cache = new IssueCache(path, 'account')
  const target = { revision: 'mail-v1', recipients: smtpSettings.recipients }
  await cache.configureEmail(target)
  await cache.setNotificationPreferences('P1', { excludedStatuses: ['Done'], includeDrafts: false })
  await cache.recordActivity('P1', [], 100)
  await cache.recordActivity(
    'P1',
    [
      { ...notification.issue, status: 'Done' },
      { ...notification.issue, id: 'D1', kind: 'draft', status: 'Todo' },
    ],
    200,
  )
  assert.equal(cache.emailStatus(target.revision).pending, 0)
  assert.deepEqual(cache.notifications().items, [])
  await cache.recordActivity('P1', [{ ...notification.issue, status: 'Todo' }], 300)
  assert.equal(cache.emailStatus(target.revision).pending, smtpSettings.recipients.length)
  const queued = cache.nextEmail(target.revision, 300)!
  await cache.setNotificationPreferences('P1', {
    excludedStatuses: ['Done', 'Todo'],
    includeDrafts: false,
  })
  assert.equal(await cache.startEmail(queued.id), false)
  assert.equal(cache.emailStatus(target.revision).pending, 0)
  const restored = new IssueCache(path, 'account')
  await restored.load()
  await restored.configureEmail(target)
  await restored.retryEmail(target.revision, true)
  assert.equal(restored.nextEmail(target.revision), undefined)
  await restored.recordActivity(
    'P1',
    [{ ...notification.issue, status: 'Todo', commentCount: 20 }],
    400,
  )
  assert.equal(restored.emailStatus(target.revision).pending, 0)
  await restored.setNotificationPreferences('P1', { excludedStatuses: [], includeDrafts: true })
  assert.equal(restored.nextEmail(target.revision), undefined, 'cancelled sends are not replayed')
})

test('moving an issue into a muted state cancels mail still waiting for an earlier event', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-email-destination-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const cache = new IssueCache(join(directory, 'cache.json'), 'account')
  await cache.configureEmail({ revision: 'mail-v1', recipients: smtpSettings.recipients })
  await cache.setNotificationPreferences('P1', { excludedStatuses: ['Done'], includeDrafts: true })
  await cache.recordActivity('P1', [], 100)
  await cache.recordActivity('P1', [{ ...notification.issue, status: 'Todo' }], 200)
  assert.ok(cache.nextEmail('mail-v1', 200))
  await cache.recordActivity('P1', [{ ...notification.issue, status: 'Done' }], 300)
  assert.equal(cache.nextEmail('mail-v1', 300), undefined)
  assert.equal(cache.emailStatus('mail-v1').pending, 0)
})
