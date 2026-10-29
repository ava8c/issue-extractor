import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import type { AtlasAPI, IssueLocation, IssueNotification } from '../src/shared/types'
import { notification } from './fixtures/email'

const bundle = await build({
  entryPoints: ['electron/preload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['electron'],
})
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

function preload(invoke: (channel: string, ...args: unknown[]) => Promise<unknown>) {
  const ipc = Object.assign(new EventEmitter(), { invoke })
  let api: AtlasAPI | undefined
  runInNewContext(bundle.outputFiles[0].text, {
    require: (name: string) => {
      assert.equal(name, 'electron')
      return {
        contextBridge: {
          exposeInMainWorld: (_name: string, exposed: AtlasAPI) => {
            api = exposed
          },
        },
        ipcRenderer: ipc,
      }
    },
  })
  assert.ok(api)
  return { api, ipc }
}

test('native clicks wait for a renderer subscriber and are acknowledged only after navigation', async () => {
  let pending: IssueNotification | null = notification
  const opened: IssueLocation[] = []
  const { api, ipc } = preload(async (channel, id) => {
    if (channel === 'activity:pending-open') return pending
    assert.equal(channel, 'activity:opened')
    assert.equal(id, notification.id)
    assert.equal(opened.length, 1, 'Navigation happens before the click is acknowledged')
    pending = null
  })
  ipc.emit('activity:open')
  assert.equal(pending, notification, 'A click during window loading remains queued')
  const unsubscribe = api.onNotificationOpen!((location) => opened.push(location))
  await tick()
  assert.equal(opened.length, 1)
  assert.equal(opened[0].projectId, notification.projectId)
  assert.equal(opened[0].issue.id, notification.issue.id)
  assert.equal(pending, null)
  ipc.emit('activity:open')
  await tick()
  assert.equal(opened.length, 1)
  unsubscribe()
  assert.equal(ipc.listenerCount('activity:open'), 0)
})

test('an unmounted subscriber cannot consume a pending click during StrictMode or connection reload', async () => {
  let release: (item: IssueNotification) => void = () => {}
  let reads = 0
  let pending: IssueNotification | null = notification
  let oldOpened = 0
  const opened: IssueLocation[] = []
  const { api } = preload(async (channel) => {
    if (channel === 'activity:pending-open') {
      if (++reads === 1)
        return new Promise((resolve) => {
          release = resolve
        })
      return pending
    }
    pending = null
  })
  const unmount = api.onNotificationOpen!(() => {
    oldOpened++
  })
  unmount()
  const unsubscribe = api.onNotificationOpen!((location) => opened.push(location))
  release(notification)
  await tick()
  assert.equal(oldOpened, 0)
  assert.equal(opened.length, 1)
  assert.equal(pending, null)
  unsubscribe()
})

test('a second notification click arriving during navigation is preserved until it too is opened', async () => {
  let pending: IssueNotification | null = notification
  const second = { ...notification, id: 'second', projectId: 'P2' }
  const opened: string[] = []
  const { api, ipc } = preload(async (channel, id) => {
    if (channel === 'activity:pending-open') return pending
    if (pending?.id === id) pending = null
  })
  const unsubscribe = api.onNotificationOpen!((location) => {
    opened.push(location.projectId)
    if (opened.length === 1) {
      pending = second
      ipc.emit('activity:open')
    }
  })
  await tick()
  assert.deepEqual(opened, ['P1', 'P2'])
  assert.equal(pending, null)
  unsubscribe()
})
