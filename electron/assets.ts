import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { getDomain } from 'tldts'
import { zipSync, strToU8 } from 'fflate'
import { collectAssets, issueMarkdown } from '../src/shared/export'
import type { IssueDetail } from '../src/shared/types'

export const MAX_ASSET_BYTES = 25 * 1024 * 1024
const MAX_TOTAL_BYTES = 200 * 1024 * 1024
const localAddresses = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['224.0.0.0', 4],
] as const)
  localAddresses.addSubnet(address, prefix, 'ipv4')
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fe80::', 10],
  ['ff00::', 8],
] as const)
  localAddresses.addSubnet(address, prefix, 'ipv6')

export function assetAccess(value: string, host: string, assetHosts: string[] = []) {
  const url = new URL(value)
  const github = new URL(host)
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('URL non HTTPS o con credenziali: verifica manualmente.')
  const domain = getDomain(github.hostname, { allowPrivateDomains: true })
  const corporate =
    github.hostname !== 'github.com' &&
    domain &&
    getDomain(url.hostname, { allowPrivateDomains: true }) === domain
  const explicit = assetHosts.some((value) => new URL(value).origin === url.origin)
  return {
    authenticated: url.origin === github.origin,
    allowPrivate: url.origin === github.origin || Boolean(corporate) || explicit,
  }
}
export async function validateAssetTarget(
  value: string,
  host: string,
  assetHosts: string[] = [],
  resolve: (
    hostname: string,
    options: { all: true },
  ) => Promise<{ address: string; family: number }[]> = lookup,
) {
  const url = new URL(value)
  const access = assetAccess(value, host, assetHosts)
  if (!access.authenticated) {
    const addresses = await resolve(url.hostname, { all: true })
    if (!addresses.length)
      throw new Error(`Host allegato non risolvibile: ${url.hostname}. Verifica la VPN.`)
    const local = addresses.some((a) =>
      localAddresses.check(a.address, isIP(a.address) === 6 ? 'ipv6' : 'ipv4'),
    )
    if (local || (!access.allowPrivate && addresses.some((a) => privateAddress(a.address)))) {
      throw new Error(
        `L’host allegato ${url.origin} risolve a un indirizzo interno non autorizzato. Se è un server aziendale, aggiungilo agli “Host allegati” nelle impostazioni.`,
      )
    }
  }
  return access
}

export function privateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const a = address.toLowerCase()
    if (a.startsWith('::ffff:')) return privateAddress(a.slice(7))
    return !/^[23][0-9a-f]{0,3}:/.test(a) || a.startsWith('2001:db8:')
  }
  const [a, b] = address.split('.').map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && [18, 19, 51].includes(b)) ||
    (a === 203 && b === 0)
  )
}

