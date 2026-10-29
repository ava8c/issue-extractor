import type { IssueNotification } from './types'

export interface EmailTarget {
  revision: string
  recipients: string[]
}
export type EmailJobState = 'pending' | 'sending' | 'sent' | 'failed' | 'uncertain' | 'cancelled'
export interface EmailJob {
  id: string
  revision: string
  notification: IssueNotification
  projectTitle: string
  recipient: string
  state: EmailJobState
  attempts: number
  nextAttemptAt: number
  error?: string
  sentAt?: number
}
export interface EmailStatus {
  pending: number
  sent: number
  failed: number
  uncertain: number
  lastError?: string
  lastSentAt?: number
}
export const emptyEmailStatus = (): EmailStatus => ({
  pending: 0,
  sent: 0,
  failed: 0,
  uncertain: 0,
})
