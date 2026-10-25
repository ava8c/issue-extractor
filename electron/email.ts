import nodemailer from 'nodemailer'
import type SMTPPool from 'nodemailer/lib/smtp-pool'
import { createHash } from 'node:crypto'
import type { EmailSettingsInput } from '../src/shared/email'
import type { IssueDetail, IssueNotification } from '../src/shared/types'
import { IssueCache } from './issue-cache'
import { EmailConfig } from './email-config'
import { notificationEmail } from './email-message'

export function smtpTransport(settings: EmailSettingsInput, password: string, ca?: string) {
  const options: SMTPPool.Options = {
    pool: true,
    maxConnections: 1,
    maxMessages: 50,
    maxRequeues: 0,
    host: settings.host,
    port: settings.port,
    secure: settings.security === 'tls',
    requireTLS: settings.security === 'starttls',
    auth: settings.username ? { user: settings.username, pass: password } : undefined,
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2', ...(ca ? { ca } : {}) },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    disableFileAccess: true,
    disableUrlAccess: true,
  }
  return nodemailer.createTransport(options)
}
export function smtpFailure(error: unknown) {
  const e = error as {
    code?: string
    originalCode?: string
    responseCode?: number
    command?: string
    timeoutType?: string
  }
  if (e.code === 'EAUTH')
    return {
      state: 'failed' as const,
      message: 'Autenticazione SMTP non riuscita. Verifica utente e password.',
    }
  if (e.responseCode && e.responseCode >= 400 && e.responseCode < 500)
    return {
      state: 'pending' as const,
      message: `Il server SMTP ha rifiutato temporaneamente l’invio (${e.responseCode}).`,
    }
  if (e.responseCode && e.responseCode >= 500)
    return {
      state: 'failed' as const,
      message: `Il server SMTP ha rifiutato l’invio (${e.responseCode}). Verifica mittente e destinatario.`,
    }
  if (
    e.code === 'ETLS' ||
    (e.code === 'ESOCKET' && /TLS|CERT/i.test((error as Error).message ?? ''))
  )
    return {
      state: 'failed' as const,
      message: 'Connessione TLS SMTP non riuscita. Verifica certificato e modalità di sicurezza.',
    }
  // Nodemailer also reports CONN for a socket lost after DATA. Only a definite
  // pre-delivery failure is safe to retry; a generic connection loss is unknown.
  if (
    /^(?:EHLO|HELO|STARTTLS|AUTH|MAIL FROM|RCPT TO)/i.test(e.command ?? '') ||
    /^(?:ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH)$/.test(
      e.originalCode ?? e.code ?? '',
    ) ||
    /^(?:CONNECT_TIMEOUT|GREETING_TIMEOUT|DNS_TIMEOUT)$/.test(e.timeoutType ?? '')
  )
    return {
      state: 'pending' as const,
      message:
        'Server SMTP non raggiungibile o connessione interrotta prima dell’invio. Riproverò automaticamente.',
    }
  return {
    state: 'uncertain' as const,
    message:
      'Il server non ha confermato l’esito dell’invio. Verifica la casella prima di riprovare per evitare duplicati.',
  }
}

type ImageDownload = Parameters<typeof notificationEmail>[3]
export class EmailDispatcher {
  private running: Promise<void> | null = null
  private stopped = false
  private blocked = false
  private transport: ReturnType<typeof smtpTransport> | null = null
  constructor(
    private cache: IssueCache,
    private config: EmailConfig,
    private content: (notification: IssueNotification) => Promise<IssueDetail>,
    private download: ImageDownload,
    private createTransport = smtpTransport,
  ) {}

  kick() {
    if (this.running || this.stopped || this.blocked) return this.running ?? Promise.resolve()
    this.running = Promise.resolve()
      .then(() => this.run())
      .finally(() => {
        this.running = null
        this.transport?.close()
        this.transport = null
      })
    return this.running
  }
  stop() {
    this.stopped = true
    this.transport?.close()
  }

