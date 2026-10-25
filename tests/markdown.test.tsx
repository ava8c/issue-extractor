import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from '../src/components/Markdown'
import type { AtlasAPI } from '../src/shared/types'

test('issue HTML cannot run scripts, handlers, iframes or javascript links in the renderer', () => {
  const body =
    '<script>alert(1)</script><iframe src="https://evil.example"></iframe><img src="https://example.com/a.png" onerror="alert(2)"><a href="javascript:alert(3)">click</a>\n\n**Safe formatting**'
  const html = renderToStaticMarkup(
    <Markdown
      body={body}
      baseUrl="https://github.example/team/repo/issues/1"
      api={{} as AtlasAPI}
      notify={() => {}}
      open={() => {}}
    />,
  )
  assert.ok(!html.includes('<script'))
  assert.ok(!html.includes('onerror'))
  assert.ok(!html.includes('<iframe'))
  assert.ok(!html.includes('javascript:'))
  assert.ok(html.includes('<strong>Safe formatting</strong>'))
})
