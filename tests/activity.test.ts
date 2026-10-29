import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  detectActivity,
  findIssueLocations,
  readNotificationPreferences,
  readNotificationLogin,
  isOwnNotification,
} from '../src/shared/activity'
import { IssueCache } from '../electron/issue-cache'
import type { Issue, IssueNotification } from '../src/shared/types'

const issue: Issue = {
  id: 'I1',
  number: 42,
  title: 'Example',
  body: '',
  repository: 'org/repo',
  url: 'https://github.example/org/repo/issues/42',
  state: 'OPEN',
  status: 'Todo',
  labels: [],
  commentCount: 2,
  kind: 'issue',
  createdAt: '2026-10-20T10:00:00Z',
  updatedAt: '2026-10-23T10:00:00Z',
}

test('the first project scan is silent, while a previously empty project reports a new issue without old comment alerts', () => {
  assert.deepEqual(detectActivity('P1', undefined, [issue], 100), [])
  const events = detectActivity('P1', [], [issue], 100)
  assert.deepEqual(
    events.map((event) => event.type),
    ['new-issue'],
  )
  assert.equal(events[0].read, false)
})

test('project state, issue state and comment increments are detected independently; removals and comment deletions stay silent', () => {
  const changed = { ...issue, status: 'Done', commentCount: 5 }
  const events = detectActivity('P1', [issue], [changed], 200)
  assert.deepEqual(
    events.map((event) => event.type),
    ['status', 'comment'],
  )
  assert.equal(events[0].fromStatus, 'Todo')
  assert.equal(events[0].toStatus, 'Done')
  assert.equal(events[1].newCommentCount, 3)
  const closed = detectActivity('P1', [issue], [{ ...issue, state: 'CLOSED' }], 300)
  assert.equal(closed[0].fromStatus, 'Aperta')
  assert.equal(closed[0].toStatus, 'Chiusa')
  assert.deepEqual(detectActivity('P1', [issue], [], 300), [])
  assert.deepEqual(detectActivity('P1', [issue], [{ ...issue, commentCount: 1 }], 300), [])
  assert.deepEqual(detectActivity('P1', [issue], [{ ...issue, title: 'Renamed' }], 300), [])
})

test('quick lookup preserves every project membership and distinguishes the same number in different repositories', () => {
  const indexes = {
    P1: { issues: [issue] },
    P2: { issues: [issue, { ...issue, id: 'I2', repository: 'org/another' }] },
  }
  const matches = findIssueLocations(42, ['P1', 'P2'], indexes)
  assert.deepEqual(
    matches.map((match) => [match.projectId, match.issue.id]),
    [
      ['P1', 'I1'],
      ['P2', 'I1'],
      ['P2', 'I2'],
    ],
  )
  assert.deepEqual(
    findIssueLocations(42, ['P1', 'P1', 'hidden'], indexes).map((match) => match.projectId),
    ['P1'],
  )
  for (const number of [0, -1, 4.2, NaN, Number.MAX_SAFE_INTEGER + 1])
    assert.deepEqual(findIssueLocations(number, ['P1'], indexes), [])
})

test('quick lookup sorts duplicate numbers by creation, then update time, preserving memberships and stable ties', () => {
  const newer = { ...issue, id: 'new', createdAt: '2026-10-25T10:00:00Z' }
  const updated = { ...issue, id: 'updated', updatedAt: '2026-10-26T10:00:00Z' }
  const indexes = {
    P1: { issues: [issue, newer] },
    P2: { issues: [updated, newer, { ...issue, id: 'invalid', createdAt: '', updatedAt: '' }] },
  }
  assert.deepEqual(
    findIssueLocations(42, ['P1', 'P2'], indexes).map(({ projectId, issue }) => [
      projectId,
      issue.id,
    ]),
    [
      ['P1', 'new'],
      ['P2', 'new'],
      ['P2', 'updated'],
      ['P1', 'I1'],
      ['P2', 'invalid'],
    ],
  )
  assert.equal(indexes.P1.issues[0].id, 'I1')
})

