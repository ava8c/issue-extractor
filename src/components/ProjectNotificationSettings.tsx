import { useEffect, useState } from 'react'
import { Bell, LoaderCircle, X } from 'lucide-react'
import type { AtlasAPI, Project, ProjectStatus } from '../shared/types'
import { readNotificationPreferences } from '../shared/activity'
import { statusOptions } from '../shared/preferences'
import { errorMessage } from '../shared/errors'
import { StatusSelectionOptions } from './IssueBrowser'
import { useDialog } from './useDialog'

export function ProjectNotificationSettings({
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
  const [preferences, setPreferences] = useState(readNotificationPreferences)
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
    Promise.resolve()
      .then(() => {
        if (typeof api.notificationPreferences !== 'function')
          throw new Error('Riavvia l’app per caricare le nuove preferenze notifiche.')
        return api.notificationPreferences(project.id)
      })
      .then((value) => {
        if (active) setPreferences(readNotificationPreferences(value))
      })
      .catch((error) => {
        if (active) setError(errorMessage(error))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [api, project.id, retry])
  const options = statusOptions(statuses, preferences.excludedStatuses)

  async function save() {
    setSaving(true)
    setError('')
    try {
      await api.saveNotificationPreferences(project.id, preferences)
      saved()
      close()
    } catch (error) {
      setError(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !saving) close()
      }}
    >
      <section
        ref={dialog}
        className="customization-modal project-notification-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-notification-title"
      >
        <div className="customization-heading">
          <div>
            <h2 id="project-notification-title">
              <Bell size={19} /> Notifiche progetto
            </h2>
            <p>{project.title}</p>
          </div>
          <button
            className="icon-button"
            aria-label="Chiudi preferenze notifiche"
            disabled={saving}
            onClick={close}
          >
            <X size={19} />
          </button>
        </div>
        <p className="project-notification-description">
          Ricevi notifiche native macOS, nell’app e su Grok per nuove issue, cambi di stato e nuovi
          commenti.
        </p>
        {loading ? (
          <p role="status">Caricamento preferenze…</p>
        ) : (
          <>
            <label className="project-notification-toggle">
              <input
                type="checkbox"
                role="switch"
                checked={preferences.enabled}
                disabled={saving || !!error}
                onChange={(event) =>
                  setPreferences((current) => ({ ...current, enabled: event.target.checked }))
                }
              />
              <span>
                <strong>Abilita notifiche per questo progetto</strong>
                <small>
                  {preferences.enabled
                    ? 'Ricevi aggiornamenti per gli stati selezionati.'
                    : 'Progetto silenziato. I filtri restano salvati per quando lo riattivi.'}
                </small>
              </span>
            </label>
            <fieldset disabled={saving || !!error || !preferences.enabled}>
              <legend>Stati abilitati alle notifiche</legend>
              <div className="status-filter-actions">
                <button
                  type="button"
                  onClick={() =>
                    setPreferences((current) => ({
                      ...current,
                      excludedStatuses: [],
                      includeDrafts: true,
                    }))
                  }
                >
                  Tutti
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setPreferences((current) => ({
                      ...current,
                      excludedStatuses: options.map((status) => status.name),
                      includeDrafts: false,
                    }))
                  }
                >
                  Nessuno
                </button>
              </div>
              <StatusSelectionOptions
                statuses={options}
                isSelected={(name) => !preferences.excludedStatuses.includes(name)}
                toggle={(name) =>
                  setPreferences((current) => ({
                    ...current,
                    excludedStatuses: current.excludedStatuses.includes(name)
                      ? current.excludedStatuses.filter((status) => status !== name)
                      : [...current.excludedStatuses, name],
                  }))
                }
                includeDrafts={preferences.includeDrafts}
                onDrafts={(includeDrafts) =>
                  setPreferences((current) => ({ ...current, includeDrafts }))
                }
              />
            </fieldset>
          </>
        )}
        <p className="project-notification-description">
          Deseleziona Bozze per escluderle in qualsiasi stato. Le preferenze sono indipendenti dai
          filtri della lista; le notifiche già ricevute restano nello storico.
        </p>
        <p className="project-notification-description">
          Le notifiche macOS arrivano con l’app aperta, anche in background. Puoi consentirle in
          Impostazioni di Sistema → Notifiche → Issue Atlas.
        </p>
        {error && (
          <div role="alert" className="notice error">
            {error}{' '}
            <button className="button secondary" onClick={() => setRetry((current) => current + 1)}>
              Ricarica preferenze
            </button>
          </div>
        )}
        <div className="customization-footer">
          <button className="button secondary" disabled={saving} onClick={close}>
            Annulla
          </button>
          <button
            className="button primary"
            disabled={loading || saving || !!error}
            onClick={() => void save()}
          >
            {saving && <LoaderCircle className="spin" size={14} />}
            {saving ? 'Salvataggio…' : 'Salva preferenze'}
          </button>
        </div>
      </section>
    </div>
  )
}
