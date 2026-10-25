import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MetricsDashboard, MetricsOverview, type MetricRow } from '../src/components/ProjectMetrics'
import { metricSnapshot, summarizeMetrics } from '../src/shared/metrics'
import type { Issue, Project } from '../src/shared/types'

test('overview discloses partial coverage and dashboard preserves unavailable data instead of presenting zeroes', () => {
  const snapshot = metricSnapshot('a', [{ id: '1', status: 'Doing', state: 'OPEN' } as Issue], 100)
  const mapping = { 'in-progress': ['Doing'] }
  const rows: MetricRow[] = [
    {
      project: { id: 'a', title: 'Caricato' } as Project,
      snapshot,
      mapping,
      summary: summarizeMetrics(snapshot, mapping),
    },
    { project: { id: 'b', title: 'Da caricare' } as Project, mapping: {}, summary: null },
  ]
  const overview = renderToStaticMarkup(<MetricsOverview rows={rows} />)
  assert.ok(overview.includes('1/2 progetti conteggiati'))
  assert.ok(overview.includes('Dati disponibili: 1/2 progetti'))
  assert.ok(overview.includes('Da configurare'))
  assert.ok(overview.includes('Backlog'))
  const dashboard = renderToStaticMarkup(
    <MetricsDashboard
      rows={rows}
      onProject={() => {}}
      onConfigure={() => {}}
      syncing={false}
      onRefresh={() => {}}
    />,
  )
  assert.ok(dashboard.includes('In attesa della sincronizzazione'))
  assert.ok(dashboard.includes('Configura metriche: Da caricare'))
  assert.ok(dashboard.includes('conteggiata in ciascuno'))
  assert.ok(dashboard.includes('Backlog'))
})
