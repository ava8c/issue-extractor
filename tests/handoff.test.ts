import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { handoffConfig, loadHandoffConfig } from '../electron/handoff-config'
import { HandoffStore, startHandoffServer } from '../electron/handoff'
import { handoffIssue } from './fixtures/handoff'

const idFromPrompt = (prompt: string) =>
  JSON.parse(prompt.match(/handoffId=("[^"]+")/)![1]) as string
const imageBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/uioAAAAASUVORK5CYII=',
  'base64',
)

test('handoff defaults off, parses .env and respects process overrides without exposing other variables', async () => {
  assert.equal(handoffConfig({}).enabled, false)
  for (const value of ['false', '0', '1', 'yes', ''])
    assert.equal(handoffConfig({ ISSUE_ATLAS_HANDOFF_ENABLED: value }).enabled, false)
  assert.deepEqual(handoffConfig({ ISSUE_ATLAS_HANDOFF_ENABLED: ' TRUE ' }), {
    enabled: true,
    port: 47321,
  })
  for (const port of ['0', '80', '65536', '-1', 'bad', '3.14'])
    assert.throws(
      () => handoffConfig({ ISSUE_ATLAS_HANDOFF_ENABLED: 'true', ISSUE_ATLAS_MCP_PORT: port }),
      /porta/,
    )
  const root = await mkdtemp(join(tmpdir(), 'atlas-env-'))
  try {
    const path = join(root, '.env')
    assert.equal((await loadHandoffConfig(path, {})).enabled, false)
    await writeFile(
      path,
      'ISSUE_ATLAS_HANDOFF_ENABLED=true\nISSUE_ATLAS_MCP_PORT=49001\nSECRET=hidden\n',
    )
    assert.deepEqual(await loadHandoffConfig(path, {}), { enabled: true, port: 49001 })
    assert.deepEqual(await loadHandoffConfig(path, { ISSUE_ATLAS_HANDOFF_ENABLED: 'false' }), {
      enabled: false,
      port: 47321,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('real MCP client retrieves complete context, actual images/documents and explicit manual fallbacks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-mcp-'))
  const downloads: string[] = []
  const store = new HandoffStore(root, async (url) => {
    downloads.push(url)
    return url.endsWith('.png')
      ? { bytes: imageBytes, mime: 'image/png', filename: 'screen.png' }
      : { bytes: Buffer.from('%PDF-1.4\nfixture'), mime: 'application/pdf', filename: 'report.pdf' }
  })
  const server = await startHandoffServer(store, 0)
  const client = new Client({ name: 'atlas-test', version: '1.0.0' })
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url)))
    const tools = await client.listTools()
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
      'get_issue_asset',
      'get_issue_context',
    ])
    const unknown = await client.callTool({
      name: 'get_issue_context',
      arguments: { handoffId: '00000000-0000-4000-8000-000000000000' },
    })
    assert.equal(unknown.isError, true)
    assert.deepEqual(downloads, [])
    const prompt = await store.publish(handoffIssue, server.url)
    assert.ok(prompt.includes(server.url))
    assert.ok(prompt.includes('codex mcp add issue_atlas'))
    assert.ok(prompt.includes('manualAssets'))
    const handoffId = idFromPrompt(prompt)
    assert.deepEqual(downloads, [])
    const results = await Promise.all(
      [1, 2].map(() => client.callTool({ name: 'get_issue_context', arguments: { handoffId } })),
    )
    for (const result of results) assert.ok(!result.isError, JSON.stringify(result))
    assert.equal(downloads.length, 2)
    const context = results[0].structuredContent as {
      issuePath: string
      assets: { id: string; localPath: string; mime: string }[]
      manualAssets: { label: string; url: string; reason: string }[]
    }
    assert.equal(context.manualAssets.length, 1)
    assert.equal(context.manualAssets[0].url, 'https://docs.example/spec')
    assert.ok(context.manualAssets[0].reason)
    const markdown = await readFile(context.issuePath, 'utf8')
    assert.ok(markdown.includes(handoffIssue.comments[0].body))
    assert.ok(!JSON.stringify(results).includes('private-author'))
    assert.equal((await stat(context.issuePath)).mode & 0o777, 0o600)
    const image = context.assets.find((asset) => asset.mime === 'image/png')!
    const asset = await client.callTool({
      name: 'get_issue_asset',
      arguments: { handoffId, assetId: image.id },
    })
    const blocks = asset.content as { type: string; data?: string }[]
    assert.deepEqual(
      Buffer.from(blocks.find((block) => block.type === 'image')!.data!, 'base64'),
      imageBytes,
    )
    const pdf = context.assets.find((asset) => asset.mime === 'application/pdf')!
    assert.match(await readFile(pdf.localPath, 'utf8'), /^%PDF/)
    const invalid = await client.callTool({
      name: 'get_issue_asset',
      arguments: { handoffId, assetId: '../../connection.json' },
    })
    assert.equal(invalid.isError, true)
    const blockedHeaders: Record<string, string>[] = [
      { Origin: 'https://evil.example' },
      { Origin: 'null' },
      { Host: 'evil.example' },
    ]
    for (const headers of blockedHeaders) {
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(server.url, { method: 'POST', headers }, (res) => {
          res.resume()
          resolve(res.statusCode!)
        })
        req.on('error', reject)
        req.end()
      })
      assert.equal(status, 403)
    }
    assert.equal((await fetch(server.url.replace('/mcp', '/other'))).status, 404)
    await store.clear()
    assert.deepEqual(await readdir(root), [])
    const revoked = await client.callTool({ name: 'get_issue_context', arguments: { handoffId } })
    assert.equal(revoked.isError, true)
  } finally {
    await client.close()
    await server.close()
    await rm(root, { recursive: true, force: true })
  }
})

