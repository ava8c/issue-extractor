import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import type {
  CachedProject,
  CachedWorkspace,
  Issue,
  ProjectLayout,
  Workspace,
  IssueNotification,
  NotificationState,
} from '../src/shared/types'
import { issueScope } from '../src/shared/loading'
import { metricSnapshot } from '../src/shared/metrics'
import {
  detectActivity,
  findIssueLocations,
  NOTIFICATION_LIMIT,
  notificationsEnabled,
  isOwnNotification,
  readNotificationLogin,
  readNotificationPreferences,
  type ProjectNotificationPreferences,
} from '../src/shared/activity'
import {
  emptyEmailStatus,
  type EmailJob,
  type EmailJobState,
  type EmailTarget,
} from '../src/shared/email'

interface Snapshot extends CachedProject {
  projectId: string
}
interface CacheFile {
  version: 1
  scope: string
  snapshots: Record<string, Snapshot>
  workspace?: CachedWorkspace
  activity?: Record<string, { issues: Issue[]; syncedAt: number }>
  notifications?: IssueNotification[]
  emailJobs?: EmailJob[]
  notificationPreferences?: Record<string, ProjectNotificationPreferences>
  notificationLogin?: string
  layouts?: Record<string, ProjectLayout>
}

// Only list metadata is persisted. Bodies, comments, assets and tokens stay out of this file.
export class IssueCache {
  private snapshots = new Map<string, Snapshot>()
  private layouts = new Map<string, ProjectLayout>()
  private pending = Promise.resolve()
  private revision = 0
  private persistedRevision = 0
  private disposed = false
  private workspace: CachedWorkspace | null = null
  private activity: Record<string, { issues: Issue[]; syncedAt: number }> = {}
  private notificationItems: IssueNotification[] = []
  private emailTarget: EmailTarget | null = null
  private emailJobs: EmailJob[] = []
  private projectNotifications: Record<string, ProjectNotificationPreferences> = {}
  private notificationLogin = ''

  constructor(
    private path: string,
    private scope: string,
  ) {}

  async load() {
    try {
      const file = JSON.parse(await readFile(this.path, 'utf8')) as CacheFile
      if (file.version !== 1 || file.scope !== this.scope) return
      this.notificationLogin = readNotificationLogin(file.notificationLogin)
      for (const [id, layout] of Object.entries(file.layouts ?? {}))
        if (Array.isArray(layout?.statuses) && typeof layout.statusFieldName === 'string')
          this.layouts.set(id, layout)
      for (const [projectId, preferences] of Object.entries(file.notificationPreferences ?? {}))
        this.projectNotifications[projectId] = readNotificationPreferences(preferences)
      this.emailJobs = Array.isArray(file.emailJobs)
        ? file.emailJobs
            .filter((job) => job?.id && job.notification?.id && job.recipient && job.revision)
            .map((job) =>
              job.state === 'sending'
                ? {
                    ...job,
                    state: 'uncertain' as const,
                    error:
                      'Invio interrotto: esito dell’invio non confermato. Verifica Grok prima di riprovare.',
                  }
                : job,
            )
        : []
      for (const [projectId, entry] of Object.entries(file.activity ?? {})) {
        if (Array.isArray(entry?.issues) && Number.isFinite(entry.syncedAt))
          this.activity[projectId] = entry
      }
      this.notificationItems = Array.isArray(file.notifications)
        ? file.notifications
            .filter(
              (item) =>
                item &&
                typeof item.id === 'string' &&
                item.issue?.id &&
                Number.isFinite(item.createdAt) &&
                ['status', 'new-issue', 'comment'].includes(item.type),
            )
            .slice(0, NOTIFICATION_LIMIT)
        : []
      if (
        file.workspace &&
        Array.isArray(file.workspace.workspace?.projects) &&
        Number.isFinite(file.workspace.syncedAt)
      )
        this.workspace = file.workspace
      for (const [key, snapshot] of Object.entries(file.snapshots)) {
        if (!Array.isArray(snapshot.issues) || !Number.isFinite(snapshot.syncedAt)) continue
        this.snapshots.set(key, snapshot)
        if (snapshot.layout && !this.layouts.has(snapshot.projectId))
          this.layouts.set(snapshot.projectId, snapshot.layout)
      }
    } catch {
      // Missing or corrupt cache: the next sync rebuilds it from GitHub.
    }
  }

