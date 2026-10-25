import { useEffect, useState } from 'react'
import { Check, CheckCheck, LoaderCircle, Mail, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { AtlasAPI } from '../shared/types'
import { defaultEmailSettings, emptyEmailStatus, type EmailSettingsInput } from '../shared/email'
import { errorMessage } from '../shared/errors'

export function EmailSettingsPanel({
  api,
  onBusy,
}: {
  api: AtlasAPI
  onBusy: (busy: boolean) => void
}) {
  const [settings, setSettings] = useState(defaultEmailSettings)
  const [password, setPassword] = useState('')
  const [port, setPort] = useState('465')
  const [recipients, setRecipients] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const [status, setStatus] = useState(emptyEmailStatus)
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        if (!api.emailSettings) throw new Error('Riavvia l’app per caricare le impostazioni SMTP.')
        const [saved, delivery] = await Promise.all([api.emailSettings(), api.emailStatus()])
        if (!active) return
        setSettings(saved)
        setPort(String(saved.port))
        setRecipients(saved.recipients.join('\n'))
        setStatus(delivery)
      } catch (error) {
        if (active) setError(errorMessage(error))
      } finally {
        if (active) setLoading(false)
      }
    })()
    const timer = setInterval(() => {
      void api
        .emailStatus?.()
        .then((state) => {
          if (active) setStatus(state)
        })
        .catch(() => {})
    }, 5000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [api])
  function input(): EmailSettingsInput {
    const { hasPassword: ignored, ...fields } = settings
    return {
      ...fields,
      port: Number(port),
      recipients: recipients
        .split(/[,;\n]/)
        .map((address) => address.trim())
        .filter(Boolean),
      password: password || undefined,
    }
  }
  function dirty() {
    setError('')
    setResult('')
  }
  async function perform(action: string, task: () => Promise<string>) {
    setBusy(action)
    onBusy(true)
    dirty()
    try {
      setResult(await task())
      setStatus(await api.emailStatus())
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setBusy('')
      onBusy(false)
    }
  }
  if (loading)
    return (
      <div className="email-loading">
        <LoaderCircle className="spin" size={22} />
        Caricamento impostazioni email…
      </div>
    )
  return (
    <form
      className="email-settings"
      onSubmit={(event) => {
        event.preventDefault()
        void perform('save', async () => {
          const saved = await api.saveEmailSettings(input())
          setSettings(saved)
          setPassword('')
          setRecipients(saved.recipients.join('\n'))
          return saved.enabled
            ? 'Ricezione via mail attivata per le nuove notifiche.'
            : 'Ricezione via mail disattivata. Configurazione salvata.'
        })
      }}
    >
      <fieldset disabled={!!busy}>
        <label className="email-toggle">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => {
              setSettings({ ...settings, enabled: event.target.checked })
              dirty()
            }}
          />
          <span>
            <strong>Ricevi notifiche via mail</strong>
            <small>Invia ogni nuova notifica ai destinatari configurati.</small>
          </span>
        </label>
        <p className="field-help">
          Con l’app aperta riceverai cambi di stato, nuove issue e commenti. Le mail includono testo
          e immagini; gli altri file vengono soltanto indicati. Lo storico non viene inviato quando
          attivi la funzione.
        </p>
        <label htmlFor="smtp-host">Server SMTP</label>
        <input
          id="smtp-host"
          placeholder="smtp.azienda.it"
          autoComplete="off"
          value={settings.host}
          required={settings.enabled}
          onChange={(event) => {
            setSettings({ ...settings, host: event.target.value })
            dirty()
          }}
        />
        <div className="email-settings-row">
          <div>
            <label htmlFor="smtp-security">Sicurezza</label>
            <select
              id="smtp-security"
              value={settings.security}
              onChange={(event) => {
                const security = event.target.value as 'tls' | 'starttls'
                setSettings({ ...settings, security })
                setPort(security === 'tls' ? '465' : '587')
                dirty()
              }}
            >
              <option value="tls">TLS implicito</option>
              <option value="starttls">STARTTLS</option>
            </select>
          </div>
          <div>
            <label htmlFor="smtp-port">Porta</label>
            <input
              id="smtp-port"
              type="number"
              min="1"
              max="65535"
              required
              value={port}
              onChange={(event) => {
                setPort(event.target.value)
                dirty()
              }}
            />
          </div>
        </div>
        <label htmlFor="smtp-user">
          Utente SMTP{' '}
          <span className="field-optional">Facoltativo per relay senza autenticazione</span>
        </label>
        <input
          id="smtp-user"
          autoComplete="off"
          value={settings.username}
          onChange={(event) => {
            setSettings({ ...settings, username: event.target.value })
            dirty()
          }}
        />
        <label htmlFor="smtp-password">
          Password SMTP{' '}
          <span className="field-optional">
            {settings.hasPassword ? 'Password già salvata' : 'Richiesta con autenticazione'}
          </span>
        </label>
        <input
          id="smtp-password"
          type="password"
          autoComplete="new-password"
          value={password}
          placeholder={
            settings.hasPassword
              ? 'Lascia vuoto per conservare la password'
              : 'Password o password per app'
          }
          onChange={(event) => {
            setPassword(event.target.value)
            dirty()
          }}
        />
        <p className="field-help">
          La password è salvata cifrata, con chiavi protette dal Portachiavi macOS. Reinseriscila se
          cambi server, porta, sicurezza o utente.
        </p>
        <label htmlFor="smtp-from">Indirizzo mittente</label>
        <input
          id="smtp-from"
          type="email"
          placeholder="issue-atlas@azienda.it"
          required={settings.enabled}
          value={settings.from}
          onChange={(event) => {
            setSettings({ ...settings, from: event.target.value })
            dirty()
          }}
        />
        <label htmlFor="smtp-recipients">
          Destinatari{' '}
          <span className="field-optional">Uno per riga, oppure separati da virgola</span>
        </label>
        <textarea
          id="smtp-recipients"
          rows={3}
          placeholder="nome@azienda.it\nteam@azienda.it"
          required={settings.enabled}
          value={recipients}
          onChange={(event) => {
            setRecipients(event.target.value)
            dirty()
          }}
        />
        <p className="field-help">
          Ogni destinatario riceve una mail separata. Una nuova configurazione vale per le notifiche
          successive e annulla gli invii ancora in attesa della precedente.
        </p>
        <div className="secure-note">
          <ShieldCheck size={17} />
          <span>
            Connessione SMTP cifrata con verifica del certificato. L’invio parte direttamente dal
            tuo Mac.
          </span>
        </div>
        {error && (
          <div className="notice error" role="alert">
            <TriangleAlert size={16} />
            <span>{error}</span>
          </div>
        )}
        {result && (
          <div className="notice success" role="status">
            <CheckCheck size={16} />
            <span>{result}</span>
          </div>
        )}
        <div className="email-test-actions">
          <button
            className="button secondary"
            type="button"
            onClick={() =>
              void perform('verify', async () => {
                await api.verifyEmail(input())
                return 'Connessione SMTP verificata. Nessuna mail inviata.'
              })
            }
          >
            {busy === 'verify' ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <ShieldCheck size={14} />
            )}
            Verifica SMTP
          </button>
          <button
            className="button secondary"
            type="button"
            onClick={() =>
              void perform('test', async () => {
                const count = await api.testEmail(input())
                return `Mail di prova accettata dal server per ${count} destinatari.`
              })
            }
          >
            {busy === 'test' ? <LoaderCircle className="spin" size={14} /> : <Mail size={14} />}
            Invia mail di prova
          </button>
        </div>
        <p className="field-help">
          La verifica controlla soltanto la connessione. La mail di prova viene inviata agli
          indirizzi indicati e non contiene dati delle issue.
        </p>
        <div className="modal-footer">
          <span className="email-save-hint">Le modifiche diventano attive con Salva.</span>
          <button className="button primary" type="submit">
            {busy === 'save' ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}
            Salva impostazioni
          </button>
        </div>
      </fieldset>
      <section className="email-delivery-status" aria-label="Stato invii email">
        <h3>Invii per destinatario</h3>
        <p>
          {status.pending} in attesa · {status.sent} accettati · {status.failed} falliti ·{' '}
          {status.uncertain} da verificare
        </p>
        {status.lastSentAt && (
          <p>Ultimo invio: {new Date(status.lastSentAt).toLocaleString('it-IT')}</p>
        )}
        {status.lastError && (
          <p className="email-delivery-error" role="status">
            {status.lastError}
          </p>
        )}
        {status.failed > 0 && (
          <button
            className="button secondary"
            type="button"
            disabled={!!busy || !settings.enabled}
            onClick={() =>
              void perform('retry', async () => {
                await api.retryEmail()
                return 'Gli invii falliti sono stati rimessi in coda.'
              })
            }
          >
            Riprova invii falliti
          </button>
        )}
        {status.uncertain > 0 && (
          <>
            <p>
              Per gli invii senza conferma controlla prima la casella: riprovare potrebbe creare
              duplicati.
            </p>
            <button
              className="button secondary"
              type="button"
              disabled={!!busy || !settings.enabled}
              onClick={() =>
                void perform('retry', async () => {
                  await api.retryEmail(true)
                  return 'Gli invii selezionati sono stati rimessi in coda.'
                })
              }
            >
              Riprova anche gli invii non confermati
            </button>
          </>
        )}
      </section>
    </form>
  )
}
