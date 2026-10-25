import type { Issue, ProjectStatus } from './types'

export const METRICS = [
  { id: 'waiting-allitude', label: 'In attesa Allitude', color: '#956122' },
  { id: 'to-estimate', label: 'Da stimare', color: '#7660b5' },
  { id: 'backlog', label: 'Backlog', color: '#526a91' },
  { id: 'in-progress', label: 'In lavorazione', color: '#306fba' },
  { id: 'to-release', label: 'Da rilasciare', color: '#b3623d' },
  { id: 'released', label: 'Rilasciate', color: '#217d83' },
  { id: 'completed', label: 'Completate', color: '#36805b' },
] as const

export type MetricId = (typeof METRICS)[number]['id']
export type MetricMapping = Partial<Record<MetricId, string[]>>
export interface ProjectMetricSnapshot {
  projectId: string
  syncedAt: number | null
  statuses: ProjectStatus[]
  counts: { status: string; total: number; open: number }[]
}
export interface MetricSummary {
  total: number
  open: number
  unmapped: number
  values: Record<MetricId, number | null>
}

export function readMetricMapping(value: unknown): MetricMapping {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: MetricMapping = {}
  for (const { id } of METRICS) {
    const names = (value as Record<string, unknown>)[id]
    if (Array.isArray(names))
      result[id] = [
        ...new Set(
          names.filter((name): name is string => typeof name === 'string' && name.length > 0),
        ),
      ]
  }
  return result
}

export function metricSnapshot(
  projectId: string,
  issues: Issue[],
  syncedAt: number | null,
  statuses: ProjectStatus[] = [],
): ProjectMetricSnapshot {
  const counts = new Map<string, { status: string; total: number; open: number }>()
  // A GitHub issue can appear in multiple project items. Count it once within this project.
  for (const issue of new Map(issues.map((issue) => [issue.id, issue])).values()) {
    const entry = counts.get(issue.status) ?? { status: issue.status, total: 0, open: 0 }
    entry.total++
    if (issue.state === 'OPEN' || issue.state === 'DRAFT') entry.open++
    counts.set(issue.status, entry)
  }
  const options = new Map(statuses.map((status) => [status.name, status]))
  for (const name of [...counts.keys(), 'Senza stato'])
    if (!options.has(name)) options.set(name, { id: name, name })
  return { projectId, syncedAt, statuses: [...options.values()], counts: [...counts.values()] }
}

export function summarizeMetrics(
  snapshot: ProjectMetricSnapshot,
  mapping: MetricMapping,
): MetricSummary {
  const assigned = new Set(METRICS.flatMap(({ id }) => mapping[id] ?? []))
  return {
    total: snapshot.counts.reduce((sum, entry) => sum + entry.total, 0),
    open: snapshot.counts.reduce((sum, entry) => sum + entry.open, 0),
    unmapped: snapshot.counts.reduce(
      (sum, entry) => sum + (assigned.has(entry.status) ? 0 : entry.total),
      0,
    ),
    values: Object.fromEntries(
      METRICS.map(({ id }) => {
        const names = mapping[id] ?? []
        return [
          id,
          names.length
            ? snapshot.counts.reduce(
                (sum, entry) => sum + (names.includes(entry.status) ? entry.total : 0),
                0,
              )
            : null,
        ]
      }),
    ) as MetricSummary['values'],
  }
}

export function aggregateMetrics(summaries: MetricSummary[]): MetricSummary {
  return {
    total: summaries.reduce((sum, summary) => sum + summary.total, 0),
    open: summaries.reduce((sum, summary) => sum + summary.open, 0),
    unmapped: summaries.reduce((sum, summary) => sum + summary.unmapped, 0),
    values: Object.fromEntries(
      METRICS.map(({ id }) => {
        const configured = summaries.filter((summary) => summary.values[id] !== null)
        return [
          id,
          configured.length
            ? configured.reduce((sum, summary) => sum + summary.values[id]!, 0)
            : null,
        ]
      }),
    ) as MetricSummary['values'],
  }
}