export function safeFilename(value: string): string {
  return (
    value
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
      .replace(/[\s()[\]#%]+/g, '-')
      .replace(/^\.+/, '')
      .trim()
      .slice(0, 120) || 'allegato'
  )
}

export async function downloadAsset(
  value: string,
  host: string,
  token: string,
  assetHosts: string[] = [],
  fetcher: typeof fetch = fetch,
  maxBytes = MAX_ASSET_BYTES,
  signal?: AbortSignal,
): Promise<{ bytes: Uint8Array; mime: string; filename: string }> {
  let url = new URL(value)
  for (let redirects = 0; redirects <= 5; redirects++) {
    const access = await validateAssetTarget(url.href, host, assetHosts)
    const response = await fetcher(url.href, {
      redirect: 'manual',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
        : AbortSignal.timeout(30_000),
      headers: access.authenticated && token ? { Authorization: `Bearer ${token}` } : {},
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location) throw new Error('Reindirizzamento senza destinazione.')
      url = new URL(location, url)
      continue
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Download non riuscito (HTTP ${response.status}).`)
    }
    const mime = (response.headers.get('content-type') || 'application/octet-stream')
      .split(';')[0]
      .trim()
      .toLowerCase()
    if (mime === 'text/html' || mime === 'application/xhtml+xml') {
      await response.body?.cancel()
      throw new Error('Il link restituisce una pagina web o di login, non un file.')
    }
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body?.cancel()
      throw new Error(`File oltre il limite di ${Math.round(maxBytes / 1024 / 1024)} MB.`)
    }
    if (!response.body) throw new Error('Il file è vuoto.')
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > maxBytes) {
          await reader.cancel()
          throw new Error(`File oltre il limite di ${Math.round(maxBytes / 1024 / 1024)} MB.`)
        }
        chunks.push(chunk.value)
      }
    } finally {
      reader.releaseLock()
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    chunks.forEach((chunk) => {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    })
    const disposition = response.headers.get('content-disposition') || ''
    const name =
      disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1] ||
      disposition.match(/filename="?([^";]+)"?/i)?.[1] ||
      url.pathname.split('/').pop() ||
      'allegato'
    let filename: string
    try {
      filename = safeFilename(decodeURIComponent(name))
    } catch {
      filename = safeFilename(name)
    }
    if (!/\.[a-z0-9]{2,6}$/i.test(filename)) {
      const extension: Record<string, string> = {
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'image/svg+xml': '.svg',
        'application/pdf': '.pdf',
        'application/zip': '.zip',
        'text/plain': '.txt',
      }
      filename += extension[mime] ?? ''
    }
    return { bytes, mime, filename }
  }
  throw new Error('Troppi reindirizzamenti. Verifica il link manualmente.')
}

export async function prepareIssueBundle(
  issue: IssueDetail,
  download: (url: string) => ReturnType<typeof downloadAsset>,
) {
  issueMarkdown(issue) // Refuse incomplete comments before any network requests.
  const assets = collectAssets(issue)
  const files: Record<string, string> = {}
  const failures: Record<string, string> = {}
  const entries: Record<string, Uint8Array> = {}
  const metadata: Record<string, { mime: string; size: number }> = {}
  let total = 0
  for (const a of assets.filter((a) => a.kind !== 'link')) {
    try {
      if (total >= MAX_TOTAL_BYTES) throw new Error('Limite totale di 200 MB raggiunto.')
      const result = await download(a.url)
      if (total + result.bytes.length > MAX_TOTAL_BYTES)
        throw new Error('Limite totale di 200 MB raggiunto.')
      total += result.bytes.length
      const path = `assets/${a.id}-${safeFilename(result.filename)}`
      entries[path] = result.bytes
      files[a.url] = path
      metadata[a.url] = { mime: result.mime, size: result.bytes.length }
    } catch (e) {
      failures[a.url] = (e as Error).message || 'Download non riuscito.'
    }
  }
  const manifest = assets.map((a) => ({
    ...a,
    localPath: files[a.url] ?? null,
    status: files[a.url] ? 'downloaded' : 'manual-check',
    ...metadata[a.url],
    reason: failures[a.url] ?? (a.kind === 'link' ? 'Contenuto del link non estratto.' : undefined),
  }))
  entries['issue.md'] = strToU8(issueMarkdown(issue, files, failures))
  entries['manifest.json'] = strToU8(
    JSON.stringify(
      {
        source: issue.url,
        exportedAt: new Date().toISOString(),
        commentsIncluded: issue.comments.length,
        assets: manifest,
      },
      null,
      2,
    ),
  )
  entries['LEGGIMI.txt'] = strToU8(
    'Apri issue.md dopo aver estratto lo ZIP. La cartella assets contiene immagini e file; le reference originali rimangono nel Markdown. manifest.json elenca i download riusciti e i link da verificare. I nomi degli autori dei commenti non sono inclusi nei metadati. Il testo originale non viene modificato. Le date sono in UTC. Limiti: 25 MB per file e 200 MB complessivi. PR: sono inclusi i commenti della conversazione, non le review inline del codice.',
  )
  return {
    entries,
    manifest,
    downloaded: Object.keys(files).length,
    manual: assets.length - Object.keys(files).length,
  }
}

export async function createExport(
  issue: IssueDetail,
  download: (url: string) => ReturnType<typeof downloadAsset>,
) {
  const { entries, downloaded, manual } = await prepareIssueBundle(issue, download)
  return { bytes: zipSync(entries, { level: 6 }), downloaded, manual }
}
