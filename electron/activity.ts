import type {
  ActivitySyncResult,
  IssueNotification,
  IssueSearchResult,
  Project,
} from '../src/shared/types'
import { ACTIVITY_INTERVAL, detectActivity, notificationsEnabled } from '../src/shared/activity'
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
    private onNotifications?: (items: IssueNotification[]) => void,
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
      const now = Date.now()
      const layout = this.cache.getLayout(projectId) ?? (await this.github.projectLayout(projectId))
      this.cache.setLayout(projectId, layout)
      const issues = await this.github.activityItems(projectId, layout.statusFieldName)
      const since = this.cache.activityTimestamp(projectId)
      const previous = since ? this.cache.activityIssues(projectId) : undefined
      const events = detectActivity(projectId, previous, issues, now)
      try {
        await this.cache.setNotificationLogin(await this.github.authenticatedLogin())
      } catch {
        // Identity lookup must not block recording events or their delivery.
      }
      if (this.cache.getNotificationLogin()) {
        const old = new Map(previous?.map((issue) => [issue.id, issue]))
        const preferences = this.cache.getNotificationPreferences(projectId)
        await mapConcurrent(events, 2, async (event) => {
          if (event.type === 'new-issue' || !notificationsEnabled(event.issue, preferences)) return
          try {
            event.actors = await this.github.notificationActors(
              event,
              old.get(event.issue.id),
              since,
            )
          } catch {
            // Unknown authors (including older Enterprise schemas) must remain unread.
            event.actors = [null]
          }
        })
      }
      const fresh = await this.cache.recordActivity(projectId, issues, now, events)
      this.onNotifications?.(fresh)
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
