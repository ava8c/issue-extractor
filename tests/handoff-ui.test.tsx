import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { HandoffContext } from '../src/components/HandoffContext'
import { IssueExportBar, IssueExportView } from '../src/components/IssueExport'
import { AssetImage } from '../src/components/Markdown'
import type { AtlasAPI } from '../src/shared/types'
import { handoffIssue } from './fixtures/handoff'

const actions = {
  issue: handoffIssue,
  busy: '',
  copy: () => {},
  exportZip: () => {},
  copyReference: () => {},
}
const controls = (
  <>
    <IssueExportBar {...actions} />
    <IssueExportView {...actions} />
    <AssetImage
      src="https://example.com/image.png"
      api={{} as AtlasAPI}
      open={() => {}}
      notify={() => {}}
    />
  </>
)

test('copy, ZIP and handoff controls are hidden by default; images can still be enlarged', () => {
  const html = renderToStaticMarkup(controls)
  assert.doesNotMatch(html, /Copia|ZIP|Esporta|riferimento/)
  assert.match(html, /Ingrandisci immagine/)
})

test('one flag enables existing copy/ZIP and the local reference, with no Codex promotional descriptions', () => {
  const html = renderToStaticMarkup(
    <HandoffContext.Provider value={{ enabled: true, mcpUrl: 'http://127.0.0.1:47321/mcp' }}>
      {controls}
    </HandoffContext.Provider>,
  )
  for (const text of ['Copia testo', 'Copia riferimento', 'Esporta ZIP', 'Copia immagine'])
    assert.ok(html.includes(text))
  assert.doesNotMatch(html, /Codex/)
})

test('server errors leave text/ZIP available and hide unusable references', () => {
  const html = renderToStaticMarkup(
    <HandoffContext.Provider value={{ enabled: true, error: 'Porta occupata' }}>
      {controls}
    </HandoffContext.Provider>,
  )
  assert.match(html, /Porta occupata/)
  assert.match(html, /Copia testo/)
  assert.match(html, /Esporta ZIP/)
  assert.doesNotMatch(html, /Copia riferimento/)
})