  get(projectId: string, statuses?: string[]): CachedProject | null {
    const exact = this.snapshots.get(issueScope(projectId, statuses))
    if (exact) return exact
    const all = statuses && this.snapshots.get(issueScope(projectId))
    return all
      ? { ...all, issues: all.issues.filter((issue) => statuses!.includes(issue.status)) }
      : null
  }

  previous(projectId: string): Issue[] {
    const issues = new Map<string, Issue>()
    const snapshots = [...this.snapshots.values()]
      .filter((snapshot) => snapshot.projectId === projectId)
      .sort((a, b) => a.syncedAt - b.syncedAt)
    for (const snapshot of snapshots)
      for (const issue of snapshot.issues) issues.set(issue.id, issue)
    return [...issues.values()]
  }

  available(projectId: string, statuses?: string[]): CachedProject | null {
    const exact = this.get(projectId, statuses)
    if (exact) return exact
    const snapshots = [...this.snapshots.values()].filter(
      (snapshot) => snapshot.projectId === projectId,
    )
    const activity = this.activity[projectId]
    if (!snapshots.length && !activity) return null
    let issues = new Map<string, Issue>()
    for (const snapshot of [...snapshots, ...(activity ? [activity] : [])].sort(
      (a, b) => a.syncedAt - b.syncedAt,
    )) {
      if (snapshot === activity) {
        // The activity index is complete, but it does not fetch labels.
        issues = new Map(
          snapshot.issues.map((issue) => [
            issue.id,
            {
              ...issue,
              labels: issues.get(issue.id)?.labels ?? issue.labels,
            },
          ]),
        )
      } else {
        for (const issue of snapshot.issues) issues.set(issue.id, issue)
      }
    }
    return {
      issues: [...issues.values()].filter((issue) => !statuses || statuses.includes(issue.status)),
      // A union of filtered lists is partial: always refresh it when GitHub is available.
      syncedAt: 0,
      layout: this.getLayout(projectId),
    }
  }

  setLayout(projectId: string, layout: ProjectLayout) {
    this.layouts.set(projectId, layout)
  }

  getWorkspace() {
    return this.workspace
  }

  getLayout(projectId: string) {
    return this.layouts.get(projectId)
  }

  activityTimestamp(projectId: string) {
    return this.activity[projectId]?.syncedAt ?? 0
  }

  activityIssues(projectId: string) {
    return this.activity[projectId]?.issues ?? []
  }

  projectMetrics(projectIds: string[]) {
    return [...new Set(projectIds)].map((projectId) => {
      // Filtered list snapshots cannot establish totals for the whole project.
      const activity = this.activity[projectId]
      const fullList = this.get(projectId)
      const snapshot =
        !activity || (fullList && fullList.syncedAt > activity.syncedAt) ? fullList : activity
      return metricSnapshot(
        projectId,
        snapshot?.issues ?? [],
        snapshot?.syncedAt ?? null,
        this.layouts.get(projectId)?.statuses,
      )
    })
  }

  findIssues(number: number, projectIds: string[]) {
    return findIssueLocations(number, projectIds, this.activity)
  }

  notifications(): NotificationState {
    const times = Object.values(this.activity).map((entry) => entry.syncedAt)
    return {
      items: this.notificationItems,
      lastCheckedAt: times.length ? Math.max(...times) : null,
    }
  }

  getNotificationPreferences(projectId: string): ProjectNotificationPreferences {
    return readNotificationPreferences(this.projectNotifications[projectId])
  }

  getNotificationLogin(): string {
    return this.notificationLogin
  }

  async setNotificationLogin(login: string) {
    if (this.disposed) throw new Error('La connessione è cambiata. Riapri le impostazioni.')
    const normalized = readNotificationLogin(login)
    if (this.notificationLogin === normalized) return
    this.notificationLogin = normalized
    this.notificationItems = this.notificationItems.map((item) =>
      isOwnNotification(item, this.notificationLogin) ? { ...item, read: true } : item,
    )
    await this.persist(true)
  }

