import { readFile, writeFile, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { defaultGrokSettings, type GrokSettings, type GrokSettingsInput } from '../src/shared/grok'
import { webhookUrl, authorizationValue } from './grok-http'
interface StoredGrok {
  version: 2
  revision: string
  enabled: boolean
  webhookUrl: string
  encryptedAuthorization?: string
}
export interface SecretStorage {
  encrypt: (value: string) => Promise<string>
  decrypt: (value: string) => Promise<string>
}
export function validateGrokSettings(input: GrokSettingsInput, complete = input.enabled) {
  if (!input || typeof input.enabled !== 'boolean' || typeof input.webhookUrl !== 'string')
    throw new Error('Impostazioni Grok non valide.')
  const url = input.webhookUrl.trim() ? webhookUrl(input.webhookUrl.trim()) : ''
  if (complete && !url) throw new Error('Inserisci il Webhook URL di Grok.')
  if (input.removeCredentials !== undefined && typeof input.removeCredentials !== 'boolean')
    throw new Error('Opzione credenziali non valida.')
  if (
    (input.webhookKey !== undefined && typeof input.webhookKey !== 'string') ||
    (input.authorizationHeader !== undefined && typeof input.authorizationHeader !== 'string')
  )
    throw new Error('Credenziali webhook non valide.')
  return { enabled: input.enabled, webhookUrl: url }
}
export class GrokConfig {
  private stored: StoredGrok = { ...defaultGrokSettings(), version: 2, revision: randomUUID() }
  constructor(
    private path: string,
    private secrets: SecretStorage,
  ) {}
  async load() {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8'))
      // v1 contains SMTP settings. Never reuse those secrets or enable webhook delivery implicitly.
      if (data.version === 1) return
      if (data.version !== 2 || typeof data.revision !== 'string')
        throw new Error('Formato non valido.')
      this.stored = {
        ...validateGrokSettings(data),
        version: 2,
        revision: data.revision,
        encryptedAuthorization: data.encryptedAuthorization,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('Impostazioni Grok non disponibili. Configura nuovamente il webhook.')
    }
  }
  settings(): GrokSettings {
    return {
      enabled: this.stored.enabled,
      webhookUrl: this.stored.webhookUrl,
      hasCredentials: !!this.stored.encryptedAuthorization,
    }
  }
  target() {
    return this.stored.enabled
      ? { revision: this.stored.revision, recipients: ['Grok webhook'] }
      : null
  }
  revision() {
    return this.stored.revision
  }
  async credentials(value?: GrokSettingsInput) {
    const input: GrokSettingsInput = value ?? this.settings()
    const settings = validateGrokSettings(input, true)
    let authorization = ''
    if (input.webhookKey || input.authorizationHeader)
      authorization = authorizationValue(input.webhookKey, input.authorizationHeader)
    else if (
      !input.removeCredentials &&
      settings.webhookUrl === this.stored.webhookUrl &&
      this.stored.encryptedAuthorization
    )
      authorization = await this.secrets.decrypt(this.stored.encryptedAuthorization)
    return { settings, authorization: authorizationValue('', authorization) }
  }
  async save(value: GrokSettingsInput) {
    const settings = validateGrokSettings(value)
    const same = settings.webhookUrl === this.stored.webhookUrl
    let encryptedAuthorization =
      !value.removeCredentials && same ? this.stored.encryptedAuthorization : undefined
    if (value.webhookKey || value.authorizationHeader)
      encryptedAuthorization = await this.secrets.encrypt(
        authorizationValue(value.webhookKey, value.authorizationHeader),
      )
    if (settings.enabled && !encryptedAuthorization)
      throw new Error('Inserisci la Webhook key o l’Authorization header per questo URL.')
    const unchanged =
      same &&
      settings.enabled === this.stored.enabled &&
      encryptedAuthorization === this.stored.encryptedAuthorization
    const stored: StoredGrok = {
      ...settings,
      version: 2,
      revision: unchanged ? this.stored.revision : randomUUID(),
      encryptedAuthorization,
    }
    await writeFile(`${this.path}.tmp`, JSON.stringify(stored, null, 2), { mode: 0o600 })
    await rename(`${this.path}.tmp`, this.path)
    this.stored = stored
    return this.settings()
  }
}
