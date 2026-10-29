import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { NotificationConstructorOptions } from 'electron'
import { DesktopNotifications, nativeNotificationOptions } from '../electron/notifications'
import { ActivityService } from '../electron/activity'
import type { GitHubClient } from '../electron/github'
import { IssueCache } from '../electron/issue-cache'
import { notificationsEnabled, readNotificationPreferences } from '../src/shared/activity'
import type { IssueNotification, Project } from '../src/shared/types'
import { notification } from './fixtures/email'

class NativeNotification extends EventEmitter {
  shown = 0
  closed = 0
  constructor(readonly id: string) {
    super()
  }
  show() {
    this.shown++
    this.emit('show')
  }
  close() {
    this.closed++
    this.emit('close')
  }
}

function desktop() {
  const created: NativeNotification[] = []
  const opened: IssueNotification[] = []
  const removed: string[] = []
  const service = new DesktopNotifications(
    (options) => {
      const native = new NativeNotification(options.id!)
      created.push(native)
      return native
    },
    (item) => opened.push(item),
    () => {},
    (ids) => removed.push(...ids),
  )
  return { service, created, opened, removed }
}

test('old preferences stay enabled, explicit project muting overrides every status and draft', () => {
  const previous = { excludedStatuses: ['Done'], includeDrafts: false }
  assert.deepEqual(readNotificationPreferences(previous), { enabled: true, ...previous })
  const muted = readNotificationPreferences({ ...previous, enabled: false })
  assert.equal(notificationsEnabled({ ...notification.issue, status: 'New status' }, muted), false)
  assert.equal(notificationsEnabled({ ...notification.issue, kind: 'draft' }, muted), false)
  assert.equal(readNotificationPreferences({ enabled: 'false' }).enabled, true)
  assert.deepEqual(readNotificationPreferences(null), {
    enabled: true,
    excludedStatuses: [],
    includeDrafts: true,
  })
})

test('muting persists per project, cancels queued Grok sends, keeps history and advances the baseline without replay', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'atlas-muted-notifications-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const path = join(folder, 'cache.json')
  const cache = new IssueCache(path, 'account')
  const target = { revision: 'grok', recipients: ['webhook'] }
  await cache.configureEmail(target)
  await cache.recordActivity('P1', [], 100)
  const original = { ...notification.issue, status: 'Todo' }
  await cache.recordActivity('P1', [original], 200)
  const queued = cache.nextEmail(target.revision)!
  assert.ok(queued)
  const preferences = { enabled: false, excludedStatuses: ['Done'], includeDrafts: false }
  await cache.setNotificationPreferences('P1', preferences)
  assert.equal(await cache.startEmail(queued.id), false)
  assert.equal(cache.emailStatus(target.revision).pending, 0)
  const changed = { ...original, status: 'New status', commentCount: 8 }
  const added = { ...changed, id: 'new' }
  assert.deepEqual(await cache.recordActivity('P1', [changed, added], 300), [])
  assert.equal(cache.notifications().items.length, 1, 'The existing history stays visible')
  assert.equal(cache.activityIssues('P1')[0].commentCount, 8)
  const restored = new IssueCache(path, 'account')
  await restored.load()
  await restored.configureEmail(target)
  assert.deepEqual(restored.getNotificationPreferences('P1'), preferences)
  assert.equal(restored.getNotificationPreferences('P2').enabled, true)
  await restored.retryEmail(target.revision, true)
  assert.equal(restored.nextEmail(target.revision), undefined)
  await restored.setNotificationPreferences('P1', { ...preferences, enabled: true })
  assert.deepEqual(await restored.recordActivity('P1', [changed, added], 400), [])
  assert.equal(restored.emailStatus(target.revision).pending, 0)
  const fresh = await restored.recordActivity('P1', [{ ...changed, commentCount: 9 }, added], 500)
  assert.deepEqual(
    fresh.map((item) => [item.type, item.newCommentCount]),
    [['comment', 1]],
  )
})

test('legacy saved project preferences migrate without losing filters', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'atlas-notifications-migration-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const path = join(folder, 'cache.json')
  await writeFile(
    path,
    JSON.stringify({
      version: 1,
      scope: 'account',
      snapshots: {},
      notificationPreferences: { P1: { excludedStatuses: ['Done'], includeDrafts: false } },
    }),
  )
  const cache = new IssueCache(path, 'account')
  await cache.load()
  assert.deepEqual(cache.getNotificationPreferences('P1'), {
    enabled: true,
    excludedStatuses: ['Done'],
    includeDrafts: false,
  })
})

test('a project muted or disconnected during persistence produces no native delivery', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'atlas-notifications-race-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const cache = new IssueCache(join(folder, 'cache.json'), 'account')
  await cache.recordActivity('P1', [], 100)
  const recording = cache.recordActivity('P1', [notification.issue], 200)
  await cache.setNotificationPreferences('P1', { enabled: false })
  assert.deepEqual(await recording, [])
  await cache.setNotificationPreferences('P1', { enabled: true })
  const clearing = cache.recordActivity('P1', [{ ...notification.issue, commentCount: 9 }], 300)
  await cache.clear()
  assert.deepEqual(await clearing, [])
})

