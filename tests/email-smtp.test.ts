import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SMTPServer, type SMTPServerOptions } from 'smtp-server'
import { simpleParser } from 'mailparser'
import { EmailConfig } from '../electron/email-config'
import { EmailDispatcher, smtpTransport, verifySmtp, sendTestEmail } from '../electron/email'
import { IssueCache } from '../electron/issue-cache'
import { GitHubClient } from '../electron/github'
import type { EmailSettingsInput } from '../src/shared/email'
import { detail, image, notification, secrets, smtpSettings } from './fixtures/email'

const enabled = !!(process.env.SMTP_INTEGRATION || process.env.GITHUB_SIMULATION_URL)

async function fixture(t: TestContext, options: SMTPServerOptions = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'atlas-local-smtp-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
      '-addext',
      'subjectAltName=DNS:localhost,IP:127.0.0.1',
      '-keyout',
      join(folder, 'key.pem'),
      '-out',
      join(folder, 'cert.pem'),
    ],
    { stdio: 'ignore' },
  )
  const cert = await readFile(join(folder, 'cert.pem'), 'utf8')
  const messages: { recipient: string; bytes: Buffer }[] = []
  const envelopes: string[] = []
  const server = new SMTPServer({
    secure: true,
    key: await readFile(join(folder, 'key.pem')),
    cert,
    logger: false,
    closeTimeout: 100,
    onAuth(auth, _session, callback) {
      callback(
        auth.username === smtpSettings.username && auth.password === smtpSettings.password
          ? null
          : Object.assign(new Error('Invalid test credentials'), { responseCode: 535 }),
        { user: 'test' },
      )
    },
    onRcptTo(address, _session, callback) {
      envelopes.push(address.address)
      callback()
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = []
      stream.on('data', (chunk: Buffer) => chunks.push(chunk))
      stream.on('end', () => {
        assert.equal(session.secure, true, 'No message may cross an unencrypted connection')
        messages.push({
          recipient: session.envelope.rcptTo[0].address,
          bytes: Buffer.concat(chunks),
        })
        callback()
      })
    },
    ...options,
  })
  // A client rejecting the intentionally self-signed certificate is an expected test case.
  server.on('error', () => {})
  await new Promise<void>((resolve, reject) => {
    server.server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise<void>((resolve) => server.close(resolve)))
  const port = (server.server.address() as { port: number }).port
  const settings: EmailSettingsInput = {
    ...smtpSettings,
    host: '127.0.0.1',
    port,
    security: options.secure === false ? 'starttls' : 'tls',
  }
  const config = new EmailConfig(join(folder, 'email.json'), secrets)
  await config.save(settings)
  const store = new IssueCache(join(folder, 'cache.json'), 'synthetic-test-account')
  await store.configureEmail(config.target())
  await store.recordActivity('P1', [notification.issue])
  const factory = (value: EmailSettingsInput, password: string) =>
    smtpTransport(value, password, cert)
  return { folder, settings, config, store, messages, envelopes, factory, server }
}

test(
  'real SMTP: excluded states and drafts send nothing, including an exclusion saved while content is being prepared',
  { skip: !enabled, timeout: 20_000 },
  async (t) => {
    const f = await fixture(t)
    await f.store.setNotificationPreferences('P1', {
      excludedStatuses: ['Done'],
      includeDrafts: false,
    })
    const draft = { ...notification.issue, id: 'D1', kind: 'draft' as const, status: 'Ready' }
    const changed = { ...notification.issue, commentCount: notification.issue.commentCount + 1 }
    await f.store.recordActivity('P1', [changed, draft])
    let prepared = 0
    const dispatcher = new EmailDispatcher(
      f.store,
      f.config,
      async () => {
        prepared++
        await f.store.setNotificationPreferences('P1', {
          excludedStatuses: ['Done', 'Ready'],
          includeDrafts: false,
        })
        return { ...detail, body: '', comments: [] }
      },
      async () => {
        throw new Error('No images')
      },
      f.factory,
    )
    t.after(() => dispatcher.stop())
    await dispatcher.kick()
    assert.equal(prepared, 0)
    assert.equal(f.messages.length, 0)
    await f.store.recordActivity('P1', [{ ...changed, status: 'Ready' }, draft])
    assert.equal(f.store.emailStatus(f.config.revision()).pending, f.settings.recipients.length)
    await dispatcher.kick()
    assert.equal(prepared, 1)
    assert.equal(f.messages.length, 0)
    assert.equal(f.store.emailStatus(f.config.revision()).pending, 0)
  },
)