test('failed downloads are listed with their URL and reason, incomplete conversations never publish', async () => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-manual-'))
  let requested = 0
  const store = new HandoffStore(root, async () => {
    requested++
    throw new Error('HTTP 403: access denied')
  })
  try {
    await assert.rejects(
      store.publish({ ...handoffIssue, commentsComplete: false }, 'http://127.0.0.1:47321/mcp'),
      /mancano/,
    )
    assert.equal(requested, 0)
    const id = idFromPrompt(await store.publish(handoffIssue, 'http://127.0.0.1:47321/mcp'))
    const result = await store.context(id)
    const summary = result.structuredContent as { manualAssets: { reason: string }[] }
    assert.equal(summary.manualAssets.length, 3)
    assert.equal(
      summary.manualAssets.filter((asset) => asset.reason.includes('HTTP 403')).length,
      2,
    )
    const asset = await store.asset(id, 'A01')
    assert.equal(asset.isError, true)
    assert.match(JSON.stringify(asset.content), /screen.png/)
    assert.match(JSON.stringify(asset.content), /download manuale/)
  } finally {
    await store.clear()
    await rm(root, { recursive: true, force: true })
  }
})

test('expiry and connection reset revoke references, including requests already downloading', async () => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-expiry-'))
  let now = Date.now()
  let release!: () => void
  let started!: () => void
  const wait = new Promise<void>((resolve) => {
    release = resolve
  })
  const downloading = new Promise<void>((resolve) => {
    started = resolve
  })
  const store = new HandoffStore(
    root,
    async () => {
      started()
      await wait
      return { bytes: imageBytes, mime: 'image/png', filename: 'screen.png' }
    },
    () => now,
  )
  try {
    const expired = idFromPrompt(await store.publish(handoffIssue, 'http://127.0.0.1:47321/mcp'))
    now += 8 * 60 * 60_000 + 1
    await assert.rejects(store.context(expired), /scaduto/)
    await store.prune()
    const id = idFromPrompt(await store.publish(handoffIssue, 'http://127.0.0.1:47321/mcp'))
    const context = store.context(id)
    const rejected = assert.rejects(context, /scaduto/)
    await downloading
    const clearing = store.clear()
    release()
    await rejected
    await clearing
    assert.deepEqual(await readdir(root), [])
  } finally {
    release()
    await store.clear()
    await rm(root, { recursive: true, force: true })
  }
})

test('snapshots preserve copied content, evict the oldest reference and cannot publish across a reset', async () => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-snapshots-'))
  const store = new HandoffStore(root, async () => {
    throw new Error('Not accessible')
  })
  const url = 'http://127.0.0.1:47321/mcp'
  try {
    const issue = structuredClone(handoffIssue)
    const first = idFromPrompt(await store.publish(issue, url))
    issue.body = 'Contenuto modificato dopo la copia'
    const context = await store.context(first)
    assert.ok(!JSON.stringify(context).includes(issue.body))
    assert.ok(JSON.stringify(context).includes('Schermata'))
    for (let i = 0; i < 10; i++) await store.publish(handoffIssue, url)
    await assert.rejects(store.context(first), /scaduto/)
    assert.deepEqual(await readdir(root), [])
    const pending = store.publish(handoffIssue, url)
    const rejected = assert.rejects(pending, /Connessione cambiata/)
    await store.clear()
    await rejected
  } finally {
    await store.clear()
    await rm(root, { recursive: true, force: true })
  }
})

test('a stalled attachment cannot prevent context delivery or start more downloads after the budget', async () => {
  const root = await mkdtemp(join(tmpdir(), 'atlas-deadline-'))
  const requests: string[] = []
  let downloadSignal: AbortSignal | undefined
  const store = new HandoffStore(
    root,
    (url, signal) => {
      requests.push(url)
      downloadSignal = signal
      return new Promise(() => {})
    },
    Date.now,
    20,
  )
  // AbortSignal.timeout is unref'd; keep the test alive while simulating an unresponsive client.
  const keepAlive = setInterval(() => {}, 1000)
  try {
    const id = idFromPrompt(await store.publish(handoffIssue, 'http://127.0.0.1:47321/mcp'))
    const context = await store.context(id)
    const summary = context.structuredContent as { manualAssets: { reason: string }[] }
    assert.equal(requests.length, 1)
    assert.equal(downloadSignal?.aborted, true)
    assert.equal(
      summary.manualAssets.filter((asset) => asset.reason.includes('Tempo complessivo')).length,
      2,
    )
    assert.match(JSON.stringify(context.content), /Issue completa/)
  } finally {
    clearInterval(keepAlive)
    await store.clear()
    await rm(root, { recursive: true, force: true })
  }
})
