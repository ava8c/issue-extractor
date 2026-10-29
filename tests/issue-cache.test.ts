import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IssueCache } from '../electron/issue-cache'
import { issueScope, mapConcurrent } from '../src/shared/loading'
import type { Issue } from '../src/shared/types'

const issue = {
  id: 'I1',
  status: 'Todo',
  body: 'Private description',
  updatedAt: '2026-10-23T00:00:00Z',
} as Issue

test('cache survives restart, scopes filters, preserves empty snapshots and excludes descriptions', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'atlas-cache-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const path = join(folder, 'cache.json')
  const cache = new IssueCache(path, 'connection-a')
  await cache.saveWorkspace({
    login: 'tester',
    warnings: [],
    projects: [
      {
        id: 'P1',
        title: 'Project',
        owner: 'org',
        number: 1,
        url: 'https://github.example/orgs/org/projects/1',
        description: '',
        closed: false,
      },
    ],
  })
  cache.setLayout('P1', { statusFieldName: 'Stato', statuses: [{ id: 's1', name: 'Todo' }] })
  await cache.save('P1', ['Todo', 'Done'], [issue])
  await cache.save('P1', [], [])
  const restored = new IssueCache(path, 'connection-a')
  await restored.load()
  assert.equal(restored.getWorkspace()?.workspace.projects[0].title, 'Project')
  assert.equal(restored.get('P1', ['Done', 'Todo'])?.issues[0].id, 'I1')
  assert.equal(restored.get('P1', ['Done', 'Todo'])?.layout?.statusFieldName, 'Stato')
  assert.deepEqual(restored.get('P1', [])?.issues, [])
  assert.equal(restored.get('P1'), null)
  assert.equal(restored.get('P2', ['Todo', 'Done']), null)
  assert.equal((await readFile(path, 'utf8')).includes('Private description'), false)
  assert.ok(restored.get('P1', [])!.syncedAt > 0)
  const differentConnection = new IssueCache(path, 'connection-b')
  await differentConnection.load()
  assert.equal(differentConnection.getWorkspace(), null)
  assert.equal(differentConnection.get('P1', ['Todo', 'Done']), null)
})

test('cache derives filtered views from a complete snapshot and uses newest metadata for delta comparisons', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'atlas-cache-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const cache = new IssueCache(join(folder, 'cache.json'), 'connection')
  await cache.save('P1', undefined, [issue, { ...issue, id: 'I2', status: 'Done' }])
  assert.deepEqual(
    cache.get('P1', ['Todo'])?.issues.map((issue) => issue.id),
    ['I1'],
  )
  await cache.save('P1', ['Todo'], [{ ...issue, updatedAt: '2026-10-24T00:00:00Z' }])
  assert.equal(
    cache.previous('P1').find((issue) => issue.id === 'I1')?.updatedAt,
    '2026-10-24T00:00:00Z',
  )
  assert.equal(cache.previous('P2').length, 0)
  await cache.clear()
  await cache.save('P1', undefined, [issue])
  await assert.rejects(readFile(join(folder, 'cache.json')), { code: 'ENOENT' })
})

test('offline navigation combines saved filters and activity without treating partial lists as synchronized', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'atlas-cache-offline-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const path = join(folder, 'cache.json')
  const cache = new IssueCache(path, 'connection')
  cache.setLayout('P1', { statusFieldName: 'Stato', statuses: [{ id: 's1', name: 'Todo' }] })
  await cache.save('P1', ['Todo'], [{ ...issue, labels: [{ name: 'bug', color: 'ff0000' }] }])
  await cache.save('P1', ['Done'], [{ ...issue, id: 'I2', status: 'Done' }])
  const restored = new IssueCache(path, 'connection')
  await restored.load()
  const partial = restored.available('P1')!
  assert.deepEqual(partial.issues.map((item) => item.id).sort(), ['I1', 'I2'])
  assert.equal(partial.syncedAt, 0)
  assert.equal(partial.layout?.statusFieldName, 'Stato')
  assert.deepEqual(restored.available('P1', ['Missing'])?.issues, [])
  assert.deepEqual(restored.available('P1', [])?.issues, [])
  assert.equal(restored.available('P2'), null)
  assert.equal(restored.get('P1'), null, 'Partial fallback must not change exact cache semantics')
  await restored.recordActivity('P1', [{ ...issue, status: 'Doing' }], Date.now() + 1000)
  const updated = restored.available('P1')!
  assert.equal(updated.issues.length, 1, 'A newer complete index removes obsolete issues')
  assert.equal(updated.issues[0].status, 'Doing')
  assert.equal(updated.issues[0].labels[0].name, 'bug')
  assert.equal((await readFile(path, 'utf8')).includes('Private description'), false)
})

