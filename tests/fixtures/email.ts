import type { IssueDetail, IssueNotification } from '../../src/shared/types'

export const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=',
  'base64',
)
export const detail: IssueDetail = {
  id: 'I-email',
  number: 42,
  title: 'Saldo <script> & dettagli',
  body: '## Problema\n\nTesto **importante** con accenti: è già pronto.\n\n![Schermata](https://github.example/image.png)\n\n[Report PDF](https://github.example/files/report.pdf)\n\n<script>alert(1)</script><iframe src="https://evil.example"></iframe><img src="file:///etc/passwd" onerror="alert(2)"><a href="javascript:alert(3)">link</a>',
  url: 'https://github.example/org/repo/issues/42',
  repository: 'org/repo',
  status: 'Done',
  state: 'CLOSED',
  labels: [],
  createdAt: '2026-10-20T09:00:00Z',
  updatedAt: '2026-10-24T10:00:00Z',
  commentCount: 2,
  kind: 'issue',
  commentsComplete: true,
  comments: [
    {
      id: 'old',
      body: 'Vecchio commento da escludere',
      createdAt: '2026-10-20T10:00:00Z',
      updatedAt: '2026-10-20T10:00:00Z',
    },
    {
      id: 'new',
      body: 'Nuovo commento con **formattazione** e [log](https://github.example/files/test.log)',
      createdAt: '2026-10-24T10:00:00Z',
      updatedAt: '2026-10-24T10:00:00Z',
    },
  ],
}
const { comments: omittedComments, commentsComplete: omittedComplete, ...metadata } = detail
export const notification: IssueNotification = {
  id: 'email-event',
  type: 'comment',
  issue: { ...metadata, body: '' },
  projectId: 'P1',
  createdAt: Date.parse('2026-10-24T10:01:00Z'),
  read: false,
  newCommentCount: 1,
}
export const secrets = {
  encrypt: async (value: string) => Buffer.from(`test-cipher:${value}`).toString('base64'),
  decrypt: async (value: string) =>
    Buffer.from(value, 'base64').toString().replace('test-cipher:', ''),
}
