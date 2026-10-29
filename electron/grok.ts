import { createHash } from 'node:crypto'
import type { GrokSettingsInput } from '../src/shared/grok'
import type { IssueDetail, IssueNotification } from '../src/shared/types'
import { IssueCache } from './issue-cache'
import { GrokConfig } from './grok-config'
import { notificationEvent } from './grok-event'
import { postWebhook, WebhookError } from './grok-http'
export class GrokDispatcher {
  private running: Promise<void> | null = null
  private stopped = false
  private controller = new AbortController()
  constructor(
    private cache: IssueCache,
    private config: GrokConfig,
    private content: (notification: IssueNotification) => Promise<IssueDetail>,
    private requestOptions: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
  ) {}
  kick() {
    if (this.running || this.stopped) return this.running ?? Promise.resolve()
    this.running = this.run().finally(() => {
      this.running = null
    })
    return this.running
  }
  stop() {
    this.stopped = true
    this.controller.abort()
  }
  private async run() {
    while (!this.stopped) {
      const target = this.config.target()
      if (!target) return
      const job = this.cache.nextEmail(target.revision)
      if (!job) return
      let started = false,
        accepted = false
      try {
        const { settings, authorization } = await this.config.credentials()
        let detail: IssueDetail | null = null
        try {
          detail = await this.content(job.notification)
        } catch {
          /* Preserve event metadata if GitHub is unavailable. */
        }
        const payload = notificationEvent(job.notification, job.projectTitle, detail)
        if (this.stopped || this.config.target()?.revision !== job.revision) return
        if (!(await this.cache.startEmail(job.id))) continue
        started = true
        await postWebhook(settings.webhookUrl, authorization, payload, {
          ...this.requestOptions,
          signal: this.controller.signal,
          eventId: createHash('sha256').update(job.id).digest('hex'),
        })
        accepted = true
        await this.cache.finishEmail(job.id, 'sent')
      } catch (error) {
        const failure = error instanceof WebhookError ? error : undefined
        const uncertain = started && (accepted || !failure || failure.outcome === 'uncertain')
        const retryable =
          failure && (!failure.status || failure.status === 429 || failure.status >= 500)
        const state = uncertain
          ? 'uncertain'
          : started && retryable && job.attempts < 5
            ? 'pending'
            : 'failed'
        await this.cache
          .finishEmail(
            job.id,
            state,
            uncertain
              ? 'Esito webhook incerto. Verifica Grok prima di ritentare.'
              : failure?.message ||
                  'Impossibile preparare l’invio. Verifica configurazione Grok e disponibilità del disco.',
            Date.now() + Math.min(30 * 60_000, 60_000 * 2 ** Math.max(0, job.attempts - 1)),
          )
          .catch(() => {})
        if (!started || this.cache.nextEmail(target.revision)?.id === job.id) return
      }
    }
  }
}
export async function testWebhook(config: GrokConfig, input: GrokSettingsInput) {
  const { settings, authorization } = await config.credentials(input)
  await postWebhook(settings.webhookUrl, authorization, {
    tipo: 'nota',
    sorgente: 'Issue Atlas',
    contenuto: 'Prova webhook: verifica della connessione, nessuna attività da creare.',
  })
  return 1
}
export async function verifyWebhook(config: GrokConfig, input: GrokSettingsInput) {
  await config.credentials(input)
}