test('corrupt caches rebuild safely and failed writes keep the fetched list available in memory', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'atlas-cache-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const path = join(folder, 'cache.json')
  await writeFile(path, '{broken')
  const cache = new IssueCache(path, 'connection')
  await cache.load()
  assert.equal(cache.get('P1'), null)
  const unwritable = new IssueCache(join(folder, 'missing', 'cache.json'), 'connection')
  await unwritable.save('P1', undefined, [issue])
  assert.equal(unwritable.get('P1')?.issues[0].id, 'I1')
})

test('cache keys are stable; work runs in order with bounded concurrency', async () => {
  assert.equal(issueScope('p', ['Done', 'Todo', 'Done']), issueScope('p', ['Todo', 'Done']))
  assert.notEqual(issueScope('p', []), issueScope('p'))
  let active = 0
  let maximum = 0
  const result = await mapConcurrent([5, 1, 4, 2, 3], 2, async (value) => {
    maximum = Math.max(maximum, ++active)
    await new Promise((resolve) => setTimeout(resolve, value))
    active--
    return value * 2
  })
  assert.deepEqual(result, [10, 2, 8, 4, 6])
  assert.equal(maximum, 2)
})

test('concurrent cache writes stay valid, evict old views and cannot restore a cleared connection', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'atlas-cache-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const path = join(folder, 'cache.json')
  const cache = new IssueCache(path, 'connection')
  await Promise.all(Array.from({ length: 35 }, (_, i) => cache.save(`P${i}`, undefined, [issue])))
  const saved = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(Object.keys(saved.snapshots).length, 30)
  assert.equal(cache.get('P0'), null)
  assert.equal(cache.get('P34')?.issues[0].id, 'I1')
  const inFlight = cache.save('late', undefined, [issue])
  await cache.clear()
  await inFlight
  await assert.rejects(readFile(path), { code: 'ENOENT' })
  await assert.rejects(readFile(`${path}.tmp`), { code: 'ENOENT' })
})

test('coalesced writes make strict preferences durable alongside concurrent list updates', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'atlas-cache-durability-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const path = join(folder, 'cache.json')
  const cache = new IssueCache(path, 'connection')
  const saves = Array.from({ length: 35 }, (_, i) => cache.save(`P${i}`, undefined, [issue]))
  await cache.setNotificationPreferences('P34', {
    excludedStatuses: ['Done'],
    includeDrafts: false,
  })
  // Read from disk as soon as the strict operation returns, before waiting for other calls.
  const restored = new IssueCache(path, 'connection')
  await restored.load()
  assert.deepEqual(restored.getNotificationPreferences('P34'), {
    enabled: true,
    excludedStatuses: ['Done'],
    includeDrafts: false,
  })
  assert.equal(restored.get('P34')?.issues[0].id, 'I1')
  await Promise.all(saves)
  await cache.save('later', undefined, [{ ...issue, id: 'later' }])
  const final = new IssueCache(path, 'connection')
  await final.load()
  assert.equal(final.get('later')?.issues[0].id, 'later')
  const unwritable = new IssueCache(join(folder, 'missing', 'cache.json'), 'connection')
  await assert.rejects(
    unwritable.setNotificationPreferences('P1', {
      excludedStatuses: [],
      includeDrafts: true,
    }),
    { code: 'ENOENT' },
  )
})
