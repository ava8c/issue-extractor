import { readFile, writeFile, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import {
  defaultEmailSettings,
  type EmailSettings,
  type EmailSettingsInput,
  type EmailTarget,
} from '../src/shared/email'

interface StoredEmail extends Omit<EmailSettings, 'hasPassword'> {
  version: 1
  revision: string
  encryptedPassword?: string
}
export interface SecretStorage {
  encrypt: (value: string) => Promise<string>
  decrypt: (value: string) => Promise<string>
}

function address(value: string) {
  const email = value.trim()
  const [local, domain] = email.split('@')
  if (
    email.length > 254 ||
    !/^[a-z\d!#$%&'*+/=?^_`{|}~.-]+@[a-z\d](?:[a-z\d.-]*[a-z\d])?$/i.test(email) ||
    local.length > 64 ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    email.includes('..') ||
    !domain
      ?.split('.')
      .every((part) => part.length <= 63 && /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(part))
  )
    throw new Error('Inserisci indirizzi email validi, senza nomi visualizzati o parentesi.')
  return email.toLowerCase()
}
export function validateEmailSettings(
  input: EmailSettingsInput,
  requireComplete = input.enabled,
): EmailSettingsInput {
  const host = input.host.trim()
  if (
    host &&
    !isIP(host) &&
    (host.length > 253 ||
      !host.split('.').every((label) => /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label)))
  )
    throw new Error('Inserisci il nome del server SMTP, senza protocollo, porta o percorso.')
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)
    throw new Error('Porta SMTP non valida.')
  if (!['tls', 'starttls'].includes(input.security)) throw new Error('Seleziona TLS o STARTTLS.')
  if (/\r|\n/.test(input.username)) throw new Error('Nome utente SMTP non valido.')
  if (!Array.isArray(input.recipients) || input.recipients.length > 50)
    throw new Error('Puoi configurare fino a 50 destinatari.')
  const recipients = [...new Set(input.recipients.map(address))]
  const from = input.from.trim() ? address(input.from) : ''
  if (requireComplete && (!host || !from || !recipients.length))
    throw new Error('Compila server SMTP, mittente e almeno un destinatario.')
  return {
    enabled: input.enabled === true,
    host,
    port: input.port,
    security: input.security,
    username: input.username.trim(),
    from,
    recipients,
    password: input.password || undefined,
  }
}
const identity = (value: Pick<EmailSettingsInput, 'host' | 'port' | 'security' | 'username'>) =>
  JSON.stringify([value.host.toLowerCase(), value.port, value.security, value.username])

export class EmailConfig {
  private stored: StoredEmail = { ...defaultEmailSettings(), version: 1, revision: randomUUID() }
  private password: string | undefined
  constructor(
    private path: string,
    private secrets: SecretStorage,
  ) {}
  async load() {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8')) as StoredEmail
      if (data.version !== 1 || typeof data.revision !== 'string')
        throw new Error('Formato non valido.')
      const settings = validateEmailSettings({ ...data, password: undefined })
      this.stored = {
        ...settings,
        version: 1,
        revision: data.revision,
        encryptedPassword: data.encryptedPassword,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('Impostazioni email non disponibili. Configura nuovamente l’SMTP.')
    }
  }
  settings(): EmailSettings {
    const { enabled, host, port, security, username, from, recipients, encryptedPassword } =
      this.stored
    return {
      enabled,
      host,
      port,
      security,
      username,
      from,
      recipients: [...recipients],
      hasPassword: !!encryptedPassword,
    }
  }
  target(): EmailTarget | null {
    return this.stored.enabled
      ? { revision: this.stored.revision, recipients: [...this.stored.recipients] }
      : null
  }
  revision() {
    return this.stored.revision
  }
  async credentials(value?: EmailSettingsInput) {
    const input = validateEmailSettings(value ?? this.settings(), true)
    let password = input.password
    if (
      !password &&
      input.username &&
      identity(input) === identity(this.stored) &&
      this.stored.encryptedPassword
    ) {
      this.password ??= await this.secrets.decrypt(this.stored.encryptedPassword)
      password = this.password
    }
    if (input.username && !password)
      throw new Error(
        'Inserisci la password SMTP. Va reinserita se cambi server, porta, sicurezza o utente.',
      )
    return { settings: input, password: password ?? '', revision: this.stored.revision }
  }
  async save(value: EmailSettingsInput) {
    const input = validateEmailSettings(value)
    const sameIdentity = identity(input) === identity(this.stored)
    const encryptedPassword = input.username
      ? input.password
        ? await this.secrets.encrypt(input.password)
        : sameIdentity
          ? this.stored.encryptedPassword
          : undefined
      : undefined
    if (input.enabled && input.username && !encryptedPassword)
      throw new Error('Inserisci la password SMTP per il server e l’utente selezionati.')
    const { password: ignored, ...settings } = input
    const unchanged =
      !input.password &&
      JSON.stringify(settings) ===
        JSON.stringify({
          enabled: this.stored.enabled,
          host: this.stored.host,
          port: this.stored.port,
          security: this.stored.security,
          username: this.stored.username,
          from: this.stored.from,
          recipients: this.stored.recipients,
        })
    const stored: StoredEmail = {
      ...settings,
      version: 1,
      revision: unchanged ? this.stored.revision : randomUUID(),
      encryptedPassword,
    }
    await writeFile(`${this.path}.tmp`, JSON.stringify(stored, null, 2), { mode: 0o600 })
    await rename(`${this.path}.tmp`, this.path)
    this.stored = stored
    this.password = input.password ?? (sameIdentity ? this.password : undefined)
    return this.settings()
  }
}
