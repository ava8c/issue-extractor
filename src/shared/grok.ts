export interface GrokSettings {
  enabled: boolean
  webhookUrl: string
  hasCredentials: boolean
}
export interface GrokSettingsInput {
  enabled: boolean
  webhookUrl: string
  webhookKey?: string
  authorizationHeader?: string
  removeCredentials?: boolean
}
export const defaultGrokSettings = (): GrokSettings => ({
  enabled: false,
  webhookUrl: '',
  hasCredentials: false,
})
