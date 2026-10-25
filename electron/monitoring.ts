import { createHash } from 'node:crypto'
import { readFile, writeFile, rename, unlink } from 'node:fs/promises'
import type { Project } from '../src/shared/types'
import type { IssueEstimate } from '../src/shared/estimates'
import type {
  MonitoringPayload,
  MonitoringStatus,
  MonitoringSettingsInput,
  MonitoringIssue,
} from '../src/shared/monitoring'
import { MonitoringConfig } from './monitoring-config'

export interface MonitoringCandidate {
  issue: MonitoringIssue
  estimate: IssueEstimate
}
interface Delivery {
  payload: MonitoringPayload
  fingerprint: string
  sent?: string
  attempts: number
  retryAt: number
  error?: string
}
const fingerprint = (payload: MonitoringPayload) =>
  createHash('sha256')
    .update(JSON.stringify({ ...payload, checked_at: undefined }))
    .digest('hex')
export function monitoringPayload(
  host: string,
  project: Project,
  { issue, estimate }: MonitoringCandidate,
): MonitoringPayload {
  if (!['ready', 'review', 'none'].includes(estimate.state))
    throw new Error('Stima non disponibile per l’invio.')
  return {
    version: 1,
    github_host: new URL(host).origin,
    project: { id: project.id, title: project.title, url: project.url },
    issue: {
      id: issue.id,
      number: issue.number,
      title: issue.title,
      url: issue.url,
      repository: issue.repository,
      status: issue.status,
      kind: issue.kind,
    },
    estimate: {
      state: estimate.state as MonitoringPayload['estimate']['state'],
      total_hours: estimate.entries.reduce(
        (sum, entry) => sum + entry.max * (entry.unit === 'days' ? estimate.hoursPerDay : 1),
        0,
      ),
      hours_per_day: estimate.hoursPerDay,
      note: estimate.note,
      entries: estimate.entries.map((entry) => ({
        source_id: entry.sourceId,
        amount: entry.max,
        unit: entry.unit,
        label: entry.label,
        excerpt: entry.excerpt,
      })),
    },
    checked_at: new Date(estimate.checkedAt).toISOString(),
  }
}
async function request(
  baseUrl: string,
  token: string,
  signal: AbortSignal,
  payload?: MonitoringPayload,
) {
  let response: Response
  try {
    response = await fetch(`${baseUrl}/api/v1/${payload ? 'estimate-inbox' : 'integration'}`, {
      method: payload ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: payload ? JSON.stringify(payload) : undefined,
      redirect: 'error',
      credentials: 'omit',
      signal,
    })
  } catch {
    throw new Error('Monitoraggio non raggiungibile: controlla URL, rete e certificato HTTPS.')
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(
      response.status === 401 || response.status === 403
        ? 'Chiave API Monitoraggio non valida o revocata.'
        : response.status === 429
          ? 'Monitoraggio ha limitato gli invii. Riproveremo più tardi.'
          : `Monitoraggio ha rifiutato l’invio (HTTP ${response.status}).`,
    )
  }
  // Responses are small and must identify this protocol; an HTML login page is not an ACK.
  const reader = response.body?.getReader()
  let raw = ''
  if (reader) {
    const decoder = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      raw += decoder.decode(value, { stream: true })
      if (raw.length > 4096) {
        await reader.cancel()
        throw new Error('Risposta Monitoraggio non valida.')
      }
    }
  }
  let result: any
  try {
    result = JSON.parse(raw)
  } catch {
    throw new Error('Risposta Monitoraggio non valida: verifica l’URL base.')
  }
  if (
    !result ||
    typeof result !== 'object' ||
    result.version !== 1 ||
    (payload ? !['received', 'duplicate', 'stale'].includes(result.status) : result.status !== 'ok')
  )
    throw new Error('Risposta Monitoraggio non valida: verifica l’URL base.')
}
export async function verifyMonitoring(config: MonitoringConfig, input: MonitoringSettingsInput) {
  const credentials = await config.credentials(input)
  await request(credentials.baseUrl, credentials.token, AbortSignal.timeout(10_000))
}
export class MonitoringService {
  private records: Record<string, Delivery> = {}
  private destination = ''
  private writing = Promise.resolve()
  private running?: Promise<void>
  private abort = new AbortController()
  private stopped = false
  constructor(
    private path: string,
    private scope: string,
    private config: MonitoringConfig,
  ) {}
  async load() {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8'))
      if (data.version === 1 && data.scope === this.scope) {
        this.destination = data.destination
        this.records = data.records
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error(
          'Coda Monitoraggio non leggibile. Ripristina il file prima di inviare altre stime.',
        )
    }
  }
  private persist() {
    const value = JSON.stringify({
      version: 1,
      scope: this.scope,
      destination: this.destination,
      records: this.records,
    })
    this.writing = this.writing
      .catch(() => {})
      .then(async () => {
        await writeFile(`${this.path}.tmp`, value, { mode: 0o600 })
        await rename(`${this.path}.tmp`, this.path)
      })
    return this.writing
  }
  async sync(payloads: MonitoringPayload[]) {
    if (this.stopped || !this.config.settings().enabled) return
    const destination = this.config.settings().baseUrl
    let changed = false
    if (this.destination !== destination) {
      this.destination = destination
      this.records = {}
      changed = true
    }
    for (const payload of payloads) {
      const key = JSON.stringify([payload.github_host, payload.project.id, payload.issue.id])
      const previous = this.records[key]
      if (!previous && payload.estimate.state === 'none') continue
      const next = fingerprint(payload)
      if (previous?.fingerprint === next) continue
      this.records[key] = { payload, fingerprint: next, attempts: 0, retryAt: 0 }
      changed = true
    }
    if (changed) await this.persist()
  }
  status(): MonitoringStatus {
    const records = Object.values(this.records)
    return {
      pending: records.filter((item) => item.sent !== item.fingerprint && !item.error).length,
      failed: records.filter((item) => item.sent !== item.fingerprint && item.error).length,
      delivered: records.filter((item) => item.sent === item.fingerprint).length,
      lastError: records.find((item) => item.error)?.error,
      running: !!this.running,
    }
  }
  async retry() {
    for (const item of Object.values(this.records)) {
      item.retryAt = 0
      item.error = undefined
    }
    await this.persist()
    await this.flush()
  }
  flush(): Promise<void> {
    if (this.running) return this.running
    if (
      this.stopped ||
      !this.config.settings().enabled ||
      this.destination !== this.config.settings().baseUrl
    )
      return Promise.resolve()
    this.running = this.deliver().finally(() => {
      this.running = undefined
    })
    return this.running
  }
  private async deliver() {
    for (const [key, item] of Object.entries(this.records)
      .filter(([, item]) => item.sent !== item.fingerprint && item.retryAt <= Date.now())
      .slice(0, 20)) {
      if (
        this.stopped ||
        !this.config.settings().enabled ||
        this.destination !== this.config.settings().baseUrl
      )
        break
      const destination = this.destination
      try {
        const credentials = await this.config.credentials()
        if (credentials.baseUrl !== destination || this.stopped || !this.config.settings().enabled)
          break
        await request(
          destination,
          credentials.token,
          AbortSignal.any([this.abort.signal, AbortSignal.timeout(10_000)]),
          item.payload,
        )
        if (this.records[key] === item) {
          item.sent = item.fingerprint
          item.error = undefined
        }
      } catch (error) {
        if (this.stopped) break
        if (this.records[key] === item) {
          item.attempts++
          item.retryAt = Date.now() + Math.min(30, 2 ** Math.min(item.attempts - 1, 5)) * 60_000
          item.error = error instanceof Error ? error.message : 'Invio Monitoraggio non riuscito.'
        }
      }
      if (!this.stopped) await this.persist()
    }
  }
  stop() {
    this.stopped = true
    this.abort.abort()
  }
  async clear() {
    this.stop()
    await this.running?.catch(() => {})
    await this.writing.catch(() => {})
    await unlink(this.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}