test('notification identity matches the token account login, while namesakes and mixed or unknown actors remain unread', () => {
  assert.equal(readNotificationLogin(' M12345 '), 'm12345')
  assert.equal(readNotificationLogin(null), '')
  const event = { actors: [{ login: 'M12345', name: 'Mario Rossi' }] } as IssueNotification
  assert.equal(isOwnNotification(event, ' m12345 '), true)
  assert.equal(isOwnNotification(event, 'Mario Rossi'), false)
  assert.equal(isOwnNotification(event, ''), false)
  assert.equal(
    isOwnNotification({ ...event, actors: [{ login: 'other', name: 'Mario Rossi' }] }, 'm12345'),
    false,
  )
  assert.equal(
    isOwnNotification({ ...event, actors: [...event.actors!, { login: 'other' }] }, 'm12345'),
    false,
  )
  assert.equal(isOwnNotification({ ...event, actors: [null] }, 'm12345'), false)
  assert.equal(isOwnNotification({ ...event, actors: [] }, 'm12345'), false)
  assert.equal(isOwnNotification({ ...event, actors: undefined }, 'm12345'), false)
})

test('own activity stays in history and the email pipeline, with identity and read status persisted across restart', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'atlas-own-activity-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const path = join(folder, 'cache.json')
  const cache = new IssueCache(path, 'account')
  const target = {
    revision: 'identity-test',
    recipients: ['other@example.com', 'team@example.com'],
  }
  await cache.configureEmail(target)
  await cache.setNotificationLogin('M12345')
  await cache.recordActivity('P1', [issue], 100)
  const current = { ...issue, status: 'Done', commentCount: 4 }
  const events = detectActivity('P1', [issue], [current], 200).map((event) => ({
    ...event,
    actors: [{ login: 'm12345' }],
  }))
  await cache.recordActivity('P1', [current], 200, events)
  assert.equal(cache.notifications().items.length, 2)
  assert.ok(cache.notifications().items.every((item) => item.read))
  assert.equal(
    cache.emailStatus(target.revision).pending,
    4,
    'Every own event is still queued for both recipients',
  )
  assert.equal(cache.nextEmail(target.revision)?.notification.read, true)
  const restored = new IssueCache(path, 'account')
  await restored.load()
  await restored.configureEmail(target)
  assert.equal(restored.getNotificationLogin(), 'm12345')
  assert.ok(restored.notifications().items.every((item) => item.read))
  assert.equal(restored.emailStatus(target.revision).pending, 4)
  const added = { ...issue, id: 'own-new', projectItemCreator: { login: 'm12345' } }
  await restored.recordActivity('P1', [current, added], 300)
  assert.equal(
    restored.notifications().items.find((item) => item.issue.id === added.id)?.read,
    true,
  )
  await restored.setNotificationLogin('other')
  const next = { ...added, id: 'own-next' }
  await restored.recordActivity('P1', [current, added, next], 400)
  assert.equal(
    restored.notifications().items.find((item) => item.issue.id === next.id)?.read,
    false,
  )
  assert.equal(
    restored.notifications().items.find((item) => item.issue.id === added.id)?.read,
    true,
  )
  const otherAccount = new IssueCache(path, 'other-account')
  await otherAccount.load()
  assert.equal(otherAccount.getNotificationLogin(), '')
})

test('activity and read state survive restart, and the same comment change across projects is notified once', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'atlas-activity-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const path = join(folder, 'cache.json')
  const cache = new IssueCache(path, 'account')
  await cache.recordActivity('P1', [issue], 100)
  await cache.recordActivity('P2', [issue], 100)
  assert.deepEqual(cache.notifications().items, [])
  const changed = {
    ...issue,
    status: 'In progress',
    commentCount: 3,
    updatedAt: '2026-10-24T10:00:00Z',
  }
  await cache.recordActivity('P1', [changed], 200)
  await cache.recordActivity('P2', [changed], 210)
  assert.equal(cache.notifications().items.filter((item) => item.type === 'comment').length, 1)
  assert.equal(cache.notifications().items.filter((item) => item.type === 'status').length, 2)
  const id = cache.notifications().items[0].id
  await cache.markNotificationsRead([id])
  const restored = new IssueCache(path, 'account')
  await restored.load()
  assert.equal(restored.notifications().items.find((item) => item.id === id)?.read, true)
  assert.equal(restored.findIssues(42, ['P1', 'P2']).length, 2)
  const before = restored.notifications().items.length
  await restored.recordActivity('P1', [changed], 300)
  assert.equal(restored.notifications().items.length, before)
  const otherAccount = new IssueCache(path, 'different-account')
  await otherAccount.load()
  assert.deepEqual(otherAccount.notifications().items, [])
  await restored.clear()
  await restored.recordActivity('P1', [changed], 400)
  assert.deepEqual(restored.notifications().items, [])
})

