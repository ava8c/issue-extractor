import type { Issue, IssueLocation, IssueNotification, NotificationType } from './types'

export const ACTIVITY_INTERVAL = 2 * 60_000
export const NOTIFICATION_LIMIT = 500

export interface ProjectNotificationPreferences {
  excludedStatuses: string[]
  includeDrafts: boolean
}

export function readNotificationPreferences(value?: unknown): ProjectNotificationPreferences {
  const entry = value as Partial<ProjectNotificationPreferences> | null | undefined
  return {
    excludedStatuses: Array.isArray(entry?.excludedStatuses)
      ? [
          ...new Set(
            entry.excludedStatuses.filter((name) => typeof name === 'string' && name.length > 0),
          ),
        ]
      : [],
    includeDrafts: entry?.includeDrafts !== false,
  }
}

export function notificationsEnabled(
  issue: Issue,
  preferences: ProjectNotificationPreferences,
): boolean {
  return (
    !preferences.excludedStatuses.includes(issue.status) &&
    (preferences.includeDrafts || issue.kind !== 'draft')
  )
}

const issueState = (state: string) =>
  ({ OPEN: 'Aperta', CLOSED: 'Chiusa', MERGED: 'Unita', DRAFT: 'Bozza' })[state] ?? state

export function detectActivity(
  projectId: string,
  previous: Issue[] | undefined,
  current: Issue[],
  now: number,
): IssueNotification[] {
  if (!previous) return []
  const old = new Map(previous.map((issue) => [issue.id, issue]))
  const notifications: IssueNotification[] = []
  for (const issue of current) {
    const before = old.get(issue.id)
    const add = (type: NotificationType, extra: Partial<IssueNotification> = {}) => {
      const fingerprint =
        type === 'comment'
          ? [type, issue.id, issue.commentCount, issue.updatedAt]
          : [type, projectId, issue.id, now]
      notifications.push({
        id: JSON.stringify(fingerprint),
        projectId,
        issue: { ...issue, body: '' },
        type,
        createdAt: now,
        read: false,
        ...extra,
      })
    }
    if (!before) {
      add('new-issue')
      continue
    }
    if (before.status !== issue.status || before.state !== issue.state)
      add('status', {
        fromStatus: before.status !== issue.status ? before.status : issueState(before.state),
        toStatus: before.status !== issue.status ? issue.status : issueState(issue.state),
      })
    if (issue.commentCount > before.commentCount)
      add('comment', { newCommentCount: issue.commentCount - before.commentCount })
  }
  return notifications
}

export function findIssueLocations(
  number: number,
  projectIds: string[],
  indexes: Record<string, { issues: Issue[] }>,
): IssueLocation[] {
  if (!Number.isSafeInteger(number) || number <= 0) return []
  return [...new Set(projectIds)].flatMap((projectId) =>
    (indexes[projectId]?.issues ?? [])
      .filter((issue) => issue.number === number && issue.kind !== 'draft')
      .map((issue) => ({ projectId, issue })),
  )
}