  async setNotificationPreferences(
    projectId: string,
    value: Partial<ProjectNotificationPreferences>,
  ) {
    if (this.disposed) throw new Error('La connessione è cambiata. Riapri le preferenze notifiche.')
    if (typeof projectId !== 'string' || !projectId.length) throw new Error('Progetto non valido.')
    const preferences = readNotificationPreferences(value)
    this.projectNotifications[projectId] = preferences
    this.cancelExcludedEmails()
    await this.persist(true)
    return this.getNotificationPreferences(projectId)
  }

  private emailAllowed(job: EmailJob) {
    const preferences = this.getNotificationPreferences(job.notification.projectId)
    const latest = this.activity[job.notification.projectId]?.issues.find(
      (issue) => issue.id === job.notification.issue.id,
    )
    return (
      notificationsEnabled(job.notification.issue, preferences) &&
      (!latest || notificationsEnabled(latest, preferences))
    )
  }

  private cancelExcludedEmails() {
    for (const job of this.emailJobs)
      if (['pending', 'failed'].includes(job.state) && !this.emailAllowed(job))
        job.state = 'cancelled'
  }

  async recordActivity(
    projectId: string,
    issues: Issue[],
    now = Date.now(),
    events = detectActivity(projectId, this.activity[projectId]?.issues, issues, now),
  ) {
    if (this.disposed) return []
    const known = new Set(this.notificationItems.map((notification) => notification.id))
    const preferences = this.getNotificationPreferences(projectId)
    const fresh = events
      .filter((event) => !known.has(event.id) && notificationsEnabled(event.issue, preferences))
      .map((event) =>
        isOwnNotification(event, this.notificationLogin) ? { ...event, read: true } : event,
      )
    this.notificationItems = [...fresh, ...this.notificationItems]
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
      .slice(0, NOTIFICATION_LIMIT)
    this.activity[projectId] = {
      issues: issues.map((issue) => ({ ...issue, body: '', labels: [] })),
      syncedAt: now,
    }
    this.cancelExcludedEmails()
    if (this.emailTarget)
      for (const notification of fresh)
        for (const recipient of this.emailTarget.recipients) {
          const id = JSON.stringify([notification.id, this.emailTarget.revision, recipient])
          if (!this.emailJobs.some((job) => job.id === id))
            this.emailJobs.push({
              id,
              revision: this.emailTarget.revision,
              notification,
              recipient,
              state: 'pending',
              attempts: 0,
              nextAttemptAt: now,
              projectTitle:
                this.workspace?.workspace.projects.find((project) => project.id === projectId)
                  ?.title ?? projectId,
            })
        }
    await this.persist(!!this.emailTarget && fresh.length > 0)
    // Preferences or the connection may have changed while the write was pending.
    const accepted = new Set(fresh.map((event) => event.id))
    return this.disposed
      ? []
      : this.notificationItems.filter(
          (event) =>
            accepted.has(event.id) &&
            notificationsEnabled(event.issue, this.getNotificationPreferences(projectId)),
        )
  }

  async configureEmail(target: EmailTarget | null) {
    this.emailTarget = target
    let changed = false
    for (const job of this.emailJobs)
      if (job.revision !== target?.revision && ['pending', 'sending'].includes(job.state)) {
        job.state = 'cancelled'
        changed = true
      }
    if (changed) await this.persist(true)
  }

  nextEmail(revision: string, now = Date.now()) {
    if (this.disposed || this.emailTarget?.revision !== revision) return undefined
    return this.emailJobs.find(
      (job) =>
        job.revision === revision &&
        job.state === 'pending' &&
        job.nextAttemptAt <= now &&
        this.emailAllowed(job),
    )
  }

  async startEmail(id: string) {
    const job = this.emailJobs.find((job) => job.id === id)
    if (
      this.disposed ||
      !job ||
      job.state !== 'pending' ||
      this.emailTarget?.revision !== job.revision ||
      !this.emailAllowed(job)
    )
      return false
    job.state = 'sending'
    job.attempts++
    await this.persist(true)
    if (this.disposed || job.state !== 'sending' || this.emailTarget?.revision !== job.revision)
      return false
    if (!this.emailAllowed(job)) {
      job.state = 'cancelled'
      await this.persist(true)
      return false
    }
    return true
  }

