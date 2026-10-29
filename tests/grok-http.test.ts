import { test } from 'node:test'
import assert from 'node:assert/strict'
import { postWebhook, webhookUrl, authorizationValue, WebhookError } from '../electron/grok-http'
const base = process.env.GROK_SIMULATION_URL
const payload = { tipo: 'nota', sorgente: 'test', contenuto: 'prova webhook' }
test(
  'real HTTP: JSON, Authorization and stable delivery ID reach the routine',
  { skip: !base },
  async () => {
    await postWebhook(`${base}/webhook`, 'Bearer synthetic-key', payload, {
      eventId: 'stable-test-event',
    })
    const requests = await (await fetch(`${base}/requests`)).json()
    assert.ok(
      requests.some(
        (item: { eventId: string; event: typeof payload }) =>
          item.eventId === 'stable-test-event' && item.event.contenuto === payload.contenuto,
      ),
    )
  },
)
test(
  'real HTTP: rejections and redirects are sanitized and never count as delivered',
  { skip: !base },
  async () => {
    for (const status of [401, 403, 429, 500])
      await assert.rejects(
        postWebhook(`${base}/reject/${status}`, 'Bearer synthetic-key', payload),
        (error) =>
          error instanceof WebhookError &&
          error.status === status &&
          error.outcome === (status >= 500 ? 'uncertain' : 'error') &&
          !error.message.includes('synthetic-key'),
      )
    await assert.rejects(
      postWebhook(`${base}/redirect`, 'Bearer synthetic-key', payload),
      (error) => error instanceof WebhookError && error.status === 302,
    )
    await assert.rejects(
      postWebhook(`${base}/webhook`, 'Bearer wrong-key', payload),
      (error) => error instanceof WebhookError && error.status === 401,
    )
  },
)
test(
  'real HTTP: a timeout or lost response is uncertain; aborted jobs never start',
  { skip: !base },
  async () => {
    for (const path of ['timeout'])
      await assert.rejects(
        postWebhook(`${base}/${path}`, 'Bearer synthetic-key', payload, { timeoutMs: 60 }),
        (error) => error instanceof WebhookError && error.outcome === 'uncertain',
      )
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      postWebhook(`${base}/webhook`, 'Bearer synthetic-key', payload, {
        signal: controller.signal,
      }),
      (error) => error instanceof WebhookError && error.outcome === 'error',
    )
  },
)
test('credentials accept the copied header or key, validate URLs and reject header injection', () => {
  assert.equal(authorizationValue('test-key'), 'Bearer test-key')
  assert.equal(authorizationValue('', 'Authorization: Bearer test-key'), 'Bearer test-key')
  for (const value of [
    'http://example.com/hook',
    'https://user:pass@example.com/hook',
    'https://example.com/hook#secret',
    'https://example.com/hook?key=secret',
  ])
    assert.throws(() => webhookUrl(value))
  assert.throws(() => authorizationValue('key\r\nX-Header: malicious'))
  assert.throws(() => authorizationValue('key', 'Bearer different'))
})
