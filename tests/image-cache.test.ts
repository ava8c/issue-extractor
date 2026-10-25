import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ImageCache } from '../src/shared/image-cache'
import { limitConcurrency } from '../src/shared/loading'
import type { AssetResult } from '../src/shared/types'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

test('image requests share downloads, respect a global limit and release slots after failures', async () => {
  const cache = new ImageCache()
  const started: string[] = []
  const downloads = new Map<string, ReturnType<typeof deferred<AssetResult>>>()
  const api = {
    asset: (src: string) => {
      started.push(src)
      const download = deferred<AssetResult>()
      downloads.set(src, download)
      return download.promise
    },
  }
  const first = cache.load(api, 'a')
  const duplicate = cache.load(api, 'a')
  assert.equal(first, duplicate)
  const others = ['b', 'c', 'd', 'e'].map((src) => cache.load(api, src))
  const results = Promise.allSettled([first, duplicate, ...others])
  assert.deepEqual(started, ['a', 'b', 'c'])
  downloads.get('a')!.reject(new Error('Unavailable'))
  await assert.rejects(first, /Unavailable/)
  assert.deepEqual(started, ['a', 'b', 'c', 'd'])
  downloads.get('b')!.resolve({ dataUrl: 'image-b', mime: 'image/png' })
  assert.equal(await others[0], 'image-b')
  assert.deepEqual(started, ['a', 'b', 'c', 'd', 'e'])
  for (const src of ['c', 'd', 'e'])
    downloads.get(src)!.resolve({ dataUrl: `image-${src}`, mime: 'image/png' })
  await results
  assert.equal(await cache.load(api, 'b'), 'image-b')
  assert.equal(started.filter((src) => src === 'b').length, 1)
  const retry = cache.load(api, 'a')
  downloads.get('a')!.resolve({ dataUrl: 'recovered', mime: 'image/png' })
  assert.equal(await retry, 'recovered')
})

test('image cache evicts least recently used data within both memory and entry budgets', async () => {
  const api = { asset: async (src: string) => ({ dataUrl: src, mime: 'image/png' }) }
  const cache = new ImageCache(16, 2)
  await cache.load(api, 'aa')
  await cache.load(api, 'bb')
  cache.get(api, 'aa')
  await cache.load(api, 'cc')
  assert.equal(cache.get(api, 'bb'), undefined)
  assert.equal(cache.get(api, 'aa'), 'aa')
  await cache.load(api, 'ddddddd')
  assert.equal(cache.get(api, 'aa'), undefined)
  assert.equal(cache.get(api, 'cc'), undefined)
  assert.equal(cache.get(api, 'ddddddd'), 'ddddddd')
  assert.equal(await cache.load(api, 'too-large-to-cache'), 'too-large-to-cache')
  assert.equal(cache.get(api, 'too-large-to-cache'), undefined)
  assert.equal(cache.get(api, 'ddddddd'), 'ddddddd')
})

test('image data is isolated by API and clearing cannot be undone by an older in-flight download', async () => {
  const cache = new ImageCache()
  const old = deferred<AssetResult>()
  let calls = 0
  const api = {
    asset: async () => {
      calls++
      return calls === 1 ? old.promise : { dataUrl: 'new-credential', mime: 'image/png' }
    },
  }
  const previous = cache.load(api, 'same-url')
  cache.clear()
  assert.equal(await cache.load(api, 'same-url'), 'new-credential')
  old.resolve({ dataUrl: 'old-credential', mime: 'image/png' })
  await previous
  assert.equal(cache.get(api, 'same-url'), 'new-credential')
  const otherApi = { asset: async () => ({ dataUrl: 'other-api', mime: 'image/png' }) }
  assert.equal(cache.get(otherApi, 'same-url'), undefined)
  assert.equal(await cache.load(otherApi, 'same-url'), 'other-api')
})

test('shared concurrency slots survive synchronous errors and reject invalid limits', async () => {
  for (const limit of [0, -1, 1.5, NaN, Infinity])
    assert.throws(() => limitConcurrency(limit), RangeError)
  const run = limitConcurrency(1)
  const first = deferred<number>()
  const pending = run(() => first.promise)
  const failed = run(() => {
    throw new Error('Failed synchronously')
  })
  const recovered = run(async () => 3)
  const failure = assert.rejects(failed, /Failed synchronously/)
  first.resolve(1)
  assert.equal(await pending, 1)
  await failure
  assert.equal(await recovered, 3)
})
