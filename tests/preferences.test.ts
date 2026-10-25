import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  defaultPreferences,
  matchesStatusFilter,
  matchesIssueFilter,
  moveBefore,
  moveBy,
  orderProjects,
  orderStatuses,
  readPreferences,
  sortIssues,
} from '../src/shared/preferences'
import type { Issue, Project, ProjectStatus } from '../src/shared/types'

const projects = [
  { id: 'a', title: 'A' },
  { id: 'b', title: 'B' },
  { id: 'c', title: 'C' },
] as Project[]
const statuses = ['Todo', 'In progress', 'Done'].map((name) => ({
  id: name,
  name,
})) as ProjectStatus[]
const issues = [
  { id: '1', status: 'Done', updatedAt: '2026-10-23', createdAt: '2026-10-21', title: 'C' },
  { id: '2', status: 'Todo', updatedAt: '2026-10-22', createdAt: '2026-10-22', title: 'B' },
  { id: '3', status: 'In progress', updatedAt: '2026-10-21', createdAt: '2026-10-23', title: 'A' },
] as Issue[]
test('project order supports drag and keyboard moves, preserves newly discovered projects and ignores stale IDs', () => {
  assert.deepEqual(moveBefore(['a', 'b', 'c'], 'c', 'a'), ['c', 'a', 'b'])
  assert.deepEqual(moveBy(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c'])
  assert.deepEqual(
    orderProjects(projects, ['deleted', 'c', 'a']).map((p) => p.id),
    ['c', 'a', 'b'],
  )
  assert.deepEqual(moveBefore(['a', 'b'], 'unknown', 'b'), ['a', 'b'])
})
test('GitHub status options define list and Kanban order, including empty columns; local overrides preserve new states', () => {
  const ordered = orderStatuses([...statuses, { id: 'empty', name: 'In review' }], issues)
  assert.deepEqual(
    ordered.map((s) => s.name),
    ['Todo', 'In progress', 'Done', 'In review'],
  )
  assert.deepEqual(
    sortIssues(issues, 'status', ordered).map((i) => i.id),
    ['2', '3', '1'],
  )
  const custom = orderStatuses(ordered, issues, ['Done', 'Todo', 'removed'])
  assert.deepEqual(
    custom.map((s) => s.name),
    ['Done', 'Todo', 'In progress', 'In review'],
  )
  assert.deepEqual(
    sortIssues(issues, 'status', custom).map((i) => i.id),
    ['1', '2', '3'],
  )
})
test('aliases, visibility, view, filters and sort survive serialization independently for each project', () => {
  const p = defaultPreferences()
  p.sidebarWidth = 310
  p.projectOrder = ['b', 'a']
  p.projects.a = {
    title: 'My project',
    hidden: true,
    view: 'kanban',
    sort: 'status',
    statusFilter: ['Todo', 'In progress'],
    statusOrder: ['Done', 'Todo'],
  }
  p.projects.b = { stateFilter: 'closed', sort: 'title', statusFilter: ['Done'] }
  const restored = readPreferences(JSON.stringify(p))
  assert.equal(restored.sidebarWidth, 310)
  assert.equal(restored.projects.a.title, 'My project')
  assert.equal(restored.projects.a.hidden, true)
  assert.equal(restored.projects.a.view, 'kanban')
  assert.deepEqual(restored.projects.a.statusFilter, ['Todo', 'In progress'])
  assert.equal(restored.projects.b.stateFilter, 'closed')
  assert.deepEqual(restored.projects.b.statusFilter, ['Done'])
  assert.equal(restored.projects.a.statusFilter?.includes('Done'), false)
  assert.deepEqual(restored.projectOrder, ['b', 'a'])
})
test('old single status selections migrate to multiselect without losing saved filters', () => {
  const restored = readPreferences(
    JSON.stringify({
      projects: {
        a: { statusFilter: 'Todo' },
        b: { statusFilter: 'all' },
        c: {},
        d: { statusFilter: ['Done', null, 'Done', 123, 'In review', ''] },
      },
    }),
  )
  assert.deepEqual(restored.projects.a.statusFilter, ['Todo'])
  assert.equal(restored.projects.b.statusFilter, 'all')
  assert.equal(restored.projects.c.statusFilter, 'all')
  assert.deepEqual(restored.projects.d.statusFilter, ['Done', 'In review'])
})
test('multiple statuses filter issues and Kanban columns consistently, preserving all and none after reload', () => {
  const p = defaultPreferences()
  p.projects.a = { statusFilter: ['Todo', 'In progress'] }
  p.projects.b = { statusFilter: [] }
  p.projects.c = { statusFilter: 'all' }
  const restored = readPreferences(JSON.stringify(p))
  const filter = restored.projects.a.statusFilter!
  assert.deepEqual(
    issues.filter((i) => matchesStatusFilter(i.status, filter)).map((i) => i.id),
    ['2', '3'],
  )
  assert.deepEqual(
    statuses.filter((s) => matchesStatusFilter(s.name, filter)).map((s) => s.name),
    ['Todo', 'In progress'],
  )
  assert.deepEqual(restored.projects.b.statusFilter, [])
  assert.equal(matchesStatusFilter('Todo', restored.projects.b.statusFilter!), false)
  assert.equal(matchesStatusFilter('New status', restored.projects.c.statusFilter!), true)
})
test('invalid saved preferences recover safely and sidebar width stays within usable bounds', () => {
  assert.deepEqual(readPreferences('{'), defaultPreferences())
  assert.equal(readPreferences('{"sidebarWidth":9999}').sidebarWidth, 420)
  assert.equal(readPreferences('{"sidebarWidth":0}').sidebarWidth, 180)
  assert.equal(readPreferences('{"sidebarWidth":"bad"}').sidebarWidth, 232)
})

test('draft visibility is saved per project and combines with project states without inventing a GitHub status', () => {
  const saved = readPreferences(
    JSON.stringify({
      projects: {
        a: { statusFilter: ['Todo'], includeDrafts: false },
        b: { statusFilter: ['Todo'], includeDrafts: true },
        legacy: { statusFilter: 'Todo' },
      },
    }),
  )
  const draft = { ...issues[1], kind: 'draft' } as Issue
  const regular = { ...issues[1], kind: 'issue' } as Issue
  assert.equal(saved.projects.a.includeDrafts, false)
  assert.equal(saved.projects.b.includeDrafts, true)
  assert.equal(saved.projects.legacy.includeDrafts, true)
  assert.equal(matchesIssueFilter(draft, 'all', false), false)
  assert.equal(matchesIssueFilter(regular, ['Todo'], false), true)
  assert.equal(matchesIssueFilter(draft, ['Todo'], true), true)
  assert.equal(matchesIssueFilter(draft, ['Done'], true), false)
  assert.equal(matchesIssueFilter(draft, [], true), false)
  assert.equal(matchesIssueFilter({ ...regular, status: 'Bozze' }, ['Bozze'], false), true)
})