  async finishEmail(id: string, state: EmailJobState, error?: string, nextAttemptAt = 0) {
    const job = this.emailJobs.find((job) => job.id === id)
    if (this.disposed || !job || job.state === 'cancelled') return
    job.state = state
    job.error = error
    job.nextAttemptAt = nextAttemptAt
    if (state === 'sent') job.sentAt = Date.now()
    const terminal = this.emailJobs.filter((entry) => ['sent', 'cancelled'].includes(entry.state))
    if (terminal.length > 500) {
      const evict = new Set(terminal.slice(0, terminal.length - 500).map((entry) => entry.id))
      this.emailJobs = this.emailJobs.filter((entry) => !evict.has(entry.id))
    }
    await this.persist(true)
  }

  deliveryHistory() {
    return this.emailJobs
      .slice(-100)
      .reverse()
      .map((job) => ({ ...job }))
  }

  emailStatus(revision: string) {
    const status = emptyEmailStatus()
    for (const job of this.emailJobs.filter((entry) => entry.revision === revision)) {
      if (job.state === 'pending' || job.state === 'sending') status.pending++
      else if (job.state === 'sent') status.sent++
      else if (job.state === 'failed') status.failed++
      else if (job.state === 'uncertain') status.uncertain++
      if (job.error && job.state !== 'cancelled') status.lastError = job.error
      if (job.sentAt) status.lastSentAt = Math.max(status.lastSentAt ?? 0, job.sentAt)
    }
    return status
  }

  async retryEmail(revision: string, includeUncertain = false) {
    for (const job of this.emailJobs)
      if (
        job.revision === revision &&
        this.emailAllowed(job) &&
        (job.state === 'failed' || (includeUncertain && job.state === 'uncertain'))
      ) {
        job.state = 'pending'
        job.attempts = 0
        job.nextAttemptAt = Date.now()
        job.error = undefined
      }
    await this.persist(true)
  }

  async markNotificationsRead(ids: string[]): Promise<NotificationState> {
    if (this.disposed) return this.notifications()
    const selected = new Set(ids)
    this.notificationItems = this.notificationItems.map((item) =>
      selected.has(item.id) ? { ...item, read: true } : item,
    )
    await this.persist()
    return this.notifications()
  }

  async saveWorkspace(workspace: Workspace) {
    if (this.disposed) return
    this.workspace = { workspace, syncedAt: Date.now() }
    await this.persist()
  }

  async save(projectId: string, statuses: string[] | undefined, issues: Issue[]) {
    if (this.disposed) return
    const key = issueScope(projectId, statuses)
    this.snapshots.delete(key)
    this.snapshots.set(key, {
      projectId,
      issues: issues.map((issue) => ({ ...issue, body: '' })),
      syncedAt: Date.now(),
      layout: this.layouts.get(projectId),
    })
    while (this.snapshots.size > 30) this.snapshots.delete(this.snapshots.keys().next().value!)
    await this.persist()
  }

  private async persist(strict = false) {
    const revision = ++this.revision
    this.pending = this.pending
      .catch(() => {})
      .then(async () => {
        if (this.disposed || this.persistedRevision >= revision) return
        // A single atomic write can cover updates queued before this write starts.
        // Strict callers still wait until a snapshot containing their update is durable.
        const writingRevision = this.revision
        const contents = JSON.stringify({
          version: 1,
          scope: this.scope,
          snapshots: Object.fromEntries(this.snapshots),
          workspace: this.workspace,
          activity: this.activity,
          notifications: this.notificationItems,
          emailJobs: this.emailJobs,
          notificationPreferences: this.projectNotifications,
          notificationLogin: this.notificationLogin,
          layouts: Object.fromEntries(this.layouts),
        })
        await writeFile(`${this.path}.tmp`, contents, { mode: 0o600 })
        await rename(`${this.path}.tmp`, this.path)
        this.persistedRevision = writingRevision
      })
    // A disk failure must not hide successfully fetched issues.
    if (strict) await this.pending
    else await this.pending.catch(() => {})
  }

  async clear() {
    this.disposed = true
    this.snapshots.clear()
    this.layouts.clear()
    this.workspace = null
    this.activity = {}
    this.notificationItems = []
    this.emailJobs = []
    this.emailTarget = null
    this.projectNotifications = {}
    this.notificationLogin = ''
    await this.pending.catch(() => {})
    await Promise.all(
      [this.path, `${this.path}.tmp`].map((path) =>
        unlink(path).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error
        }),
      ),
    )
  }
}
