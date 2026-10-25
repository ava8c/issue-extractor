import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EmailConfig, validateEmailSettings } from '../electron/email-config'
import { notificationEmail } from '../electron/email-message'
import { smtpFailure } from '../electron/email'
import { IssueCache } from '../electron/issue-cache'

import { image, detail, notification, smtpSettings, secrets } from './fixtures/email'

test('SMTP settings validate recipients and TLS, encrypt passwords, preserve them only for the same server identity and never return secrets', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-email-config-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'email.json')
  const config = new EmailConfig(path, secrets)
  await config.load()
  assert.equal(config.settings().enabled, false)
  const saved = await config.save(smtpSettings)
  assert.equal(saved.hasPassword, true)
  assert.ok(!JSON.stringify(saved).includes('test-password-only'))
  assert.ok(!(await readFile(path, 'utf8')).includes('test-password-only'))
  assert.equal((await stat(path)).mode & 0o777, 0o600)
  const initialRevision = config.revision()
  await config.save({ ...smtpSettings, password: undefined })
  assert.equal(config.revision(), initialRevision)
  assert.equal((await config.credentials()).password, smtpSettings.password)
  await assert.rejects(
    config.credentials({ ...smtpSettings, host: 'other.example.com', password: undefined }),
    /password SMTP/,
  )
  await assert.rejects(
    config.save({ ...smtpSettings, username: 'different', password: undefined }),
    /password SMTP/,
  )
  await config.save({ ...smtpSettings, enabled: false, password: undefined })
  assert.equal(config.target(), null)
  const restored = new EmailConfig(path, secrets)
  await restored.load()
  assert.equal(restored.settings().hasPassword, true)
  assert.equal((await restored.credentials()).password, smtpSettings.password)
  for (const bad of [
    'Alice <a@example.com>',
    'a@example.com\r\nBcc:evil@example.com',
    'a@-bad.example',
    '.a@example.com',
    'a..b@example.com',
  ])
    assert.throws(() => validateEmailSettings({ ...smtpSettings, recipients: [bad] }))
  assert.deepEqual(
    validateEmailSettings({ ...smtpSettings, recipients: ['A@example.com', 'a@example.com'] })
      .recipients,
    ['a@example.com'],
  )
  assert.throws(() => validateEmailSettings({ ...smtpSettings, security: 'none' as 'tls' }))
  assert.throws(() => validateEmailSettings({ ...smtpSettings, host: 'https://smtp.example.com' }))
})

test('notification email renders safe HTML and text, embeds image bytes and only names other files', async () => {
  const downloads: string[] = []
  const message = await notificationEmail(notification, 'Project <unsafe>', detail, async (url) => {
    downloads.push(url)
    return { bytes: image, mime: 'image/png', filename: 'screen.png' }
  })
  assert.deepEqual(downloads, ['https://github.example/image.png'])
  assert.match(message.html as string, /<strong>importante<\/strong>/)
  assert.match(message.html as string, /<strong>formattazione<\/strong>/)
  assert.match(message.html as string, /cid:[a-f0-9]+@issue-atlas.local/)
  assert.ok(!(message.html as string).includes('<script'))
  assert.ok(!(message.html as string).includes('<iframe'))
  assert.ok(!(message.html as string).includes('onerror'))
  assert.ok(!(message.html as string).includes('javascript:'))
  assert.ok(!(message.html as string).includes('file:///'))
  assert.ok(!(message.html as string).includes('Vecchio commento'))
  assert.match(message.html as string, /Project &lt;unsafe&gt;/)
  assert.match(message.text as string, /Testo importante con accenti: è già pronto/)
  assert.match(message.text as string, /File presente: Report PDF \(non allegato\)/)
  assert.match(message.text as string, /File presente: log \(non allegato\)/)
  assert.equal(message.attachments!.length, 1)
  assert.deepEqual(message.attachments![0].content, image)
  assert.equal(message.attachments![0].contentDisposition, 'inline')
  const delayed = await notificationEmail(
    notification,
    'Project',
    {
      ...detail,
      comments: [
        ...detail.comments,
        {
          ...detail.comments[1],
          id: 'later',
          body: 'Commento successivo alla notifica',
          createdAt: '2026-10-25T10:00:00Z',
        },
      ],
    },
    async () => ({ bytes: image, mime: 'image/png', filename: 'screen.png' }),
  )
  assert.ok(!(delayed.text as string).includes('Commento successivo alla notifica'))
  assert.match(delayed.text as string, /Nuovo commento/)
})

test('failed/unsupported images get placeholders and bounded messages retain a link to full content', async () => {
  const message = await notificationEmail(
    { ...notification, type: 'new-issue' },
    'Project',
    {
      ...detail,
      body: '![svg](https://github.example/a.svg)\n\n![broken](https://github.example/b.png)',
    },
    async () => ({
      bytes: Buffer.from('<svg onload="alert(1)"/>'),
      mime: 'image/svg+xml',
      filename: 'unsafe.svg',
    }),
  )
  assert.equal(message.attachments!.length, 0)
  assert.match(message.text as string, /Immagine presente/)
  assert.ok(!(message.html as string).includes('<svg'))
  const shortened = await notificationEmail(
    notification,
    'Project',
    { ...detail, body: 'x'.repeat(220_000) },
    async () => {
      throw new Error('Not expected')
    },
  )
  assert.match(shortened.text as string, /abbreviato/)
  assert.ok((shortened.text as string).length < 202_000)
  const fallback = await notificationEmail(notification, 'Project', null, async () => {
    throw new Error('Not expected')
  })
  assert.match(fallback.text as string, /contenuto completo non è disponibile/)
  assert.match(fallback.text as string, /github.example\/org\/repo\/issues\/42/)
})

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

test('SMTP rejection retries safely while uncertain acceptance never retries automatically', () => {
  assert.equal(smtpFailure({ responseCode: 451, command: 'DATA' }).state, 'pending')
  assert.equal(smtpFailure({ responseCode: 550, command: 'RCPT TO' }).state, 'failed')
  assert.equal(smtpFailure({ code: 'EAUTH' }).state, 'failed')
  assert.equal(
    smtpFailure({ code: 'ETIMEDOUT', command: 'CONN', timeoutType: 'CONNECT_TIMEOUT' }).state,
    'pending',
  )
  assert.equal(
    smtpFailure({ code: 'ESOCKET', command: 'CONN', originalCode: 'ECONNREFUSED' }).state,
    'pending',
  )
  assert.equal(smtpFailure({ code: 'ECONNECTION', command: 'CONN' }).state, 'uncertain')
  assert.equal(smtpFailure({ code: 'ETIMEDOUT', command: 'DATA' }).state, 'uncertain')
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
