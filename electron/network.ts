import { net } from 'electron'
import { MAX_ASSET_BYTES } from './assets'

function responseHeaders(values: Record<string, string | string[]>) {
  const headers = new Headers()
  for (const [name, value] of Object.entries(values)) {
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item)
  }
  return headers
}

// net.fetch rejects Chromium's manual redirects. Expose the redirect response to
// the downloader so it can validate the next host and decide its headers itself.
export const nativeAssetFetch: typeof fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  return new Promise<Response>((resolve, reject) => {
    const request = net.request({
      url,
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      useSessionCookies: false,
      cache: 'no-store',
    })
    let settled = false
    const cleanup = () => init.signal?.removeEventListener('abort', abort)
    const succeed = (response: Response) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(response)
    }
    const fail = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const abort = () => {
      fail(new Error('Download interrotto o scaduto. Riprova con la VPN connessa.'))
      request.abort()
    }
    if (init.signal?.aborted) {
      abort()
      return
    }
    init.signal?.addEventListener('abort', abort, { once: true })
    new Headers(init.headers).forEach((value, name) => request.setHeader(name, value))
    request.on('redirect', (statusCode, _method, location, values) => {
      const headers = responseHeaders(values)
      headers.set('location', location)
      succeed(new Response(null, { status: statusCode, headers }))
      request.abort()
    })
    request.on('response', (response) => {
      const headers = responseHeaders(response.headers)
      if (Number(headers.get('content-length')) > MAX_ASSET_BYTES) {
        fail(new Error('File oltre il limite di 25 MB.'))
        request.abort()
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        if (settled) return
        size += chunk.length
        if (size > MAX_ASSET_BYTES) {
          fail(new Error('File oltre il limite di 25 MB.'))
          request.abort()
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => {
        if (settled) return
        const body = [204, 205, 304].includes(response.statusCode)
          ? null
          : new Uint8Array(Buffer.concat(chunks))
        succeed(new Response(body, { status: response.statusCode, headers }))
      })
      response.on('error', fail)
      response.on('aborted', () => fail(new Error('Il server ha interrotto il download. Riprova.')))
    })
    request.on('error', (error) =>
      fail(new Error(`Download non riuscito per ${new URL(url).hostname}: ${error.message}`)),
    )
    request.end()
  })
}
