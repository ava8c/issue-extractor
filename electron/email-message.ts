import { createHash } from 'node:crypto'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import { visit, SKIP } from 'unist-util-visit'
import type { SendMailOptions } from 'nodemailer'
import { collectAssets } from '../src/shared/export'
import type { IssueDetail, IssueNotification } from '../src/shared/types'
import { mapConcurrent } from '../src/shared/loading'

export const MAX_MAIL_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_IMAGE_TOTAL = 10 * 1024 * 1024
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSanitize)
const serializer = unified().use(rehypeStringify)
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  )
const formatDate = new Intl.DateTimeFormat('it-IT', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Rome',
})
const label = {
  status: 'Cambio di stato',
  'new-issue': 'Nuova issue nel progetto',
  comment: 'Nuovi commenti',
}
type DownloadImage = (url: string) => Promise<{ bytes: Uint8Array; mime: string; filename: string }>
function rasterImage(bytes: Uint8Array, mime: string) {
  const prefix = Buffer.from(bytes.subarray(0, 12))
  return mime === 'image/png'
    ? prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mime === 'image/jpeg'
      ? prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255
      : mime === 'image/gif'
        ? /^GIF8[79]a/.test(prefix.toString('ascii'))
        : mime === 'image/webp' &&
          prefix.toString('ascii', 0, 4) === 'RIFF' &&
          prefix.toString('ascii', 8, 12) === 'WEBP'
}

