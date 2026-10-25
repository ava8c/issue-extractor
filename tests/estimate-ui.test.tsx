import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { EstimateBadge } from '../src/components/IssueEstimate'
import type { IssueEstimate } from '../src/shared/estimates'

test('no-estimate badges never show a review warning, including saved legacy results', () => {
  const html = renderToStaticMarkup(
    <EstimateBadge
      values={[{ entries: [], state: 'review', needsReview: true } as unknown as IssueEstimate]}
    />,
  )
  assert.ok(html.includes('Nessuna stima'))
  assert.ok(!html.includes('verifica'))
  assert.ok(!html.includes('Da verificare'))
  assert.ok(!html.includes('estimate-review'))
})
