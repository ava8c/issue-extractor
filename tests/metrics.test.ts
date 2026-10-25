import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  aggregateMetrics,
  metricSnapshot,
  readMetricMapping,
  summarizeMetrics,
} from '../src/shared/metrics'
import { readPreferences } from '../src/shared/preferences'
import { IssueCache } from '../electron/issue-cache'
import type { Issue } from '../src/shared/types'

const issues = [
  { id: '1', status: 'Analisi', state: 'OPEN', kind: 'issue' },
  { id: '2', status: 'Sviluppo', state: 'OPEN', kind: 'issue' },
  { id: '3', status: 'Review', state: 'OPEN', kind: 'pull-request' },
  { id: '4', status: 'Finito', state: 'CLOSED', kind: 'issue' },
  { id: '5', status: 'Senza stato', state: 'DRAFT', kind: 'draft' },
] as Issue[]

test('metrics map multiple exact project statuses, include closed items and drafts, and distinguish unconfigured from zero', () => {
  const snapshot = metricSnapshot('P1', [...issues, issues[1]], 100)
  const summary = summarizeMetrics(snapshot, {
    'waiting-allitude': ['Senza stato'],
    'to-estimate': ['Analisi', 'Stato vuoto'],
    backlog: ['Analisi', 'Stato stimato vuoto'],
    'in-progress': ['Sviluppo', 'Review', 'Review'],
    'to-release': ['Pronto per rilascio'],
    completed: ['Finito'],
  })
  assert.equal(summary.total, 5)
  assert.equal(summary.open, 4)
  assert.equal(summary.unmapped, 0)
  assert.deepEqual(summary.values, {
    'waiting-allitude': 1,
    'to-estimate': 1,
    backlog: 1,
    'in-progress': 2,
    'to-release': 0,
    released: null,
    completed: 1,
  })
  const incomplete = summarizeMetrics(snapshot, { 'in-progress': ['Sviluppo'], released: [] })
  assert.equal(incomplete.unmapped, 4)
  assert.equal(incomplete.values.released, null)
  assert.equal(incomplete.values.backlog, null)
})

test('the dashboard aggregates common metrics across different mappings, retaining project memberships and overlaps', () => {
  const first = summarizeMetrics(metricSnapshot('P1', issues, 100), {
    backlog: ['Analisi'],
    'in-progress': ['Sviluppo', 'Review'],
    'to-release': ['Review'],
  })
  const second = summarizeMetrics(metricSnapshot('P2', [{ ...issues[1], status: 'Doing' }], 110), {
    backlog: ['Doing'],
    'in-progress': ['Doing'],
    completed: ['Done'],
  })
  const aggregate = aggregateMetrics([first, second])
  assert.equal(aggregate.total, 6, 'same issue in two projects counts in each project')
  assert.equal(aggregate.values['in-progress'], 3)
  assert.equal(aggregate.values.backlog, 2)
  assert.equal(aggregate.values['to-release'], 1)
  assert.equal(aggregate.values.completed, 0)
  assert.equal(aggregate.values.released, null)
  assert.equal(aggregate.unmapped, 2)
  assert.equal(aggregateMetrics([]).values['in-progress'], null)
})

test('metric preferences survive reload separately per project and validate malformed settings without guessing mappings', () => {
  const prefs = readPreferences(
    JSON.stringify({
      projects: {
        a: {
          metricMapping: {
            backlog: ['Pronto', null, 'Stimata', 'Pronto'],
            'in-progress': ['Sviluppo', null, 12, 'Review', 'Sviluppo', ''],
            completed: [],
            injected: ['Finito'],
          },
          statusFilter: [],
        },
        b: { metricMapping: { 'in-progress': ['Doing'] }, statusFilter: ['Done'] },
        legacy: {},
      },
    }),
  )
  const restored = readPreferences(JSON.stringify(prefs))
  assert.deepEqual(restored.projects.a.metricMapping, {
    backlog: ['Pronto', 'Stimata'],
    'in-progress': ['Sviluppo', 'Review'],
    completed: [],
  })
  assert.deepEqual(restored.projects.b.metricMapping, { 'in-progress': ['Doing'] })
  assert.deepEqual(restored.projects.legacy.metricMapping, {})
  assert.deepEqual(restored.projects.a.statusFilter, [])
  for (const value of [null, 12, 'Sviluppo', [], { 'in-progress': 'Doing' }])
    assert.deepEqual(readMetricMapping(value), {})
})

test('metrics use complete snapshots, survive restart, keep empty states and isolate connections', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'atlas-metrics-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const filename = join(folder, 'cache.json')
  const cache = new IssueCache(filename, 'account')
  cache.setLayout('P1', {
    statusFieldName: 'Stato',
    statuses: [{ id: 'empty', name: 'Stato vuoto' }],
  })
  await cache.save('P1', ['Sviluppo'], [issues[1]])
  cache.setLayout('P1', {
    statusFieldName: 'Stato',
    statuses: [{ id: 'new-empty', name: 'Stato appena aggiunto' }],
  })
  assert.equal(
    cache.projectMetrics(['P1'])[0].syncedAt,
    null,
    'filtered lists cannot establish totals',
  )
  await cache.recordActivity('P1', issues, 100)
  await cache.recordActivity('empty-project', [], 100)
  const restored = new IssueCache(filename, 'account')
  await restored.load()
  const [snapshot, empty, missing] = restored.projectMetrics([
    'P1',
    'empty-project',
    'missing',
    'P1',
  ])
  assert.equal(summarizeMetrics(snapshot, {}).total, 5)
  assert.ok(snapshot.statuses.some((status) => status.name === 'Stato appena aggiunto'))
  assert.equal(empty.syncedAt, 100)
  assert.equal(summarizeMetrics(empty, { completed: ['Finito'] }).values.completed, 0)
  assert.equal(missing.syncedAt, null)
  assert.equal(restored.projectMetrics(['P1', 'P1']).length, 1)
  const other = new IssueCache(filename, 'other-account')
  await other.load()
  assert.equal(other.projectMetrics(['P1'])[0].syncedAt, null)
  await restored.recordActivity('P1', [issues[0]], 200)
  assert.equal(
    summarizeMetrics(restored.projectMetrics(['P1'])[0], {}).total,
    1,
    'removals update counts',
  )
  await restored.save('P1', undefined, issues)
  assert.equal(
    restored.projectMetrics(['P1'])[0].syncedAt,
    restored.get('P1')!.syncedAt,
    'newer complete list wins over older activity',
  )
  assert.equal(summarizeMetrics(restored.projectMetrics(['P1'])[0], {}).total, 5)
  await restored.clear()
  assert.equal(restored.projectMetrics(['P1'])[0].syncedAt, null)
})
