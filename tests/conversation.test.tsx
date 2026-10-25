import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Conversation } from '../src/components/Conversation'
import type { AtlasAPI, IssueDetail } from '../src/shared/types'
import { issueMarkdown } from '../src/shared/export'

const date = '2026-10-21T08:15:00Z'
const issue: IssueDetail = {
  id: 'I1',
  number: 1,
  title: 'Test',
  body: 'Descrizione originale',
  url: 'https://github.example/a/b/issues/1',
  repository: 'a/b',
  state: 'OPEN',
  status: 'Todo',
  kind: 'issue',
  labels: [],
  createdAt: date,
  updatedAt: date,
  commentCount: 4,
  commentsComplete: true,
  author: { name: 'Giulia Rossi', login: 'giulia.rossi' },
  comments: [
    { name: '  Marco Bianchi  ', login: 'marco.bianchi' },
    { name: '  ', login: 'anna.verdi' },
    null,
    { login: 'atlas-bot' },
  ].map((author, i) => ({
    id: `C${i}`,
    author,
    body: `Messaggio originale ${i}`,
    createdAt: date,
    updatedAt: date,
  })),
}
const render = (value: IssueDetail) =>
  renderToStaticMarkup(
    <Conversation issue={value} api={{} as AtlasAPI} notify={() => {}} open={() => {}} />,
  )
test('conversation identifies people by profile name, then login, and handles unavailable authors and bots', () => {
  const html = render(issue)
  assert.match(html, />Marco Bianchi<\/strong>/)
  assert.match(html, />anna.verdi<\/strong>/)
  assert.match(html, />Autore non disponibile<\/strong>/)
  assert.match(html, />atlas-bot<\/strong>/)
  assert.doesNotMatch(html, /Commento \d/)
  assert.match(html, /title="@marco.bianchi"/)
  assert.equal((html.match(/class="conversation-message"/g) || []).length, 4)
  assert.match(html, /id="estimate-source-C3"/)
  assert.match(html, /id="estimate-source-description"/)
  assert.match(html, /Ultimo commento/)
})
test('description starts expanded for an issue without comments, collapsed when a conversation is present', () => {
  assert.doesNotMatch(render(issue), /class="issue-description" open/)
  const html = render({ ...issue, comments: [], commentCount: 0 })
  assert.match(html, /class="issue-description" open/)
  assert.match(html, /Nessun commento, per ora/)
  assert.doesNotMatch(html, /Ultimo commento/)
})
test('new UI author metadata is not accidentally included in the existing text export', () => {
  const exported = issueMarkdown(issue)
  for (const author of [issue.author, ...issue.comments.map((comment) => comment.author)]) {
    if (author?.login) assert.ok(!exported.includes(author.login))
    if (author?.name?.trim()) assert.ok(!exported.includes(author.name.trim()))
  }
  assert.ok(exported.includes('Messaggio originale 3'))
})