  private async run() {
    let lastId = ''
    let lastMessage: Awaited<ReturnType<typeof notificationEmail>> | undefined
    while (!this.stopped) {
      const target = this.config.target()
      if (!target) return
      const job = this.cache.nextEmail(target.revision)
      if (!job) return
      let started = false
      let accepted = false
      try {
        const { settings, password } = await this.config.credentials()
        if (!lastMessage || lastId !== job.notification.id) {
          let detail: IssueDetail | null = null
          try {
            detail = await this.content(job.notification)
          } catch {
            /* Deliver the event even if GitHub content is unavailable. */
          }
          lastMessage = await notificationEmail(
            job.notification,
            job.projectTitle,
            detail,
            this.download,
          )
          lastId = job.notification.id
        }
        if (this.stopped || this.config.target()?.revision !== job.revision) return
        if (!(await this.cache.startEmail(job.id))) continue
        started = true
        this.transport ??= this.createTransport(settings, password)
        const info = await this.transport.sendMail({
          ...lastMessage,
          from: { name: 'Issue Atlas', address: settings.from },
          to: { address: job.recipient, name: '' },
          messageId: `<${createHash('sha256').update(job.id).digest('hex')}@issue-atlas.local>`,
          headers: { 'Auto-Submitted': 'auto-generated', 'X-Auto-Response-Suppress': 'All' },
          disableFileAccess: true,
          disableUrlAccess: true,
        })
        if (!info.accepted.length)
          throw Object.assign(new Error('Destinatario rifiutato.'), { responseCode: 550 })
        accepted = true
        await this.cache.finishEmail(job.id, 'sent')
      } catch (error) {
        const failure = accepted
          ? {
              state: 'uncertain' as const,
              message:
                'Il server ha accettato la mail, ma non è stato possibile salvare l’esito. Verifica la casella prima di riprovare.',
            }
          : started
            ? smtpFailure(error)
            : {
                state: 'failed' as const,
                message:
                  (error as Error).message.startsWith('Inserisci') ||
                  (error as Error).message.startsWith('Impossibile leggere')
                    ? (error as Error).message
                    : 'Impossibile preparare l’invio. Verifica le impostazioni SMTP e la disponibilità del disco.',
              }
        const state = failure.state === 'pending' && job.attempts >= 5 ? 'failed' : failure.state
        await this.cache
          .finishEmail(
            job.id,
            state,
            failure.message,
            Date.now() + Math.min(30 * 60_000, 60_000 * 2 ** Math.max(0, job.attempts - 1)),
          )
          .catch(() => {})
        this.transport?.close()
        this.transport = null
        if (
          !started ||
          (error as { code?: string }).code === 'EAUTH' ||
          (error as { command?: string }).command === 'MAIL FROM'
        ) {
          this.blocked = true
          return
        }
        // A failed durable write must not spin on an unchanged pending job.
        if (this.cache.nextEmail(target.revision)?.id === job.id) return
      }
    }
  }
}

export async function verifySmtp(
  config: EmailConfig,
  input: EmailSettingsInput,
  factory = smtpTransport,
) {
  const { settings, password } = await config.credentials(input)
  const transport = factory(settings, password)
  try {
    await transport.verify()
  } catch (error) {
    const failure = smtpFailure(error)
    throw new Error(
      failure.state === 'uncertain'
        ? 'Il server SMTP ha interrotto la verifica. Controlla host, porta e modalità di sicurezza.'
        : failure.message,
    )
  } finally {
    transport.close()
  }
}
export async function sendTestEmail(
  config: EmailConfig,
  input: EmailSettingsInput,
  factory = smtpTransport,
) {
  const { settings, password } = await config.credentials(input)
  const transport = factory(settings, password)
  let sent = 0
  try {
    for (const recipient of settings.recipients) {
      await transport.sendMail({
        from: { name: 'Issue Atlas', address: settings.from },
        to: recipient,
        subject: '[Issue Atlas] Mail di prova',
        text: 'La configurazione SMTP funziona. Riceverai le nuove notifiche quando attivi “Ricevi notifiche via mail” e salvi le impostazioni. Questa mail di prova non contiene dati delle issue.',
        html: '<h2>Issue Atlas · Mail di prova</h2><p>La configurazione SMTP funziona.</p><p>Attiva <strong>Ricevi notifiche via mail</strong> e salva per ricevere i nuovi aggiornamenti.</p><p>Questa mail di prova non contiene dati delle issue.</p>',
        disableFileAccess: true,
        disableUrlAccess: true,
      })
      sent++
    }
    return sent
  } catch (error) {
    throw new Error(
      `${smtpFailure(error).message} Mail di prova accettate: ${sent}/${settings.recipients.length}.`,
    )
  } finally {
    transport.close()
  }
}
