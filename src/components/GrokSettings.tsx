import { useEffect, useState } from 'react'
import { Check, LoaderCircle, ShieldCheck } from 'lucide-react'
import type { AtlasAPI } from '../shared/types'
import { defaultGrokSettings, type GrokSettingsInput } from '../shared/grok'
import { emptyEmailStatus, type EmailJob } from '../shared/email'
import { errorMessage } from '../shared/errors'
export function GrokSettingsPanel({
  api,
  onBusy,
}: {
  api: AtlasAPI
  onBusy: (busy: boolean) => void
}) {
  const [settings, setSettings] = useState(defaultGrokSettings)
  const [webhookKey, setKey] = useState('')
  const [authorizationHeader, setHeader] = useState('')
  const [removeCredentials, setRemove] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const [status, setStatus] = useState(emptyEmailStatus)
  const [history, setHistory] = useState<EmailJob[]>([])
  useEffect(() => {
    let active = true
    async function refresh() {
      const [state, jobs] = await Promise.all([api.grokStatus(), api.grokHistory()])
      if (active) {
        setStatus(state)
        setHistory(jobs)
      }
    }
    void api
      .grokSettings()
      .then((saved) => {
        if (active) setSettings(saved)
        return refresh()
      })
      .catch((e) => {
        if (active) setError(errorMessage(e))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    const timer = setInterval(() => {
      void refresh().catch(() => {})
    }, 5000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [api])
  const input = (): GrokSettingsInput => ({
    enabled: settings.enabled,
    webhookUrl: settings.webhookUrl,
    webhookKey,
    authorizationHeader,
    removeCredentials,
  })
  async function perform(action: string, task: () => Promise<string>) {
    setBusy(action)
    onBusy(true)
    setError('')
    setResult('')
    try {
      setResult(await task())
      setStatus(await api.grokStatus())
      setHistory(await api.grokHistory())
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy('')
      onBusy(false)
    }
  }
  if (loading) return <p>Caricamento impostazioni Grok…</p>
  const labels: Record<string, string> = {
    pending: 'In coda',
    sending: 'In invio',
    sent: 'Accettato',
    failed: 'Fallito',
    uncertain: 'Da verificare',
    cancelled: 'Annullato',
  }
  return (
    <form
      className="email-settings"
      onSubmit={(event) => {
        event.preventDefault()
        void perform('save', async () => {
          const saved = await api.saveGrokSettings(input())
          setSettings(saved)
          setKey('')
          setHeader('')
          setRemove(false)
          return saved.enabled
            ? 'Webhook attivo per le nuove notifiche.'
            : 'Invio disattivato. Configurazione salvata.'
        })
      }}
    >
      <fieldset disabled={!!busy}>
        <label className="email-toggle">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
          />{' '}
          Invia le nuove notifiche a Grok
        </label>
        <label htmlFor="grok-url">Webhook URL</label>
        <input
          id="grok-url"
          type="url"
          maxLength={8192}
          placeholder="https://api2.cursor.sh/automations/webhook/…"
          value={settings.webhookUrl}
          onChange={(e) => setSettings({ ...settings, webhookUrl: e.target.value })}
        />
        <label htmlFor="grok-key">Webhook key</label>
        <input
          id="grok-key"
          type="password"
          autoComplete="new-password"
          maxLength={8000}
          value={webhookKey}
          onChange={(e) => setKey(e.target.value)}
        />
        <label htmlFor="grok-header">Authorization header</label>
        <input
          id="grok-header"
          type="password"
          autoComplete="new-password"
          maxLength={8000}
          placeholder="Authorization: Bearer …"
          value={authorizationHeader}
          onChange={(e) => setHeader(e.target.value)}
        />
        <p className="field-help">
          Incolla la key oppure la riga Authorization completa della routine.{' '}
          {settings.hasCredentials
            ? 'Credenziali salvate: lascia vuoti i campi per conservarle.'
            : 'Nessuna credenziale salvata.'}{' '}
          Cambiando URL devi reinserirle.
        </p>
        <label className="email-toggle">
          <input
            type="checkbox"
            checked={removeCredentials}
            onChange={(e) => setRemove(e.target.checked)}
          />{' '}
          Elimina le credenziali salvate
        </label>
        <div className="secure-note">
          <ShieldCheck size={17} />
          <span>Invio HTTPS dal Mac. Credenziali cifrate nel Portachiavi.</span>
        </div>
        <p className="field-help">
          Ogni aggiornamento viene inviato come evento JSON. La nuova configurazione vale per gli
          eventi successivi e annulla quelli ancora in attesa della precedente. Un’accettazione
          conferma la ricezione; verifica l’elaborazione nella chat Grok.
        </p>
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <p className="notice success" role="status">
            {result}
          </p>
        )}
        <div className="email-test-actions">
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              void perform('verify', async () => {
                await api.verifyGrok(input())
                return 'Configurazione valida. Nessuna richiesta inviata.'
              })
            }
          >
            Verifica configurazione
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              void perform('test', async () => {
                await api.testGrok(input())
                return 'Evento di prova accettato dal webhook.'
              })
            }
          >
            Invia evento di prova
          </button>
        </div>
        <p className="field-help">
          L’evento di prova avvia la routine con un messaggio di test, senza dati delle issue.
        </p>
        <div className="modal-footer">
          <span>Le modifiche si applicano con Salva.</span>
          <button type="submit" className="button primary">
            {busy === 'save' ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}{' '}
            Salva impostazioni
          </button>
        </div>
      </fieldset>
      <section className="email-delivery-status" aria-label="Storico invii Grok">
        <h3>Storico invii</h3>
        <p>
          {status.pending} in attesa · {status.sent} accettati · {status.failed} falliti ·{' '}
          {status.uncertain} da verificare
        </p>
        {status.lastError && <p role="status">{status.lastError}</p>}
        {status.failed > 0 && (
          <button
            className="button secondary"
            type="button"
            disabled={!!busy || !settings.enabled}
            onClick={() =>
              void perform('retry', async () => {
                await api.retryGrok()
                return 'Invii falliti rimessi in coda.'
              })
            }
          >
            Riprova invii falliti
          </button>
        )}
        {status.uncertain > 0 && (
          <>
            <p>Verifica prima Grok: ritentare un invio senza conferma può creare duplicati.</p>
            <button
              className="button secondary"
              type="button"
              disabled={!!busy || !settings.enabled}
              onClick={() => {
                if (
                  window.confirm(
                    'Hai verificato Grok? Ritentare un invio incerto può creare duplicati.',
                  )
                )
                  void perform('retry', async () => {
                    await api.retryGrok(true)
                    return 'Invii rimessi in coda.'
                  })
              }}
            >
              Riprova anche gli invii non confermati
            </button>
          </>
        )}
        {history.map((job) => (
          <article key={job.id}>
            <strong>
              #{job.notification.issue.number} · {job.notification.issue.title}
            </strong>
            <p>
              {job.projectTitle} · {labels[job.state]} ·{' '}
              {job.recipient.includes('@') ? 'Email precedente' : 'Webhook'} · tentativi:{' '}
              {job.attempts} ·{' '}
              {new Date(job.sentAt || job.notification.createdAt).toLocaleString('it-IT')}
            </p>
            {job.error && <p>{job.error}</p>}
          </article>
        ))}
      </section>
    </form>
  )
}