test(
  'real SMTP: a lost DATA acknowledgement remains uncertain and is never retried automatically',
  { skip: !enabled, timeout: 20_000 },
  async (t) => {
    let received = 0
    const f = await fixture(t, {
      onData(stream) {
        stream.resume()
        stream.on('end', () => {
          received++
          for (const connection of f.server.connections) connection.close()
        })
      },
    })
    await f.store.recordActivity('P1', [{ ...notification.issue, status: 'Ready' }])
    const dispatcher = new EmailDispatcher(
      f.store,
      f.config,
      async () => ({ ...detail, body: '', comments: [] }),
      async () => {
        throw new Error('No images')
      },
      f.factory,
    )
    t.after(() => dispatcher.stop())
    await dispatcher.kick()
    assert.equal(received, 2)
    assert.equal(f.store.emailStatus(f.config.revision()).uncertain, 2)
    await dispatcher.kick()
    assert.equal(received, 2)
    const restored = new IssueCache(join(f.folder, 'cache.json'), 'synthetic-test-account')
    await restored.load()
    await restored.configureEmail(f.config.target())
    assert.equal(restored.nextEmail(f.config.revision()), undefined)
    assert.equal(restored.emailStatus(f.config.revision()).uncertain, 2)
  },
)

test(
  'real SMTP: an unavailable outbox file prevents sending before the durable attempt is recorded',
  { skip: !enabled, timeout: 20_000 },
  async (t) => {
    const f = await fixture(t)
    await f.store.recordActivity('P1', [{ ...notification.issue, status: 'Ready' }])
    await mkdir(join(f.folder, 'cache.json.tmp'))
    const dispatcher = new EmailDispatcher(
      f.store,
      f.config,
      async () => ({ ...detail, body: '', comments: [] }),
      async () => {
        throw new Error('No images')
      },
      f.factory,
    )
    t.after(() => dispatcher.stop())
    await dispatcher.kick()
    assert.equal(f.messages.length, 0)
    assert.equal(f.envelopes.length, 0)
    assert.match(f.store.emailStatus(f.config.revision()).lastError!, /disponibilità del disco/)
  },
)

test(
  'real SMTP with verified TLS: MIME images/text, individual recipients, test message and no resends after restart',
  { skip: !enabled, timeout: 20_000 },
  async (t) => {
    const f = await fixture(t)
    await verifySmtp(f.config, f.settings, f.factory)
    assert.equal(f.messages.length, 0, 'Connection verification sends no message')
    assert.equal(await sendTestEmail(f.config, f.settings, f.factory), 2)
    assert.equal(f.messages.length, 2)
    assert.ok(!f.messages[0].bytes.toString().includes('Saldo'))
    f.messages.length = 0
    await f.store.recordActivity('P1', [{ ...notification.issue, commentCount: 3 }])
    let fetches = 0
    const content = {
      ...detail,
      commentCount: 3,
      comments: [
        ...detail.comments,
        {
          id: 'third',
          body: 'Nuovo commento **SMTP**',
          createdAt: '2026-10-24T10:01:00Z',
          updatedAt: '2026-10-24T10:01:00Z',
        },
      ],
    }
    const dispatcher = new EmailDispatcher(
      f.store,
      f.config,
      async () => {
        fetches++
        return content
      },
      async () => ({ bytes: image, mime: 'image/png', filename: 'screen.png' }),
      f.factory,
    )
    t.after(() => dispatcher.stop())
    await Promise.all([dispatcher.kick(), dispatcher.kick()])
    assert.equal(f.messages.length, 2)
    assert.equal(fetches, 1, 'Content is shared across recipients of the same event')
    assert.equal(f.store.emailStatus(f.config.revision()).sent, 2)
    for (const delivered of f.messages) {
      const parsed = await simpleParser(delivered.bytes, { skipImageLinks: true })
      assert.ok(parsed.to && !Array.isArray(parsed.to))
      assert.deepEqual(
        parsed.to.value.map((address) => address.address),
        [delivered.recipient],
      )
      assert.match(parsed.subject!, /Nuovi commenti/)
      assert.match(parsed.html as string, /<strong>SMTP<\/strong>/)
      assert.match(parsed.html as string, /cid:/)
      assert.match(parsed.text!, /File presente: Report PDF \(non allegato\)/)
      assert.equal(parsed.attachments.length, 1, 'Only the inline image is attached')
      assert.deepEqual(parsed.attachments[0].content, image)
      assert.equal(parsed.attachments[0].contentDisposition, 'inline')
    }
    await dispatcher.kick()
    const restored = new IssueCache(join(f.folder, 'cache.json'), 'synthetic-test-account')
    await restored.load()
    await restored.configureEmail(f.config.target())
    const resumed = new EmailDispatcher(
      restored,
      f.config,
      async () => detail,
      async () => {
        throw new Error('No download expected')
      },
      f.factory,
    )
    t.after(() => resumed.stop())
    await resumed.kick()
    assert.equal(f.messages.length, 2, 'Accepted messages survive restart without resending')
  },
)