export async function notificationEmail(
  notification: IssueNotification,
  projectTitle: string,
  detail: IssueDetail | null,
  download: DownloadImage,
): Promise<Pick<SendMailOptions, 'subject' | 'html' | 'text' | 'attachments'>> {
  const issue = detail ?? { ...notification.issue, body: '', comments: [], commentsComplete: false }
  // Keep the event's project state, while using freshly fetched description/comment bodies.
  const change =
    notification.type === 'status'
      ? `${notification.fromStatus} → ${notification.toStatus}`
      : notification.type === 'comment'
        ? `${notification.newCommentCount ?? 1} nuovi commenti rilevati`
        : 'Issue aggiunta al progetto'
  let remaining = 200_000
  let shortened = false
  const trim = (body: string) => {
    const result = body.slice(0, remaining)
    remaining -= result.length
    if (result.length !== body.length) shortened = true
    return result
  }
  const body = trim(issue.body)
  const comments: IssueDetail['comments'] = []
  if (notification.type === 'comment')
    for (const comment of issue.comments
      .filter((comment) => Date.parse(comment.createdAt) <= notification.createdAt)
      .slice(-Math.max(1, notification.newCommentCount ?? 1))) {
      if (!remaining) {
        shortened = true
        break
      }
      comments.push({ ...comment, body: trim(comment.body) })
    }
  const scoped = { ...issue, body, comments }
  const assets = collectAssets(scoped)
  const images = new Map<string, { cid: string; available: boolean }>()
  const attachments: NonNullable<SendMailOptions['attachments']> = []
  let total = 0
  await mapConcurrent(
    assets.filter((asset) => asset.kind === 'image'),
    3,
    async (asset, index) => {
      const cid = `${createHash('sha256').update(asset.url).digest('hex').slice(0, 24)}@issue-atlas.local`
      const image = { cid, available: false }
      images.set(asset.url, image)
      if (index >= 10) return
      try {
        const file = await download(asset.url)
        if (
          !rasterImage(file.bytes, file.mime) ||
          file.bytes.length > MAX_MAIL_IMAGE_BYTES ||
          total + file.bytes.length > MAX_IMAGE_TOTAL
        )
          return
        total += file.bytes.length
        image.available = true
        attachments.push({
          filename: file.filename,
          content: Buffer.from(file.bytes),
          contentType: file.mime,
          contentDisposition: 'inline',
          cid,
        })
      } catch {
        /* The message retains an explicit image placeholder. */
      }
    },
  )
  const textFrom = (node: any): string => {
    if (node.type === 'text') return node.value
    if (node.tagName === 'img') return `[Immagine: ${node.properties.alt || 'immagine'}]`
    const content = (node.children ?? []).map(textFrom).join('')
    if (node.tagName === 'li') return `\n- ${content}`
    return ['p', 'div', 'h1', 'h2', 'h3', 'pre', 'blockquote', 'tr', 'ul', 'ol', 'br'].includes(
      node.tagName,
    )
      ? `${content}\n\n`
      : content
  }
  function render(markdown: string) {
    const tree = processor.runSync(processor.parse(markdown))
    visit(tree, 'element', (node: any) => {
      if (node.tagName === 'a' || node.tagName === 'img') {
        const raw = node.properties[node.tagName === 'img' ? 'src' : 'href']
        let url = ''
        try {
          if (typeof raw === 'string' && raw) {
            const resolved = new URL(raw, issue.url || 'https://github.com')
            if (['https:', 'http:'].includes(resolved.protocol)) url = resolved.href
          }
        } catch {
          /* Invalid links become plain text. */
        }
        const asset = assets.find((asset) => asset.url === url)
        if (node.tagName === 'img' || asset?.kind === 'image') {
          const alt = node.properties.alt
          const image = images.get(url)
          if (image?.available) {
            node.tagName = 'img'
            node.children = []
            node.properties = {
              src: `cid:${image.cid}`,
              alt: alt || asset?.label || 'Immagine',
              style: 'max-width:100%;height:auto;border-radius:6px;display:block;margin:12px 0',
            }
          } else {
            node.tagName = 'span'
            node.properties = {}
            node.children = [
              {
                type: 'text',
                value: `Immagine presente: ${asset?.label || alt || 'immagine'} (non incorporata; disponibile nell’issue su GitHub).`,
              },
            ]
          }
          return SKIP
        } else if (asset?.kind === 'file') {
          node.tagName = 'span'
          node.properties = {}
          node.children = [{ type: 'text', value: `File presente: ${asset.label} (non allegato)` }]
        } else
          node.properties = url
            ? { href: url, style: 'color:#7252a3;text-decoration:underline' }
            : {}
      }
      if (node.tagName === 'pre')
        node.properties.style =
          'white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f3f8;padding:12px;border-radius:6px'
      if (node.tagName === 'table')
        node.properties.style = 'border-collapse:collapse;width:100%;margin:12px 0'
      if (node.tagName === 'td' || node.tagName === 'th')
        node.properties.style = 'border:1px solid #e2ddeb;padding:8px;text-align:left'
    })
    return {
      html: serializer.stringify(tree),
      text: textFrom(tree)
        .replace(/\n{3,}/g, '\n\n')
        .trim(),
    }
  }
  const description = render(body || '_Nessuna descrizione disponibile._')
  const sections = comments.map((comment, index) => ({
    heading: `Commento recente ${index + 1} · ${formatDate.format(new Date(comment.createdAt))}`,
    ...render(comment.body || '_Commento senza testo._'),
  }))
  const files = assets.filter((asset) => asset.kind === 'file')
  const imageFailures = [...images.values()].filter((image) => !image.available).length
  const notes = [
    !detail
      ? 'Il contenuto completo non è disponibile al momento. Apri l’issue su GitHub per leggere descrizione e commenti.'
      : '',
    shortened
      ? 'Il testo è stato abbreviato per le dimensioni della mail. Il contenuto completo resta su GitHub.'
      : '',
    imageFailures
      ? `${imageFailures} immagini non sono state incorporate (formato, dimensione o accesso). Sono disponibili nell’issue su GitHub.`
      : '',
  ].filter(Boolean)
  const heading = `${label[notification.type]} · #${issue.number || 'bozza'}`
  const subject = `[Issue Atlas] ${heading} · ${issue.title}`.replace(/[\r\n]/g, ' ').slice(0, 240)
  const url = /^https:\/\//i.test(issue.url) ? issue.url : ''
  const text = [
    heading,
    issue.title,
    `${projectTitle} · ${issue.repository}`,
    change,
    `Rilevata: ${formatDate.format(new Date(notification.createdAt))} (Europe/Rome)`,
    url,
    '',
    'DESCRIZIONE',
    description.text,
    ...sections.flatMap((section) => ['', section.heading, section.text]),
    ...(files.length
      ? ['', 'FILE PRESENTI (non allegati)', ...files.map((file) => `- ${file.label}`)]
      : []),
    ...notes,
    '',
    'Ricevi questa mail perché hai attivato “Ricevi notifiche via mail” in Issue Atlas. Puoi disattivarla nelle impostazioni.',
  ].join('\n')
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"></head><body style="margin:0;padding:24px;background:#f5f3f8;font-family:Arial,sans-serif;color:#302a40;line-height:1.65"><table role="presentation" style="width:100%;max-width:680px;margin:auto;background:white;border:1px solid #e6e0ed;border-radius:12px"><tr><td style="padding:28px"><p style="color:#8c70b1;font-size:12px;margin:0">ISSUE ATLAS · ${escape(label[notification.type])}</p><h1 style="font-size:22px;line-height:1.4;margin:12px 0">#${issue.number || 'bozza'} ${escape(issue.title)}</h1><p style="color:#8c8198;font-size:13px">${escape(projectTitle)} · ${escape(issue.repository)}</p><p style="background:#f2ecfa;padding:12px;border-radius:6px;color:#70568f">${escape(change)}</p><p style="font-size:11px;color:#9e94a8">Rilevata: ${escape(formatDate.format(new Date(notification.createdAt)))} (Europe/Rome)</p><h2 style="font-size:16px">Descrizione</h2>${description.html}${sections.map((section) => `<h2 style="font-size:15px;border-top:1px solid #eee8f4;padding-top:18px">${escape(section.heading)}</h2>${section.html}`).join('')}${files.length ? `<h2 style="font-size:16px">File presenti</h2><ul>${files.map((file) => `<li>${escape(file.label)} <span style="color:#9e94a8">(non allegato)</span></li>`).join('')}</ul>` : ''}${notes.map((note) => `<p style="font-size:12px;color:#9c8456;background:#fcf7e8;padding:12px">${escape(note)}</p>`).join('')}${url ? `<p style="margin-top:24px"><a href="${escape(url)}" style="color:#76559f;font-weight:bold">Apri l’issue su GitHub →</a></p>` : ''}<p style="border-top:1px solid #eee8f4;padding-top:18px;font-size:11px;color:#a59aaf">Ricevi questa mail perché hai attivato “Ricevi notifiche via mail” in Issue Atlas. Puoi disattivarla nelle impostazioni.</p></td></tr></table></body></html>`
  return { subject, html, text, attachments }
}
