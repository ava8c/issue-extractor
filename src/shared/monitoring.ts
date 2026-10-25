import type { Issue } from './types'

export type MonitoringIssue = Pick<
  Issue,
  'id' | 'number' | 'title' | 'url' | 'repository' | 'status' | 'kind'
>

export interface MonitoringSettings {
  enabled: boolean
  baseUrl: string
  hasToken: boolean
}
export interface MonitoringSettingsInput extends Omit<MonitoringSettings, 'hasToken'> {
  token?: string
  removeToken?: boolean
}
export const defaultMonitoringSettings = (): MonitoringSettings => ({
  enabled: false,
  baseUrl: '',
  hasToken: false,
})
export interface MonitoringStatus {
  pending: number
  failed: number
  delivered: number
  lastError?: string
  running: boolean
}
export const emptyMonitoringStatus = (): MonitoringStatus => ({
  pending: 0,
  failed: 0,
  delivered: 0,
  running: false,
})
export interface MonitoringPayload {
  version: 1
  github_host: string
  project: { id: string; title: string; url: string }
  issue: {
    id: string
    number: number
    title: string
    url: string
    repository: string
    status: string
    kind: 'issue' | 'draft' | 'pull-request'
  }
  estimate: {
    state: 'ready' | 'review' | 'none'
    total_hours: number
    hours_per_day: number
    note: string
    entries: {
      source_id: string
      amount: number
      unit: 'hours' | 'days'
      label: string
      excerpt: string
    }[]
  }
  checked_at: string
}
