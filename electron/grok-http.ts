// Grok routines: POST JSON + Authorization. A receipt confirms acceptance only.
export function webhookUrl(value: string) {
  if (typeof value !== 'string' || value.length > 8192 || /[\s\x00-\x1f]/.test(value))
    throw new Error('Webhook URL non valido.')
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('Webhook URL non valido.')
  }
  if (
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error('Usa un Webhook URL HTTPS senza credenziali, parametri o frammenti.')
  return url.href
}
export function authorizationValue(key = '', header = '') {
  if (
    typeof key !== 'string' ||
    typeof header !== 'string' ||
    /[\r\n\0]/.test(key + header) ||
    key.length + header.length > 16000
  )
    throw new Error('Credenziali webhook non valide.')
  const value =
    header.trim().replace(/^Authorization\s*:\s*/i, '') ||
    (key.trim() ? `Bearer ${key.trim()}` : '')
  if (!value || !/^[\x20-\x7e]+$/.test(value))
    throw new Error('Inserisci la Webhook key o l’Authorization header completo.')
  if (key.trim() && header.trim() && value !== `Bearer ${key.trim()}`)
    throw new Error(
      'Webhook key e Authorization header non corrispondono. Compila uno dei due campi.',
    )
  return value
}
export class WebhookError extends Error {
  outcome: string
  status: number
  constructor(message: string, outcome = 'error', status = 0) {
    super(message)
    this.outcome = outcome
    this.status = status
  }
}
export async function postWebhook(
  url: string,
  authorization: string,
  payload: unknown,
  {
    signal,
    eventId,
    timeoutMs = 20000,
    fetchImpl = fetch,
  }: { signal?: AbortSignal; eventId?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {},
) {
  webhookUrl(url)
  authorizationValue('', authorization)
  if (signal?.aborted) throw new WebhookError('Invio interrotto prima della richiesta.')
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      redirect: 'manual',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authorization,
        ...(eventId ? { 'Idempotency-Key': eventId } : {}),
      },
      body: JSON.stringify(payload),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
    })
    // Do not read or expose server bodies: they may echo content or credentials.
    await response.body?.cancel()
    if (response.status < 200 || response.status >= 300) {
      const message = [401, 403].includes(response.status)
        ? 'Autorizzazione webhook rifiutata. Verifica key e header.'
        : response.status >= 300 && response.status < 400
          ? 'Il webhook ha risposto con un redirect. Configura l’URL finale: le credenziali non vengono inoltrate.'
          : `Webhook Grok: richiesta rifiutata (HTTP ${response.status}).`
      throw new WebhookError(
        message,
        response.status === 408 || response.status >= 500 ? 'uncertain' : 'error',
        response.status,
      )
    }
    return { status: response.status }
  } catch (error) {
    if (error instanceof WebhookError) throw error
    const failure = error as { cause?: { code?: string }; code?: string }
    const code = failure.cause?.code || failure.code || ''
    if (
      [
        'ECONNREFUSED',
        'ENOTFOUND',
        'EAI_AGAIN',
        'ENETUNREACH',
        'EHOSTUNREACH',
        'UND_ERR_CONNECT_TIMEOUT',
      ].includes(code)
    )
      throw new WebhookError('Webhook non raggiungibile. Verifica URL e connessione.')
    throw new WebhookError(
      'Esito webhook incerto. Verifica Grok prima di ritentare per evitare duplicati.',
      'uncertain',
    )
  }
}
