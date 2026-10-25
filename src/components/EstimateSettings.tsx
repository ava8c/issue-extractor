import { useEffect, useState } from 'react'
import { Calculator, LoaderCircle, X } from 'lucide-react'
import type { AtlasAPI, Project, ProjectStatus } from '../shared/types'
import {
  defaultAISettings,
  defaultProjectEstimates,
  type AISettingsInput,
  type ProjectEstimateSettings,
} from '../shared/estimates'
import { errorMessage } from '../shared/errors'
import { useDialog } from './useDialog'
import '../estimates.css'

export function AISettingsPanel({
  api,
  onBusy,
  saved,
}: {
  api: AtlasAPI
  onBusy: (value: boolean) => void
  saved: () => void
}) {
  const [settings, setSettings] = useState(defaultAISettings())
  const [apiKey, setKey] = useState('')
  const [removeKey, setRemoveKey] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState('load')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setBusy('load')
    setError('')
    void api
      .aiSettings()
      .then((value) => {
        if (active) setSettings(value)
      })
      .catch((e) => {
        if (active) setError(errorMessage(e))
      })
      .finally(() => {
        if (active) setBusy('')
      })
    return () => {
      active = false
    }
  }, [api, retry])
  useEffect(() => {
    onBusy(!!busy)
    return () => onBusy(false)
  }, [busy, onBusy])
  const input = (): AISettingsInput => ({ ...settings, apiKey: apiKey || undefined, removeKey })
  const patch = (value: Partial<typeof settings>) => {
    setSettings((current) => ({ ...current, ...value }))
    setMessage('')
    setError('')
  }
  return (
    <form
      className="estimate-settings"
      onSubmit={async (event) => {
        event.preventDefault()
        setBusy('save')
        setError('')
        setMessage('')
        try {
          setSettings(await api.saveAISettings(input()))
          setKey('')
          setRemoveKey(false)
          setMessage('Impostazioni OpenAI salvate.')
          saved()
        } catch (e) {
          setError(errorMessage(e))
        } finally {
          setBusy('')
        }
      }}
    >
      <p className="estimate-help">
        Estrae le stime già scritte nelle issue. Descrizioni e commenti dei soli progetti abilitati
        vengono inviati a OpenAI. La chiave è cifrata nel Portachiavi del Mac.
      </p>
      <fieldset disabled={!!busy}>
        <label className="estimate-check">
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => patch({ enabled: event.target.checked })}
          />{' '}
          Attiva estrazione e monitoraggio stime
        </label>
        <label>
          Chiave API OpenAI
          <input
            type="password"
            autoComplete="new-password"
            value={apiKey}
            onChange={(event) => {
              setKey(event.target.value)
              setRemoveKey(false)
            }}
            placeholder={settings.hasKey ? 'Chiave salvata · lascia vuoto per mantenerla' : 'sk-…'}
          />
        </label>
        {settings.hasKey && (
          <label className="estimate-check">
            <input
              type="checkbox"
              checked={removeKey}
              onChange={(event) => {
                setRemoveKey(event.target.checked)
                if (event.target.checked) patch({ enabled: false })
              }}
            />{' '}
            Rimuovi la chiave salvata
          </label>
        )}
        <label>
          Modello OpenAI
          <input
            list="openai-models"
            value={settings.model}
            onChange={(event) => patch({ model: event.target.value })}
            required
            autoComplete="off"
          />
          <datalist id="openai-models">
            {models.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </label>
        <button
          type="button"
          className="button secondary"
          onClick={async () => {
            setBusy('models')
            setError('')
            setMessage('')
            try {
              const ids = await api.aiModels(input())
              setModels(ids)
              setMessage(`${ids.length} modelli caricati. Chiave verificata senza generare testo.`)
            } catch (e) {
              setError(errorMessage(e))
            } finally {
              setBusy('')
            }
          }}
        >
          Carica modelli e verifica chiave
        </button>
        <p className="estimate-help">
          Puoi scegliere dall’elenco o inserire un ID. Il modello deve supportare Responses API e
          Structured Outputs; l’elenco include anche modelli con altre capacità.
        </p>
        <p className="estimate-help">
          Decisions usa GPT-6 Luna per classificare i nuovi commenti. Le aggiunte si sommano e i
          nuovi totali sostituiscono la stima precedente; una decisione incerta richiede la
          ricostruzione completa.
        </p>
        <div className="estimate-grid">
          <label>
            Caratteri massimi per analisi
            <input
              type="number"
              min="1000"
              max="200000"
              required
              value={settings.maxInputChars}
              onChange={(event) => patch({ maxInputChars: Number(event.target.value) })}
            />
          </label>
          <label>
            Token massimi di output
            <input
              type="number"
              min="500"
              max="16000"
              required
              value={settings.maxOutputTokens}
              onChange={(event) => patch({ maxOutputTokens: Number(event.target.value) })}
            />
          </label>
          <label>
            Budget token al giorno (UTC)
            <input
              type="number"
              min="1000"
              max="10000000"
              required
              value={settings.dailyTokenBudget}
              onChange={(event) => patch({ dailyTokenBudget: Number(event.target.value) })}
            />
          </label>
          <label>
            Issue per ciclo di controllo
            <input
              type="number"
              min="1"
              max="50"
              required
              value={settings.maxIssuesPerSync}
              onChange={(event) => patch({ maxIssuesPerSync: Number(event.target.value) })}
            />
          </label>
          <label>
            Soglia di confidenza Decisions
            <input
              type="number"
              min="0.5"
              max="1"
              step="0.01"
              required
              value={settings.decisionThreshold}
              onChange={(event) => patch({ decisionThreshold: Number(event.target.value) })}
            />
          </label>
        </div>
        <p className="estimate-help">
          Il budget include input e output, con prenotazione prudenziale prima di ogni chiamata. Le
          richieste fallite senza conteggio token mantengono la prenotazione. Nessun taglio
          silenzioso del testo; i contesti oltre il limite sono segnalati.
        </p>
      </fieldset>
      {error && (
        <p className="notice error" role="alert">
          {error}{' '}
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Ricarica
          </button>
        </p>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <button type="submit" className="button primary" disabled={!!busy}>
        {busy && <LoaderCircle size={14} className="spin" />} Salva impostazioni OpenAI
      </button>
    </form>
  )
}

export function ProjectEstimateSettingsModal({
  api,
  project,
  statuses,
  close,
  saved,
}: {
  api: AtlasAPI
  project: Project
  statuses: ProjectStatus[]
  close: () => void
  saved: () => void
}) {
  const [value, setValue] = useState(defaultProjectEstimates())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const dialog = useDialog(() => {
    if (!saving) close()
  })
  useEffect(() => {
    let active = true
    setLoading(true)
    setError('')
    void api
      .projectEstimates(project.id)
      .then((value) => {
        if (active) setValue(value)
      })
      .catch((e) => {
        if (active) setError(errorMessage(e))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [api, project.id, retry])
  const patch = (update: Partial<ProjectEstimateSettings>) =>
    setValue((current) => ({ ...current, ...update }))
  const options = [
    ...new Set([...statuses.map((status) => status.name), 'Senza stato', ...value.statuses]),
  ]
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) close()
      }}
    >
      <section
        className="customization-modal estimate-project-modal"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="estimate-project-title"
      >
        <div className="customization-heading">
          <div>
            <h2 id="estimate-project-title">
              <Calculator size={19} /> Stime progetto
            </h2>
            <p>{project.title}</p>
          </div>
          <button
            className="icon-button"
            onClick={close}
            disabled={saving}
            aria-label="Chiudi impostazioni stime"
          >
            <X size={19} />
          </button>
        </div>
        <p className="estimate-help">
          Il controllo segue gli stati selezionati, anche se nascosti dai filtri della lista. Fuori
          da questi stati la stima rimane visibile e il monitoraggio si ferma. I nuovi stati non
          sono abilitati automaticamente.
        </p>
        <form
          className="estimate-settings"
          onSubmit={async (event) => {
            event.preventDefault()
            setSaving(true)
            setError('')
            try {
              await api.saveProjectEstimates(project.id, value)
              saved()
              close()
            } catch (e) {
              setError(errorMessage(e))
            } finally {
              setSaving(false)
            }
          }}
        >
          <fieldset disabled={loading || saving}>
            <label className="estimate-check">
              <input
                type="checkbox"
                checked={value.enabled}
                onChange={(event) => patch({ enabled: event.target.checked })}
              />{' '}
              Monitora le stime di questo progetto
            </label>
            <p className="estimate-help">
              Richiede l’attivazione in Impostazioni → OpenAI e stime.
            </p>
            <p className="estimate-legend">Stati da analizzare e monitorare</p>
            <div className="estimate-statuses">
              {options.map((name) => (
                <label className="estimate-check" key={name}>
                  <input
                    type="checkbox"
                    checked={value.statuses.includes(name)}
                    onChange={() =>
                      patch({
                        statuses: value.statuses.includes(name)
                          ? value.statuses.filter((status) => status !== name)
                          : [...value.statuses, name],
                      })
                    }
                  />
                  {name}
                </label>
              ))}
            </div>
            <label className="estimate-check">
              <input
                type="checkbox"
                checked={value.includeClosed}
                onChange={(event) => patch({ includeClosed: event.target.checked })}
              />{' '}
              Includi issue chiuse e PR unite
            </label>
            <label className="estimate-check">
              <input
                type="checkbox"
                checked={value.includeDrafts}
                onChange={(event) => patch({ includeDrafts: event.target.checked })}
              />{' '}
              Includi bozze negli stati selezionati
            </label>
            <div className="estimate-grid">
              <label>
                Modificate dal (facoltativo)
                <input
                  type="date"
                  value={value.updatedSince}
                  onChange={(event) => patch({ updatedSince: event.target.value })}
                />
              </label>
              <label>
                Ore per giornata lavorativa
                <input
                  type="number"
                  min="0.5"
                  max="24"
                  step="0.5"
                  required
                  value={value.hoursPerDay}
                  onChange={(event) => patch({ hoursPerDay: Number(event.target.value) })}
                />
              </label>
            </div>
            <label>
              Convenzioni del progetto (facoltative)
              <textarea
                rows={3}
                maxLength={2000}
                placeholder="Es. gg indica giornate/persona. Le stime in tabella sono per singolo intervento."
                value={value.instructions}
                onChange={(event) => patch({ instructions: event.target.value })}
              />
            </label>
            <p className="estimate-help">
              Prima analisi completa, poi aggiornamenti solo quando arrivano nuovi commenti.
              Decisions distingue aggiunte, nuovi totali e commenti senza effetti; nei casi incerti
              ricostruisce la stima dalla conversazione. Nessun ricalcolo periodico. Modifiche e
              cancellazioni vengono gestite quando rilevate dall’indice; puoi sempre ricalcolare
              manualmente.
            </p>
          </fieldset>
          {loading && <p role="status">Caricamento preferenze…</p>}
          {error && (
            <p className="notice error" role="alert">
              {error}{' '}
              <button type="button" onClick={() => setRetry((value) => value + 1)}>
                Ricarica
              </button>
            </p>
          )}
          <div className="customization-footer">
            <button type="button" className="button secondary" onClick={close} disabled={saving}>
              Annulla
            </button>
            <button className="button primary" disabled={saving || loading}>
              {saving && <LoaderCircle size={14} className="spin" />} Salva stime progetto
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}
