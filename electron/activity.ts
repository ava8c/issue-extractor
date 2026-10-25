import type { ActivitySyncResult, IssueSearchResult, Project } from '../src/shared/types'
import { ACTIVITY_INTERVAL } from '../src/shared/activity'
import { limitConcurrency, mapConcurrent } from '../src/shared/loading'
import { GitHubClient } from './github'
import { IssueCache } from './issue-cache'

export class ActivityService {
  private requests = new Map<string, Promise<void>>()
  private run = limitConcurrency(2)

  constructor(
    private github: GitHubClient,
    private cache: IssueCache,
    private afterSync?: () => void,
  ) {}

  async sync(projects: Project[], force = false): Promise<ActivitySyncResult> {
    const errors: string[] = []
    await mapConcurrent(projects, 2, async (project) => {
      if (!force && Date.now() - this.cache.activityTimestamp(project.id) < ACTIVITY_INTERVAL)
        return
      try {
        await this.syncProject(project.id)
      } catch (error) {
        errors.push(`${project.title}: ${(error as Error).message}`)
      }
    })
    this.afterSync?.()
    return { ...this.cache.notifications(), errors }
  }

  private async syncProject(projectId: string) {
    const pending = this.requests.get(projectId)
    if (pending) return pending
    const request = this.run(async () => {
      const layout = this.cache.getLayout(projectId) ?? (await this.github.projectLayout(projectId))
      this.cache.setLayout(projectId, layout)
      const issues = await this.github.activityItems(projectId, layout.statusFieldName)
      await this.cache.recordActivity(projectId, issues)
    })
    this.requests.set(projectId, request)
    try {
      await request
    } finally {
      if (this.requests.get(projectId) === request) this.requests.delete(projectId)
    }
  }

  async find(number: number, projects: Project[]): Promise<IssueSearchResult> {
    if (!Number.isSafeInteger(number) || number <= 0) return { matches: [], warnings: [] }
    // Keystrokes use the local index; background polling owns freshness.
    // Only an unindexed project needs a network scan during lookup.
    const result = await this.sync(
      projects.filter((project) => !this.cache.activityTimestamp(project.id)),
    )
    return {
      matches: this.cache.findIssues(
        number,
        projects.map((project) => project.id),
      ),
      warnings: result.errors,
    }
  }
}
