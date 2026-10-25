import type { AtlasAPI } from './types'
import { limitConcurrency } from './loading'

type ImageAPI = Pick<AtlasAPI, 'asset'>
interface ImageState {
  values: Map<string, string>
  requests: Map<string, Promise<string>>
  bytes: number
}

export class ImageCache {
  private states = new WeakMap<ImageAPI, ImageState>()
  private run = limitConcurrency(3)

  constructor(
    private maxBytes = 32 * 1024 * 1024,
    private maxEntries = 20,
  ) {}

  clear() {
    // Old downloads may complete, but cannot repopulate the current cache.
    this.states = new WeakMap()
  }

  private state(api: ImageAPI) {
    let state = this.states.get(api)
    if (!state) {
      state = { values: new Map(), requests: new Map(), bytes: 0 }
      this.states.set(api, state)
    }
    return state
  }

  get(api: ImageAPI, src: string) {
    const values = this.state(api).values
    const value = values.get(src)
    if (value !== undefined) {
      values.delete(src)
      values.set(src, value)
    }
    return value
  }

  load(api: ImageAPI, src: string): Promise<string> {
    const cached = this.get(api, src)
    if (cached !== undefined) return Promise.resolve(cached)
    const state = this.state(api)
    const pending = state.requests.get(src)
    if (pending) return pending
    const request = this.run(async () => {
      const { dataUrl } = await api.asset(src)
      // Account conservatively for UTF-16 strings, including their base64 payload.
      const bytes = dataUrl.length * 2
      if (bytes <= this.maxBytes && this.maxEntries > 0 && this.states.get(api) === state) {
        while (
          state.values.size &&
          (state.values.size >= this.maxEntries || state.bytes + bytes > this.maxBytes)
        ) {
          const oldest = state.values.keys().next().value!
          state.bytes -= state.values.get(oldest)!.length * 2
          state.values.delete(oldest)
        }
        state.values.set(src, dataUrl)
        state.bytes += bytes
      }
      return dataUrl
    }).finally(() => state.requests.delete(src))
    state.requests.set(src, request)
    return request
  }
}

export const imageCache = new ImageCache()
