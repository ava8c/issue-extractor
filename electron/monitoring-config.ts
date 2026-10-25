import { readFile, writeFile, rename } from 'node:fs/promises'
import type { SecretStorage } from './email-config'
import {
  defaultMonitoringSettings,
  type MonitoringSettings,
  type MonitoringSettingsInput,
} from '../src/shared/monitoring'

export function monitoringUrl(value: string) {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('Inserisci un URL valido per Monitoraggio.')
  }
  if (
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname))) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      'Monitoraggio richiede HTTPS, senza credenziali, query o frammenti. HTTP è consentito solo su localhost.',
    )
  return url.href.replace(/\/+$/, '')
}
export class MonitoringConfig {
  private stored: Omit<MonitoringSettings, 'hasToken'> & { encryptedToken?: string } =
    defaultMonitoringSettings()
  constructor(
    private path: string,
    private secrets: SecretStorage,
  ) {}
  async load() {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8'))
      if (
        data.version !== 1 ||
        typeof data.enabled !== 'boolean' ||
        typeof data.baseUrl !== 'string'
      )
        throw new Error()
      this.stored = {
        enabled: data.enabled,
        baseUrl: data.baseUrl ? monitoringUrl(data.baseUrl) : '',
        encryptedToken: data.encryptedToken,
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error(
          'Configurazione Monitoraggio non disponibile. Salvala nuovamente nelle impostazioni.',
        )
    }
  }
  settings(): MonitoringSettings {
    return {
      enabled: this.stored.enabled,
      baseUrl: this.stored.baseUrl,
      hasToken: !!this.stored.encryptedToken,
    }
  }
  async credentials(input?: MonitoringSettingsInput) {
    const baseUrl = (input?.baseUrl ?? this.stored.baseUrl).trim()
    const normalized = monitoringUrl(baseUrl)
    const token = input?.removeToken
      ? ''
      : input?.token?.trim() ||
        (normalized === this.stored.baseUrl && this.stored.encryptedToken
          ? await this.secrets.decrypt(this.stored.encryptedToken)
          : '')
    if (!/^iat_[a-f0-9]{24}\.[A-Za-z0-9_-]{43}$/.test(token))
      throw new Error(
        'Inserisci la chiave API generata in Monitoraggio. Reinseriscila quando cambi URL.',
      )
    return { baseUrl: normalized, token }
  }
  async save(input: MonitoringSettingsInput) {
    if (
      !input ||
      typeof input.enabled !== 'boolean' ||
      typeof input.baseUrl !== 'string' ||
      (input.token !== undefined && typeof input.token !== 'string')
    )
      throw new Error('Configurazione Monitoraggio non valida.')
    const baseUrl = input.baseUrl.trim() ? monitoringUrl(input.baseUrl) : ''
    if (input.enabled) await this.credentials(input)
    const encryptedToken = input.removeToken
      ? undefined
      : input.token?.trim()
        ? await this.secrets.encrypt((await this.credentials(input)).token)
        : baseUrl === this.stored.baseUrl
          ? this.stored.encryptedToken
          : undefined
    const stored = { enabled: input.enabled, baseUrl, encryptedToken }
    await writeFile(`${this.path}.tmp`, JSON.stringify({ version: 1, ...stored }), { mode: 0o600 })
    await rename(`${this.path}.tmp`, this.path)
    this.stored = stored
    return this.settings()
  }
}