test('per-project exclusions silence new issues, destination states, closures and comments without losing the activity baseline', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'atlas-notification-filters-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const path = join(folder, 'cache.json')
  const cache = new IssueCache(path, 'account')
  assert.deepEqual(cache.getNotificationPreferences('P1'), {
    enabled: true,
    excludedStatuses: [],
    includeDrafts: true,
  })
  await cache.setNotificationPreferences('P1', {
    excludedStatuses: ['Done', 'Senza stato'],
    includeDrafts: false,
  })
  await cache.recordActivity('P1', [issue], 100)
  const done = { ...issue, status: 'Done', state: 'CLOSED', commentCount: 4 }
  const draft = { ...issue, id: 'D1', kind: 'draft' as const, state: 'DRAFT', number: 0 }
  const newDone = { ...done, id: 'I2' }
  const noStatus = { ...issue, id: 'I3', status: 'Senza stato' }
  await cache.recordActivity('P1', [done, newDone, draft, noStatus], 200)
  await cache.recordActivity(
    'P1',
    [
      { ...done, state: 'OPEN', commentCount: 5 },
      newDone,
      { ...draft, status: 'In progress' },
      noStatus,
    ],
    300,
  )
  assert.deepEqual(cache.notifications().items, [])
  assert.equal(cache.findIssues(42, ['P1']).length, 3)

  const restored = new IssueCache(path, 'account')
  await restored.load()
  assert.deepEqual(restored.getNotificationPreferences('P1'), {
    enabled: true,
    excludedStatuses: ['Done', 'Senza stato'],
    includeDrafts: false,
  })
  await restored.setNotificationPreferences('P1', readNotificationPreferences())
  await restored.recordActivity(
    'P1',
    [
      { ...done, state: 'OPEN', commentCount: 5 },
      newDone,
      { ...draft, status: 'In progress' },
      noStatus,
    ],
    400,
  )
  assert.deepEqual(
    restored.notifications().items,
    [],
    'reenabling does not replay suppressed changes',
  )
  await restored.setNotificationPreferences('P1', {
    excludedStatuses: ['Done'],
    includeDrafts: false,
  })
  await restored.recordActivity(
    'P1',
    [{ ...done, status: 'Todo', state: 'OPEN', commentCount: 5 }, newDone, draft],
    500,
  )
  const events = restored.notifications().items
  assert.equal(events.length, 1)
  assert.equal(events[0].fromStatus, 'Done')
  assert.equal(events[0].toStatus, 'Todo')
})

test('exclusions apply before comment deduplication, so another enabled project still gets the event', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'atlas-notification-projects-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const cache = new IssueCache(join(folder, 'cache.json'), 'account')
  await cache.setNotificationPreferences('P1', { excludedStatuses: ['Todo'], includeDrafts: true })
  await cache.recordActivity('P1', [issue], 100)
  await cache.recordActivity('P2', [issue], 100)
  const changed = { ...issue, commentCount: 3 }
  await cache.recordActivity('P1', [changed], 200)
  await cache.recordActivity('P2', [changed], 200)
  assert.deepEqual(
    cache.notifications().items.map((event) => [event.projectId, event.type]),
    [['P2', 'comment']],
  )
  await cache.recordActivity('P2', [changed, { ...issue, id: 'D1', kind: 'draft' }], 300)
  assert.ok(cache.notifications().items.some((event) => event.issue.kind === 'draft'))
})
