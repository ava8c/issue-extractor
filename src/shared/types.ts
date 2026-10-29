export interface Settings {
  host: string
  organizations: string[]
  projectUrls: string[]
  hasToken: boolean
  assetHosts?: string[]
}
export interface SettingsInput extends Omit<Settings, 'hasToken'> {
  token?: string
}
export interface Project {
  id: string
  title: string
  number: number
  url: string
  owner: string
  description: string
  closed: boolean
}
export interface Issue {
  id: string
  number: number
  title: string
  body: string
  url: string
  repository: string
  state: string
  status: string
  labels: { name: string; color: string }[]
  commentCount: number
  createdAt: string
  updatedAt: string
  kind: 'issue' | 'draft' | 'pull-request'
  projectItemCreator?: Author | null
}
export interface ProjectStatus {
  id: string
  name: string
  color?: string
}
export interface ProjectLayout {
  statusFieldName: string
  statuses: ProjectStatus[]
}
export interface CachedProject {
  issues: Issue[]
  syncedAt: number
  layout?: ProjectLayout
}
export interface Author {
  login: string
  name?: string | null
}
export interface Comment {
  id: string
  body: string
  createdAt: string
  updatedAt: string
  author?: Author | null
}
export interface IssueDetail extends Issue {
  assignees?: Author[]
  author?: Author | null
  comments: Comment[]
  commentsComplete: boolean
}
export interface Asset {
  id: string
  url: string
  label: string
  kind: 'image' | 'file' | 'link'
  sources: string[]
}
export interface AssetResult {
  dataUrl: string
  mime: string
}
export interface ExportReport {
  canceled: boolean
  path?: string
  downloaded: number
  manual: number
}
export interface Workspace {
  projects: Project[]
  warnings: string[]
  login: string
}
export interface CachedWorkspace {
  workspace: Workspace
  syncedAt: number
}
export interface IssueLocation {
  projectId: string
  issue: Issue
}
export interface IssueSearchResult {
  matches: IssueLocation[]
  warnings: string[]
}
export type NotificationType = 'status' | 'new-issue' | 'comment'
export interface IssueNotification extends IssueLocation {
  id: string
  type: NotificationType
  createdAt: number
  read: boolean
  fromStatus?: string
  toStatus?: string
  newCommentCount?: number
  actors?: (Author | null)[]
}
export interface NotificationState {
  items: IssueNotification[]
  lastCheckedAt: number | null
  nativeError?: string
}
export interface ActivitySyncResult extends NotificationState {
  errors: string[]
}
export interface AtlasAPI {
  monitoringSettings: () => Promise<MonitoringSettings>
  saveMonitoringSettings: (input: MonitoringSettingsInput) => Promise<MonitoringSettings>
  verifyMonitoring: (input: MonitoringSettingsInput) => Promise<void>
  monitoringStatus: () => Promise<MonitoringStatus>
  retryMonitoring: () => Promise<void>
  handoffStatus: () => Promise<HandoffStatus>
  copyHandoff: (issue: IssueDetail) => Promise<void>
  onEstimates?: (callback: () => void) => () => void
  aiSettings: () => Promise<AISettings>
  saveAISettings: (input: AISettingsInput) => Promise<AISettings>
  aiModels: (input?: AISettingsInput) => Promise<string[]>
  projectEstimates: (projectId: string) => Promise<ProjectEstimateSettings>
  saveProjectEstimates: (
    projectId: string,
    settings: ProjectEstimateSettings,
  ) => Promise<ProjectEstimateSettings>
  estimates: (projectIds: string[]) => Promise<EstimateState>
  recalculateEstimate: (projectId: string, issueId: string) => Promise<void>
  onSettings?: (callback: () => void) => () => void
  onQuickSearch?: (callback: () => void) => () => void
  settings: () => Promise<Settings>
  saveSettings: (input: SettingsInput) => Promise<Settings>
  disconnect: () => Promise<void>
  testConnection: (input: SettingsInput) => Promise<string>
  projects: () => Promise<Workspace>
  cachedWorkspace: () => Promise<CachedWorkspace | null>
  projectLayout: (projectId: string) => Promise<ProjectLayout>
  cachedProject: (projectId: string, statuses?: string[]) => Promise<CachedProject | null>
  issues: (projectId: string, statusFieldName?: string, statuses?: string[]) => Promise<Issue[]>
  findIssues: (number: number, projectIds: string[]) => Promise<IssueSearchResult>
  notifications: () => Promise<NotificationState>
  onNotificationsChanged?: (callback: () => void) => () => void
  onNotificationOpen?: (callback: (location: IssueLocation) => void) => () => void
  projectMetrics: (projectIds: string[]) => Promise<ProjectMetricSnapshot[]>
  notificationPreferences: (projectId: string) => Promise<ProjectNotificationPreferences>
  saveNotificationPreferences: (
    projectId: string,
    preferences: ProjectNotificationPreferences,
  ) => Promise<ProjectNotificationPreferences>
  syncActivity: (projectIds: string[], force?: boolean) => Promise<ActivitySyncResult>
  markNotificationsRead: (ids: string[]) => Promise<NotificationState>
  grokHistory: () => Promise<EmailJob[]>
  grokSettings: () => Promise<GrokSettings>
  saveGrokSettings: (input: GrokSettingsInput) => Promise<GrokSettings>
  verifyGrok: (input: GrokSettingsInput) => Promise<void>
  testGrok: (input: GrokSettingsInput) => Promise<number>
  grokStatus: () => Promise<EmailStatus>
  retryGrok: (includeUncertain?: boolean) => Promise<void>
  issue: (issue: Issue) => Promise<IssueDetail>
  asset: (url: string) => Promise<AssetResult>
  copyImage: (url: string) => Promise<void>
  copyIssue: (issue: IssueDetail) => Promise<void>
  exportIssue: (issue: IssueDetail) => Promise<ExportReport>
  openExternal: (url: string) => Promise<void>
}
declare global {
  interface Window {
    atlas?: AtlasAPI
  }
}
import type { GrokSettings, GrokSettingsInput } from './grok'
import type { EmailStatus, EmailJob } from './email'
import type { MonitoringSettings, MonitoringSettingsInput, MonitoringStatus } from './monitoring'
import type { HandoffStatus } from './handoff'
import type { ProjectNotificationPreferences } from './activity'
import type { ProjectMetricSnapshot } from './metrics'
import type {
  AISettings,
  AISettingsInput,
  ProjectEstimateSettings,
  EstimateState,
} from './estimates'
