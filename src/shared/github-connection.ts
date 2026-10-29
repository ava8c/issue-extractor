import type { AtlasAPI, IssueDetail, Settings } from './types'
import { GITHUB_UNAVAILABLE, isGitHubUnavailable } from './errors'

// One controller per saved connection. Local APIs remain available while GitHub is unreachable.
export function githubConnection(
  source: AtlasAPI,
  settings: Settings,
  changed: (offline: boolean) => void,
) {
  let offline = false
  let disposed = false
  let generation = 0
  let checking: Promise<boolean> | null = null
  const details = new Map<string, IssueDetail>()
  function publish(value: boolean) {
    if (disposed || offline === value) return
    offline = value
    changed(value)
  }
  async function remote<T>(read: () => Promise<T>): Promise<T> {
    if (offline) throw new Error(GITHUB_UNAVAILABLE)
    const current = generation
    try {
      return await read()
    } catch (error) {
      if (current === generation && isGitHubUnavailable(error)) publish(true)
      throw error
    }
  }
  function warnings(values: string[], current: number) {
    if (current === generation && values.some(isGitHubUnavailable)) publish(true)
    return values.filter((value) => !isGitHubUnavailable(value))
  }
  const api: AtlasAPI = {
    ...source,
    projects: () => remote(() => source.projects()),
    projectLayout: async (id) => {
      if (offline) {
        const snapshot = await source.cachedProject(id)
        if (snapshot?.layout) return snapshot.layout
      }
      return remote(() => source.projectLayout(id))
    },
    issues: (id, field, statuses) => remote(() => source.issues(id, field, statuses)),
    asset: (url) => remote(() => source.asset(url)),
    issue: async (issue) => {
      try {
        const detail = await remote(() => source.issue(issue))
        if (!disposed) {
          details.delete(issue.id)
          details.set(issue.id, detail)
          while (details.size > 20) details.delete(details.keys().next().value!)
        }
        return detail
      } catch (error) {
        const cached = details.get(issue.id)
        if (isGitHubUnavailable(error) && cached) return { ...cached, status: issue.status }
        throw error
      }
    },
    syncActivity: async (ids, force) => {
      if (offline) return { ...(await source.notifications()), errors: [] }
      const current = generation
      try {
        const result = await remote(() => source.syncActivity(ids, force))
        return { ...result, errors: warnings(result.errors, current) }
      } catch (error) {
        if (isGitHubUnavailable(error)) return { ...(await source.notifications()), errors: [] }
        throw error
      }
    },
    findIssues: async (number, ids) => {
      if (offline) {
        const snapshots = await Promise.all(ids.map((id) => source.cachedProject(id)))
        return {
          matches: snapshots.flatMap((snapshot, index) =>
            (snapshot?.issues ?? [])
              .filter((issue) => issue.number === number)
              .map((issue) => ({ projectId: ids[index], issue })),
          ),
          warnings: [],
        }
      }
      const current = generation
      const result = await remote(() => source.findIssues(number, ids))
      return { ...result, warnings: warnings(result.warnings, current) }
    },
  }
  return {
    api,
    activate() {
      disposed = false
    },
    check() {
      if (checking) return checking
      checking = (async () => {
        // Deduplicate even sources that throw synchronously.
        await Promise.resolve()
        try {
          await source.testConnection(settings)
          generation++
          publish(false)
          return true
        } catch (error) {
          // A permission/token error still means GitHub is reachable.
          generation++
          publish(isGitHubUnavailable(error))
          if (!isGitHubUnavailable(error)) throw error
          return false
        } finally {
          checking = null
        }
      })()
      return checking
    },
    dispose() {
      disposed = true
      details.clear()
    },
  }
}