test(
  'real SMTP: temporary recipient rejection retries only that recipient; invalid credentials fail without exposing them',
  { skip: !enabled, timeout: 20_000 },
  async (t) => {
    let rejectOnce = true
    const f = await fixture(t, {
      onRcptTo(address, _session, callback) {
        if (address.address === 'second@example.com' && rejectOnce) {
          rejectOnce = false
          callback(Object.assign(new Error('Synthetic temporary rejection'), { responseCode: 451 }))
        } else callback()
      },
    })
    await f.store.recordActivity('P1', [{ ...notification.issue, status: 'Ready' }])
    const dispatcher = new EmailDispatcher(
      f.store,
      f.config,
      async () => ({ ...detail, body: '', comments: [] }),
      async () => {
        throw new Error('No images')
      },
      f.factory,
    )
    t.after(() => dispatcher.stop())
    await dispatcher.kick()
    assert.deepEqual(
      f.messages.map((mail) => mail.recipient),
      ['first@example.com'],
    )
    assert.equal(f.store.emailStatus(f.config.revision()).pending, 1)
    await dispatcher.kick()
    assert.equal(f.messages.length, 1, 'Backoff prevents immediate retry')
    const pending = f.store.nextEmail(f.config.revision(), Date.now() + 60 * 60_000)!
    await f.store.finishEmail(pending.id, 'pending', undefined, 0)
    await dispatcher.kick()
    assert.deepEqual(
      f.messages.map((mail) => mail.recipient),
      ['first@example.com', 'second@example.com'],
    )
    await assert.rejects(
      verifySmtp(f.config, { ...f.settings, password: 'wrong-test-password' }, f.factory),
      /Autenticazione SMTP/,
    )
    assert.equal(f.messages.length, 2)
  },
)

test(
  'real SMTP: certificate verification and required STARTTLS prevent insecure delivery',
  { skip: !enabled, timeout: 20_000 },
  async (t) => {
    const tls = await fixture(t)
    await assert.rejects(verifySmtp(tls.config, tls.settings), /TLS SMTP/)
    assert.equal(tls.messages.length, 0)
    const starttls = await fixture(t, { secure: false })
    await verifySmtp(starttls.config, starttls.settings, starttls.factory)
    assert.equal(await sendTestEmail(starttls.config, starttls.settings, starttls.factory), 2)
    const insecure = await fixture(t, {
      secure: false,
      hideSTARTTLS: true,
      disabledCommands: ['STARTTLS'],
    })
    await assert.rejects(sendTestEmail(insecure.config, insecure.settings, insecure.factory))
    assert.equal(insecure.messages.length, 0)
  },
)

test(
  'real GitHub HTTP and SMTP: a new event fetches content through Postman and delivers over TLS',
  { skip: !process.env.GITHUB_SIMULATION_URL, timeout: 20_000 },
  async (t) => {
    const f = await fixture(t)
    const base = process.env.GITHUB_SIMULATION_URL!
    const github = new GitHubClient(
      { host: 'https://github.example', organizations: [], projectUrls: [] },
      'simulation-token',
      { graphql: `${base}/api/graphql`, rest: `${base}/api/v3` },
    )
    await f.store.recordActivity('P1', [{ ...notification.issue, status: 'Ready' }])
    const dispatcher = new EmailDispatcher(
      f.store,
      f.config,
      (event) => github.notificationContent(event),
      async () => {
        throw new Error('No images in this simulation')
      },
      f.factory,
    )
    t.after(() => dispatcher.stop())
    await dispatcher.kick()
    assert.equal(f.messages.length, 2)
    const delivered = await simpleParser(f.messages[0].bytes)
    assert.match(delivered.text!, /A description/)
    assert.ok(!delivered.text!.includes('contenuto completo non è disponibile'))
  },
)
