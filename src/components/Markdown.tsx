import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import { Copy, Expand, ImageOff, LoaderCircle } from 'lucide-react'
import type { AtlasAPI } from '../shared/types'
import { errorMessage } from '../shared/errors'
import { imageCache } from '../shared/image-cache'
import { useHandoff } from './HandoffContext'

export function clearImageCache() {
  imageCache.clear()
}
export function AssetImage({
  src,
  alt,
  api,
  notify,
  open,
}: {
  src: string
  alt?: string
  api: AtlasAPI
  notify: (s: string, error?: boolean) => void
  open: (src: string, alt: string) => void
}) {
  const handoff = useHandoff()
  const [data, setData] = useState(imageCache.get(api, src))
  const [error, setError] = useState('')
  const [copying, setCopying] = useState(false)
  const container = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    let active = true
    const cached = imageCache.get(api, src)
    setData(cached)
    setError('')
    let observer: IntersectionObserver | undefined
    function load() {
      observer?.disconnect()
      void imageCache
        .load(api, src)
        .then((dataUrl) => {
          if (active) setData(dataUrl)
        })
        .catch((e) => {
          if (active) setError(errorMessage(e))
        })
    }
    if (cached === undefined) {
      if (typeof IntersectionObserver !== 'undefined' && container.current) {
        observer = new IntersectionObserver(
          (entries) => {
            if (entries.some((entry) => entry.isIntersecting)) load()
          },
          { rootMargin: '300px' },
        )
        observer.observe(container.current)
      } else load()
    }
    return () => {
      active = false
      observer?.disconnect()
    }
  }, [src, api])
  return (
    <span className="asset-image" ref={container}>
      {data ? (
        <img
          src={data}
          alt={alt || 'Immagine allegata'}
          loading="lazy"
          decoding="async"
          onClick={() => open(data, alt || 'Immagine allegata')}
          onError={() => {
            setData(undefined)
            setError('Formato immagine non visualizzabile. Apri il link originale.')
          }}
        />
      ) : (
        <span className="image-placeholder">
          {error ? <ImageOff size={24} /> : <LoaderCircle className="spin" size={24} />}
          <span>{error || 'Caricamento immagine…'}</span>
        </span>
      )}
      <span className="image-caption">
        <span>{alt || 'Immagine allegata'}</span>
        <span className="image-actions">
          {handoff.enabled && (
            <button
              title="Copia immagine"
              disabled={!data || copying}
              onClick={async () => {
                setCopying(true)
                try {
                  await api.copyImage(src)
                  notify('Immagine copiata.')
                } catch (e) {
                  notify((e as Error).message, true)
                } finally {
                  setCopying(false)
                }
              }}
            >
              {copying ? <LoaderCircle size={13} className="spin" /> : <Copy size={13} />} Copia
            </button>
          )}
          <button
            title="Ingrandisci immagine"
            disabled={!data}
            onClick={() => data && open(data, alt || 'Immagine allegata')}
          >
            <Expand size={13} />
          </button>
        </span>
      </span>
    </span>
  )
}
export const Markdown = memo(function Markdown({
  body,
  baseUrl,
  api,
  notify,
  open,
}: {
  body: string
  baseUrl: string
  api: AtlasAPI
  notify: (s: string, error?: boolean) => void
  open: (src: string, alt: string) => void
}) {
  const resolve = useCallback(
    (url: string) => {
      try {
        return new URL(url, baseUrl || 'https://github.com').href
      } catch {
        return ''
      }
    },
    [baseUrl],
  )
  const components = useMemo(
    () => ({
      a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
        <a
          href={resolve(href || '')}
          onClick={(e) => {
            e.preventDefault()
            if (href)
              void api.openExternal(resolve(href)).catch((e) => notify(errorMessage(e), true))
          }}
        >
          {children}
        </a>
      ),
      img: ({ src, alt }: { src?: string | Blob; alt?: string }) =>
        typeof src === 'string' ? (
          <AssetImage src={resolve(src)} alt={alt} api={api} notify={notify} open={open} />
        ) : null,
      video: ({ children }: { children?: React.ReactNode }) => (
        <span className="video-note">Video allegato.{children}</span>
      ),
    }),
    [resolve, api, notify, open],
  )
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={components}
      >
        {body || '_Nessuna descrizione._'}
      </ReactMarkdown>
    </div>
  )
})
