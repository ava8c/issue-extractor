import { useEffect, useState } from 'react'
import { LoaderCircle, ShieldCheck } from 'lucide-react'
import type { AtlasAPI } from '../shared/types'
import {
  defaultMonitoringSettings,
  emptyMonitoringStatus,
  type MonitoringSettingsInput,
} from '../shared/monitoring'
import { errorMessage } from '../shared/errors'

export function MonitoringSettingsPanel({
  api,
  onBusy,
}: {
  api: AtlasAPI
  onBusy: (busy: boolean) => void
}) {
  const [settings, setSettings] = useState(defaultMonitoringSettings)
  const [status, setStatus] = useState(emptyMonitoringStatus)
  const [token, setToken] = useState('')
  const [removeToken, setRemoveToken] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  useEffect(() => {
    let active = true
    void Promise.all([api.monitoringSettings(), api.monitoringStatus()])
      .then(([settings, status]) => {
        if (active) {
          setSettings(settings)
          setStatus(status)
        }
      })
      .catch((error) => {
        if (active) setError(errorMessage(error))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    const timer = setInterval(() => {
      void api
        .monitoringStatus()
        .then((status) => {
          if (active) setStatus(status)
        })
        .catch(() => {})
    }, 5000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [api])
  const input = (): MonitoringSettingsInput => ({
    enabled: settings.enabled,
    baseUrl: settings.baseUrl,
    token: token || undefined,
    removeToken,
  })
  async function perform(task: () => Promise<string>) {
    setBusy(true)
    onBusy(true)
    setError('')
    setResult('')
    try {
      setResult(await task())
      setStatus(await api.monitoringStatus())
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy(false)
      onBusy(false)
    }
  }
  if (loading)
    return (
      <div className="email-loading">
        <LoaderCircle className="spin" size={22} />
        Caricamento Monitoraggio…
      </div>
    )
  return (
    <form
      className="email-settings"
      onSubmit={(event) => {
        event.preventDefault()
        void perform(async () => {
          const saved = await api.saveMonitoringSettings(input())
          setSettings(saved)
          setToken('')
          setRemoveToken(false)
          return saved.enabled
            ? 'Integrazione attiva. Le stime disponibili verranno inviate all’area di attesa.'
            : 'Configurazione salvata. Invii sospesi.'
        })
      }}
    >
      <fieldset disabled={busy}>
        <label className="email-toggle">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })}
          />
          <span>
            <strong>Invia le stime a Monitoraggio</strong>
            <small>Registra le issue nell’area di attesa dei rapportini.</small>
          </span>
        </label>
        <p className="field-help">
          All’attivazione vengono inviate anche le stime già disponibili. In Monitoraggio scegli
          manualmente mese e domini prima di creare l’attività. Gli aggiornamenti non modificano i
          rapportini già inseriti.
        </p>
        <label htmlFor="monitoring-url">URL base di Monitoraggio</label>
        <input
          id="monitoring-url"
          type="url"
          placeholder="https://monitoraggio.azienda.it"
          required={settings.enabled}
          value={settings.baseUrl}
          onChange={(event) => setSettings({ ...settings, baseUrl: event.target.value })}
        />
        <p className="field-help">
          Indirizzo pubblico, con l’eventuale percorso base. HTTPS obbligatorio; HTTP consentito
          solo su localhost per sviluppo.
        </p>
        <label htmlFor="monitoring-token">Chiave API</label>
        <input
          id="monitoring-token"
          type="password"
          autoComplete="new-password"
          value={token}
          placeholder={
            settings.hasToken
              ? 'Chiave salvata nel Portachiavi'
              : 'Genera una chiave in Monitoraggio'
          }
          onChange={(event) => {
            setToken(event.target.value)
            setRemoveToken(false)
          }}
        />
        <p className="field-help">
          Generala da Rapportini → Integrazione Issue Atlas, con un account amministratore. Se cambi
          URL, inserisci nuovamente la chiave.
        </p>
        {settings.hasToken && (
          <label className="email-toggle">
            <input
              type="checkbox"
              checked={removeToken}
              onChange={(event) => {
                setRemoveToken(event.target.checked)
                if (event.target.checked) {
                  setToken('')
                  setSettings({ ...settings, enabled: false })
                }
              }}
            />
            <span>Rimuovi la chiave salvata</span>
          </label>
        )}
        <div className="email-test-actions">
          <button
            className="button secondary"
            type="button"
            onClick={() => {
              void perform(async () => {
                await api.verifyMonitoring(input())
                return 'Connessione verificata e chiave API valida.'
              })
            }}
          >
            Verifica connessione
          </button>
        </div>
        <p className="field-help">
          <ShieldCheck size={14} /> La chiave consente solo l’invio all’area di attesa ed è
          revocabile da Monitoraggio.
        </p>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {result && (
          <div className="notice success" role="status">
            {result}
          </div>
        )}
        <div className="modal-footer">
          <span className="email-save-hint">Le modifiche diventano attive con Salva.</span>
          <button className="button primary" type="submit">
            {busy ? 'Attendi…' : 'Salva configurazione'}
          </button>
        </div>
        <section className="email-delivery-status" aria-label="Stato invii Monitoraggio">
          <h3>Invii a Monitoraggio</h3>
          <p>
            {status.delivered} consegnate · {status.pending} in coda · {status.failed} da riprovare
            {status.running ? ' · invio in corso' : ''}
          </p>
          {status.lastError && <p className="email-delivery-error">{status.lastError}</p>}
          <p>
            La coda viene salvata sul computer e gli invii falliti vengono riprovati con l’app
            aperta.
          </p>
          <button
            type="button"
            className="text-button"
            disabled={!settings.enabled || status.running}
            onClick={() => {
              void perform(async () => {
                await api.retryMonitoring()
                return 'Tentativo di invio completato.'
              })
            }}
          >
            Riprova gli invii
          </button>
        </section>
      </fieldset>
    </form>
  )
}
