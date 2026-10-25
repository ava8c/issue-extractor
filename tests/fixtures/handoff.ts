import type { IssueDetail } from '../../src/shared/types'

export const handoffIssue: IssueDetail = {
  id: 'I1',
  number: 42,
  title: 'Issue completa',
  body: '![Schermata](https://github.example/assets/screen.png)\n\n[Specifica](https://docs.example/spec)',
  url: 'https://github.example/team/repo/issues/42',
  repository: 'team/repo',
  state: 'OPEN',
  status: 'Todo',
  kind: 'issue',
  labels: [],
  createdAt: '2026-10-21T08:00:00Z',
  updatedAt: '2026-10-23T08:00:00Z',
  commentCount: 1,
  commentsComplete: true,
  comments: [
    {
      id: 'C1',
      body: '[Report](https://github.example/files/report.pdf)',
      createdAt: '2026-10-22T08:00:00Z',
      updatedAt: '2026-10-22T08:00:00Z',
      author: { login: 'private-author' },
    },
  ],
}
