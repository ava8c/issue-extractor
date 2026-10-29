import { readFile, writeFile, rename } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { defaultAISettings, type AISettings, type AISettingsInput } from '../src/shared/estimates'
import type { SecretStorage } from './grok-config'

export function validateAISettings(value: AISettingsInput): AISettingsInput {
  value = { ...defaultAISettings(), ...value }
  if (
    !value ||
    typeof value.model !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,149}$/.test(value.model.trim())
  )
    throw new Error('Inserisci un ID modello OpenAI valido.')
  for (const [name, min, max] of [
    ['maxInputChars', 1000, 200000],
    ['maxOutputTokens', 500, 16000],
    ['dailyTokenBudget', 1000, 10000000],
    ['maxIssuesPerSync', 1, 50],
  ] as const) {
    if (!Number.isInteger(value[name]) || value[name] < min || value[name] > max)
      throw new Error(`Limite ${name} non valido (${min}–${max}).`)
  }
  const apiKey = value.apiKey?.trim()
  if (
    !Number.isFinite(value.decisionThreshold) ||
    value.decisionThreshold < 0.5 ||
    value.decisionThreshold > 1
  )
    throw new Error('La soglia Decisions deve essere compresa tra 0,5 e 1.')
  if (apiKey && (apiKey.length > 512 || /\s/.test(apiKey)))
    throw new Error('Chiave API non valida.')
  return {
    enabled: value.enabled === true,
    model: value.model.trim(),
    maxInputChars: value.maxInputChars,
    maxOutputTokens: value.maxOutputTokens,
    dailyTokenBudget: value.dailyTokenBudget,
    maxIssuesPerSync: value.maxIssuesPerSync,
    decisionThreshold: value.decisionThreshold,
    apiKey,
    removeKey: value.removeKey === true,
  }
}

export class AIConfig {
  private value = defaultAISettings()
  private encryptedKey?: string
  private key?: string
  private version = randomUUID()
  constructor(
    private path: string,
    private secrets: SecretStorage,
  ) {}
  async load() {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8'))
      if (data.version !== 1) throw new Error('Formato non valido.')
      const {
        apiKey: _key,
        removeKey: _remove,
        ...settings
      } = validateAISettings({ ...data, apiKey: undefined })
      if (settings.model === 'gpt-4.1-mini') settings.model = 'gpt-6-luna'
      this.encryptedKey = data.encryptedKey
      this.value = { ...settings, hasKey: !!this.encryptedKey }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('Impostazioni OpenAI non disponibili. Configurale nuovamente.')
    }
  }
  settings(): AISettings {
    return { ...this.value }
  }
  revision() {
    return this.version
  }
  async credentials(input?: AISettingsInput) {
    if (input?.apiKey?.trim()) return input.apiKey.trim()
    if (input?.removeKey) throw new Error('Inserisci una chiave API OpenAI.')
    if (this.encryptedKey) this.key ??= await this.secrets.decrypt(this.encryptedKey)
    if (!this.key) throw new Error('Inserisci una chiave API OpenAI nelle impostazioni.')
    return this.key
  }
  async save(input: AISettingsInput) {
    const { apiKey, removeKey, ...settings } = validateAISettings(input)
    const encryptedKey = removeKey
      ? undefined
      : apiKey
        ? await this.secrets.encrypt(apiKey)
        : this.encryptedKey
    if (settings.enabled && !encryptedKey)
      throw new Error('Inserisci la chiave API prima di attivare le stime.')
    await writeFile(`${this.path}.tmp`, JSON.stringify({ version: 1, ...settings, encryptedKey }), {
      mode: 0o600,
    })
    await rename(`${this.path}.tmp`, this.path)
    this.encryptedKey = encryptedKey
    this.key = removeKey ? undefined : apiKey || this.key
    this.value = { ...settings, hasKey: !!encryptedKey }
    this.version = randomUUID()
    return this.settings()
  }
}
