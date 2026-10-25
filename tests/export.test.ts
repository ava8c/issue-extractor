import assert from 'node:assert/strict'
import { test } from 'node:test'
import { unzipSync, strFromU8 } from 'fflate'
import { collectAssets, issueMarkdown, timestamp } from '../src/shared/export'
import { createExport, downloadAsset, privateAddress, safeFilename } from '../electron/assets'
import type { IssueDetail } from '../src/shared/types'

const issue: IssueDetail = {
  id: 'I1',
  number: 42,
  title: 'A complete issue',
  body: '![Screenshot](https://github.example/assets/a.png)\n\n[Specification](https://docs.example/spec)\n\n```md\n![Not an asset](https://example.com/ignored.png)\n```',
  url: 'https://github.example/team/repo/issues/42',
  repository: 'team/repo',
  state: 'OPEN',
  status: 'Todo',
  labels: [],
  createdAt: '2026-10-21T08:15:00Z',
  updatedAt: '2026-10-23T10:00:00Z',
  kind: 'issue',
  commentCount: 2,
  commentsComplete: true,
  comments: [
    {
      id: 'C1',
      body: '<img width="300" src="https://github.example/assets/a.png" alt="Again" />\n\n[Download log][log]\n\n[log]: https://github.example/files/request.log',
      createdAt: '2026-10-22T11:30:00Z',
      updatedAt: '2026-10-22T11:31:00Z',
    },
    {
      id: 'C2',
      body: '[Report](https://github.example/files/report.pdf)\n\nhttps://example.com/manual',
      createdAt: '2026-10-23T09:30:00Z',
      updatedAt: '2026-10-23T09:30:00Z',
    },
  ],
}
test('extracts markdown, HTML, reference links, comment attachments and autolinks; ignores code and deduplicates', () => {
  const assets = collectAssets(issue)
  assert.equal(assets.length, 5)
  assert.deepEqual(assets.find((a) => a.kind === 'image')?.sources, ['Descrizione', 'Commento 1'])
  assert.equal(assets.filter((a) => a.kind === 'file').length, 2)
  assert.equal(assets.filter((a) => a.kind === 'link').length, 2)
  assert.ok(!assets.some((a) => a.url.includes('ignored')))
})
test('text export contains all comments, original content, precise UTC times, edit times and manual references', () => {
  const markdown = issueMarkdown(issue)
  assert.ok(markdown.includes(issue.body))
  assert.ok(markdown.includes(issue.comments[1].body))
  assert.ok(markdown.includes('Commento 1 · 2026-10-22 11:30:00 UTC'))
  assert.ok(markdown.includes('Modificato: 2026-10-22 11:31:00 UTC'))
  assert.ok(markdown.includes('Commenti inclusi: 2 (tutti)'))
  assert.ok(markdown.includes('https://github.example/assets/a.png'))
  assert.ok(markdown.includes('Link da verificare manualmente'))
  assert.equal(timestamp('2026-10-23T10:00:00Z'), '2026-10-23 10:00:00 UTC')
})
test('refuses export with missing comments', async () => {
  assert.throws(() => issueMarkdown({ ...issue, commentsComplete: false }), /mancano/)
  assert.throws(() => issueMarkdown({ ...issue, commentCount: 3 }), /mancano/)
  let requested = false
  await assert.rejects(
    createExport({ ...issue, commentCount: 3 }, async () => {
      requested = true
      throw new Error()
    }),
    /mancano/,
  )
  assert.equal(requested, false)
})
test('ZIP includes actual bytes, portable references, every comment, manifest and explicit failed downloads', async () => {
  const result = await createExport(issue, async (url) => {
    if (url.endsWith('.pdf')) throw new Error('HTTP 403: access denied')
    return {
      bytes: new Uint8Array([1, 2, 3]),
      mime: 'image/png',
      filename: url.endsWith('.log') ? 'request.log' : 'a.png',
    }
  })
  assert.equal(result.downloaded, 2)
  assert.equal(result.manual, 3)
  const zip = unzipSync(result.bytes)
  assert.deepEqual([...zip['assets/A01-a.png']], [1, 2, 3])
  const text = strFromU8(zip['issue.md'])
  assert.ok(text.includes('![A01](assets/A01-a.png)'))
  assert.ok(text.includes('Riferimento originale: <https://github.example/assets/a.png>'))
  assert.ok(text.includes('HTTP 403: access denied'))
  assert.ok(text.includes(issue.comments[1].body))
  const manifest = JSON.parse(strFromU8(zip['manifest.json']))
  assert.equal(manifest.commentsIncluded, 2)
  assert.equal(manifest.assets.find((a: any) => a.url.endsWith('.pdf')).status, 'manual-check')
})
test('blocks unsafe destinations and unsafe filenames', async () => {
  assert.ok(privateAddress('127.0.0.1'))
  assert.ok(privateAddress('10.1.1.1'))
  assert.ok(privateAddress('169.254.169.254'))
  assert.ok(privateAddress('::1'))
  assert.ok(privateAddress('fc00::1'))
  assert.ok(!privateAddress('8.8.8.8'))
  assert.ok(!privateAddress('2606:4700:4700::1111'))
  assert.ok(!safeFilename('../../secret.txt').includes('/'))
  assert.ok(!/[\s()#%]/.test(safeFilename('Screenshot (2) #50%.png')))
  await assert.rejects(
    downloadAsset('http://github.example/a.png', 'https://github.example', 'token'),
    /HTTPS/,
  )
  await assert.rejects(
    downloadAsset('https://127.0.0.1/secrets', 'https://github.example', 'token'),
    /interno/,
  )
})