test('native notifications describe project, issue and all three event types', () => {
  const options = nativeNotificationOptions(notification, 'Progetto pagamenti')
  assert.equal(options.id, notification.id)
  assert.equal(options.groupId, 'P1')
  assert.equal(options.title, 'Progetto pagamenti')
  assert.match(options.subtitle!, /#42.*Saldo/)
  assert.equal(options.body, '1 nuovo commento · org/repo')
  assert.match(
    nativeNotificationOptions({ ...notification, newCommentCount: 3 }, 'P1').body!,
    /3 nuovi commenti/,
  )
  assert.match(
    nativeNotificationOptions(
      { ...notification, type: 'status', fromStatus: 'Todo', toStatus: 'Done' },
      'P1',
    ).body!,
    /Todo → Done/,
  )
  assert.match(
    nativeNotificationOptions(
      {
        ...notification,
        type: 'new-issue',
        issue: { ...notification.issue, number: 0, kind: 'draft' },
      },
      'P1',
    ).subtitle!,
    /#bozza/,
  )
  assert.match(
    nativeNotificationOptions({ ...notification, type: 'new-issue' }, 'P1').body!,
    /Nuova issue/,
  )
})

test('only fresh unread events display once, click opens the issue and dismissed or cleared notifications cannot navigate', () => {
  const { service, created, opened } = desktop()
  service.show(
    [{ ...notification, id: 'own', read: true }, notification, notification],
    () => 'Project',
  )
  assert.equal(created.length, 1)
  assert.equal(created[0].shown, 1)
  created[0].emit('click')
  assert.deepEqual(opened, [notification])
  assert.equal(created[0].closed, 1)
  created[0].emit('click')
  assert.equal(opened.length, 1)
  service.show(
    [
      { ...notification, id: 'muted' },
      { ...notification, id: 'other', projectId: 'P2' },
    ],
    () => 'Project',
  )
  service.dismiss((item) => item.projectId === 'P1')
  created[1].emit('click')
  assert.equal(opened.length, 1)
  assert.equal(created[2].closed, 0)
  service.clear()
  created[2].emit('click')
  assert.equal(created[2].closed, 1)
  assert.equal(opened.length, 1)
})

test('restoring Notification Center reattaches clicks without showing old banners and removes unknown or read events', () => {
  const { service, opened, created, removed } = desktop()
  const saved = new NativeNotification(notification.id)
  const unknown = new NativeNotification('previous-account')
  const read = new NativeNotification('read')
  service.restore(
    [saved, unknown, read],
    [notification, { ...notification, id: 'read', read: true }],
  )
  assert.equal(saved.shown, 0)
  assert.equal(unknown.closed, 1)
  assert.equal(read.closed, 1)
  assert.deepEqual(removed, ['previous-account', 'read'])
  service.show([notification], () => 'Project')
  assert.equal(created.length, 0)
  saved.emit('click')
  assert.deepEqual(opened, [notification])
  assert.deepEqual(removed, ['previous-account', 'read', notification.id])
})

test('a delayed OS delivery after muting is removed instead of leaving a stale native notification', () => {
  const { service, created, removed } = desktop()
  service.show([notification], () => 'Project')
  service.dismiss((item) => item.projectId === 'P1')
  created[0].emit('show')
  assert.deepEqual(removed, [notification.id, notification.id])
})

test('native failures are reported without interrupting activity and a successful delivery clears the error', () => {
  let changes = 0
  let mode: 'unsupported' | 'throws' | 'works' = 'unsupported'
  const native = new NativeNotification(notification.id)
  const service = new DesktopNotifications(
    (_options: NotificationConstructorOptions) => {
      if (mode === 'throws') throw new Error('Native API failed')
      return mode === 'works' ? native : undefined
    },
    () => {},
    () => {
      changes++
    },
  )
  service.show([notification], () => 'Project')
  assert.match(service.error!, /Notifica macOS non consegnata/)
  assert.equal(changes, 1)
  mode = 'throws'
  assert.doesNotThrow(() => service.show([notification], () => 'Project'))
  mode = 'works'
  service.show([notification], () => 'Project')
  assert.equal(service.error, undefined)
  native.emit('failed', {}, 'OS rejected notification')
  assert.match(service.error!, /Notifica macOS non consegnata/)
  native.emit('click')
  service.clear()
  assert.equal(service.error, undefined)
})

test('concurrent activity scans deliver a shared comment once from an enabled project, and suppress own events', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'atlas-native-activity-'))
  t.after(() => rm(folder, { recursive: true, force: true }))
  const cache = new IssueCache(join(folder, 'cache.json'), 'account')
  const { service, created } = desktop()
  let issue = notification.issue
  let actor = 'colleague'
  const github = {
    projectLayout: async () => ({ statusFieldName: 'Status', statuses: [] }),
    activityItems: async () => [issue],
    authenticatedLogin: async () => 'me',
    notificationActors: async () => [{ login: actor }],
  } as unknown as GitHubClient
  const activity = new ActivityService(github, cache, undefined, (items) =>
    service.show(items, (id) => id),
  )
  const projects = [
    { id: 'P1', title: 'One' },
    { id: 'P2', title: 'Two' },
  ] as Project[]
  await activity.sync(projects, true)
  assert.equal(created.length, 0, 'The first baseline is silent')
  await cache.setNotificationPreferences('P1', { enabled: false })
  issue = { ...issue, commentCount: issue.commentCount + 1 }
  await Promise.all([activity.sync(projects, true), activity.sync(projects, true)])
  assert.equal(created.length, 1)
  assert.equal(cache.notifications().items[0].projectId, 'P2')
  actor = 'me'
  issue = { ...issue, status: 'Review', commentCount: issue.commentCount + 1 }
  await activity.sync(projects, true)
  assert.equal(created.length, 1, 'Own events stay in history without native banners')
  assert.ok(cache.notifications().items.some((item) => item.read && item.type === 'status'))
})
