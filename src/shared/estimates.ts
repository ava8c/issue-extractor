import type { Issue, IssueDetail } from './types'

export interface AISettings {
  enabled: boolean
  model: string
  hasKey: boolean
  maxInputChars: number
  maxOutputTokens: number
  dailyTokenBudget: number
  maxIssuesPerSync: number
  decisionThreshold: number
}
export interface AISettingsInput extends Omit<AISettings, 'hasKey'> {
  apiKey?: string
  removeKey?: boolean
}
export const defaultAISettings = (): AISettings => ({
  enabled: false,
  model: 'gpt-6-luna',
  hasKey: false,
  maxInputChars: 24000,
  maxOutputTokens: 1600,
  dailyTokenBudget: 100000,
  maxIssuesPerSync: 5,
  decisionThreshold: 0.9,
})
export interface ProjectEstimateSettings {
  enabled: boolean
  statuses: string[]
  includeClosed: boolean
  includeDrafts: boolean
  updatedSince: string
  hoursPerDay: number
  instructions: string
}
export const defaultProjectEstimates = (): ProjectEstimateSettings => ({
  enabled: false,
  statuses: [],
  includeClosed: false,
  includeDrafts: false,
  updatedSince: '',
  hoursPerDay: 8,
  instructions: '',
})
export interface EstimateEntry {
  sourceId: string
  min: number
  max: number
  unit: 'hours' | 'days'
  label: string
  excerpt: string
}
export interface EstimateResult {
  entries: EstimateEntry[]
  needsReview: boolean
  note: string
}
export interface EstimateSource {
  id: string
  text: string
}
export type EstimateAction = 'ignore' | 'add' | 'replace' | 'rebuild'
export interface EstimateDecision {
  sourceId: string
  action: EstimateAction
  confidence: number
}
export interface EstimateBaseline {
  commentCount: number
  lastCommentId?: string
}
export interface EstimateContent extends IssueDetail {
  delta?: boolean
}
export interface IssueEstimate extends EstimateResult {
  issueId: string
  projectId: string
  checkedAt: number
  model: string
  hoursPerDay: number
  state: 'pending' | 'ready' | 'none' | 'review' | 'error'
  error?: string
  monitoring?: boolean
}
export interface EstimateUsage {
  date: string
  requests: number
  inputTokens: number
  outputTokens: number
  chargedTokens: number
}
export interface EstimateState {
  items: IssueEstimate[]
  usage: EstimateUsage
  running: boolean
  dailyTokenBudget: number
}
export function estimateEligible(issue: Issue, settings: ProjectEstimateSettings) {
  return (
    settings.enabled &&
    settings.statuses.includes(issue.status) &&
    (settings.includeDrafts || issue.kind !== 'draft') &&
    (settings.includeClosed || !['CLOSED', 'MERGED'].includes(issue.state)) &&
    (!settings.updatedSince || issue.updatedAt.slice(0, 10) >= settings.updatedSince)
  )
}
const number = (value: number) =>
  new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 }).format(value)
export function formatEstimate(value: Pick<IssueEstimate, 'entries'> & { hoursPerDay?: number }) {
  if (!value.entries.length) return 'Nessuna stima'
  const days = value.entries.every((entry) => entry.unit === 'days')
  const total = value.entries.reduce(
    (sum, entry) =>
      sum + entry.max * (!days && entry.unit === 'days' ? (value.hoursPerDay ?? 8) : 1),
    0,
  )
  return `${number(total)} ${days ? 'gg' : 'h'}`
}
