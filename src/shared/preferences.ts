import type { Issue, Project, ProjectStatus } from './types'
import { readMetricMapping, type MetricMapping } from './metrics'

export type IssueSort = 'status' | 'updated' | 'created' | 'title'
export type StatusFilter = 'all' | string[]
export interface ProjectPreferences {
  metricMapping?: MetricMapping
  title?: string
  hidden?: boolean
  statusOrder?: string[]
  stateFilter?: string
  repoFilter?: string
  statusFilter?: StatusFilter
  includeDrafts?: boolean
  sort?: IssueSort
  view?: 'list' | 'kanban'
}
export interface WorkspacePreferences {
  sidebarWidth: number
  projectOrder: string[]
  projects: Record<string, ProjectPreferences>
}
export const defaultPreferences = (): WorkspacePreferences => ({
  sidebarWidth: 232,
  projectOrder: [],
  projects: {},
})
export const clampSidebar = (width: number) => Math.max(180, Math.min(420, width))
function readStatusFilter(value: unknown): StatusFilter {
  if (Array.isArray(value)) {
    return [
      ...new Set(
        value.filter((name): name is string => typeof name === 'string' && name.length > 0),
      ),
    ]
  }
  // Preserve selections saved by versions with a single status filter.
  return typeof value === 'string' && value !== 'all' && value.length > 0 ? [value] : 'all'
}
export function matchesStatusFilter(status: string, filter: StatusFilter): boolean {
  return filter === 'all' || filter.includes(status)
}
export function matchesIssueFilter(
  issue: Issue,
  filter: StatusFilter,
  includeDrafts = true,
): boolean {
  return matchesStatusFilter(issue.status, filter) && (includeDrafts || issue.kind !== 'draft')
}
export function statusOptions(statuses: ProjectStatus[], saved: string[] = []): ProjectStatus[] {
  const options = new Map(statuses.map((status) => [status.name, status]))
  for (const name of ['Senza stato', ...saved])
    if (!options.has(name)) options.set(name, { id: name, name })
  return [...options.values()]
}
export function readPreferences(value: string | null): WorkspacePreferences {
  try {
    const parsed = JSON.parse(value || '{}')
    const projects: Record<string, ProjectPreferences> = {}
    for (const [id, p] of Object.entries(parsed.projects || {})) {
      if (!p || typeof p !== 'object' || Array.isArray(p)) continue
      const entry = p as ProjectPreferences
      projects[id] = {
        metricMapping: readMetricMapping(entry.metricMapping),
        title: typeof entry.title === 'string' ? entry.title.slice(0, 150) : undefined,
        hidden: entry.hidden === true,
        statusOrder: Array.isArray(entry.statusOrder)
          ? entry.statusOrder.filter((x) => typeof x === 'string')
          : undefined,
        stateFilter: ['open', 'closed'].includes(entry.stateFilter || '')
          ? entry.stateFilter
          : 'all',
        repoFilter: typeof entry.repoFilter === 'string' ? entry.repoFilter : 'all',
        statusFilter: readStatusFilter(entry.statusFilter),
        includeDrafts: entry.includeDrafts !== false,
        sort: ['status', 'updated', 'created', 'title'].includes(entry.sort || '')
          ? entry.sort
          : 'status',
        view: entry.view === 'kanban' ? 'kanban' : 'list',
      }
    }
    return {
      sidebarWidth:
        typeof parsed.sidebarWidth === 'number' && Number.isFinite(parsed.sidebarWidth)
          ? clampSidebar(parsed.sidebarWidth)
          : 232,
      projectOrder: Array.isArray(parsed.projectOrder)
        ? parsed.projectOrder.filter((x: unknown) => typeof x === 'string')
        : [],
      projects,
    }
  } catch {
    return defaultPreferences()
  }
}
export function moveBefore(order: string[], moving: string, before: string): string[] {
  if (moving === before || !order.includes(moving) || !order.includes(before)) return order
  const next = order.filter((id) => id !== moving)
  next.splice(next.indexOf(before), 0, moving)
  return next
}
export function moveBy(order: string[], id: string, direction: number): string[] {
  const index = order.indexOf(id)
  const target = index + direction
  if (index < 0 || target < 0 || target >= order.length) return order
  const next = [...order]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}
export function orderProjects(projects: Project[], order: string[]): Project[] {
  const ranks = new Map(order.map((id, i) => [id, i]))
  return [...projects].sort(
    (a, b) => (ranks.get(a.id) ?? order.length) - (ranks.get(b.id) ?? order.length),
  )
}
export function orderStatuses(
  statuses: ProjectStatus[],
  issues: Issue[],
  override: string[] = [],
): ProjectStatus[] {
  const known = new Map(statuses.map((s) => [s.name, s]))
  issues.forEach((i) => {
    if (!known.has(i.status)) known.set(i.status, { id: i.status, name: i.status })
  })
  const names = [...new Set([...override.filter((name) => known.has(name)), ...known.keys()])]
  return names.map((name) => known.get(name)!)
}
export function sortIssues(issues: Issue[], sort: IssueSort, statuses: ProjectStatus[]): Issue[] {
  const ranks = new Map(statuses.map((s, index) => [s.name, index]))
  return [...issues].sort((a, b) => {
    if (sort === 'title') return a.title.localeCompare(b.title)
    if (sort === 'created') return b.createdAt.localeCompare(a.createdAt)
    if (sort === 'status') {
      const difference = (ranks.get(a.status) ?? ranks.size) - (ranks.get(b.status) ?? ranks.size)
      if (difference) return difference
    }
    return b.updatedAt.localeCompare(a.updatedAt)
  })
}
