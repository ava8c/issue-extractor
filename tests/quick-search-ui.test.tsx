import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { QuickIssueResult } from '../src/components/QuickIssueSearch'
import type { IssueLocation, Project } from '../src/shared/types'

test('quick lookup leads with the full project name and keeps repository, status and creation date visible', () => {
  const location = {
    projectId: 'P1',
    issue: {
      number: 42,
      title: 'Issue duplicata',
      repository: 'org/repo',
      status: 'Todo',
      createdAt: '2026-10-25T10:00:00Z',
    },
  } as IssueLocation
  const html = renderToStaticMarkup(
    <QuickIssueResult
      location={location}
      project={{ title: 'Progetto con nome completo' } as Project}
    />,
  )
  assert.match(html, /<strong class="quick-result-project">/)
  assert.ok(html.indexOf('Progetto con nome completo') < html.indexOf('Issue duplicata'))
  assert.ok(
    html.includes('org/repo') && html.includes('Todo') && html.includes('Creata il 25 ott 2026'),
  )
  const fallback = renderToStaticMarkup(
    <QuickIssueResult location={{ ...location, issue: { ...location.issue, createdAt: '' } }} />,
  )
  assert.ok(fallback.includes('P1'))
  assert.ok(!fallback.includes('<time'))
})
