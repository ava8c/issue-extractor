import { useState, type CSSProperties } from 'react'
import { ArrowRight, BarChart3, Settings2, X } from 'lucide-react'
import type { Project } from '../shared/types'
import {
  aggregateMetrics,
  METRICS,
  type MetricMapping,
  type MetricSummary,
  type ProjectMetricSnapshot,
} from '../shared/metrics'
import { statusOptions } from '../shared/preferences'
import { useDialog } from './useDialog'

export interface MetricRow {
  project: Project
  mapping: MetricMapping
  snapshot?: ProjectMetricSnapshot
  summary: MetricSummary | null
}

const date = new Intl.DateTimeFormat('it-IT', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

export function MetricsOverview({
  rows,
  onConfigure,
}: {
  rows: MetricRow[]
  onConfigure?: () => void
}) {
  const summaries = rows.flatMap((row) => (row.summary ? [row.summary] : []))
  const summary = aggregateMetrics(summaries)
  const available = summaries.length
  const single = rows.length === 1
  const times = rows.flatMap((row) => (row.snapshot?.syncedAt ? [row.snapshot.syncedAt] : []))
  return (
    <section className="metrics-overview" aria-label="Metriche su tutti gli stati">
      <div className="metrics-heading">
        <div className="metrics-totals">
          <span>
            <strong>{available ? summary.total : '—'}</strong> issue totali
          </span>
          <span>
            <strong>{available ? summary.open : '—'}</strong> aperte
          </span>
          <span
            className={summary.unmapped ? 'metrics-unmapped' : ''}
            title="Issue il cui stato non è associato ad alcuna metrica"
          >
            <strong>{available ? summary.unmapped : '—'}</strong> senza mapping
          </span>
        </div>
        {onConfigure && (
          <button className="button secondary" onClick={onConfigure}>
            <Settings2 size={14} /> Configura metriche
          </button>
        )}
      </div>
      <div className="metric-cards">
        {METRICS.map(({ id, label, color }) => {
          const configured = rows.filter((row) => row.mapping[id]?.length).length
          const covered = summaries.filter((item) => item.values[id] !== null).length
          const value = summary.values[id]
          return (
            <div
              className="metric-card"
              key={id}
              style={{ '--metric-color': color } as CSSProperties}
            >
              <span className="metric-label">
                <i />
                {label}
              </span>
              <strong className="metric-value">{value ?? '—'}</strong>
              <span className="metric-caption">
                {!configured
                  ? 'Da configurare'
                  : single
                    ? available
                      ? `${rows[0].mapping[id]!.length} ${rows[0].mapping[id]!.length === 1 ? 'stato associato' : 'stati associati'}`
                      : 'In attesa dei dati'
                    : `${covered}/${rows.length} progetti conteggiati`}
              </span>
            </div>
          )
        })}
      </div>
      <div className="metrics-footnote">
        <span>
          Tutti gli stati, indipendentemente dai filtri.
          {!single && ' Conteggi sommati per progetto.'}
        </span>
        <span>
          {available < rows.length
            ? `Dati disponibili: ${available}/${rows.length} progetti`
            : times.length
              ? `Aggiornato: ${date.format(Math.min(...times))}`
              : 'Nessun dato disponibile'}
        </span>
      </div>
    </section>
  )
}

export function MetricsDashboard({
  rows,
  onProject,
  onConfigure,
  syncing,
  onRefresh,
}: {
  rows: MetricRow[]
  onProject: (id: string) => void
  onConfigure: (id: string) => void
  syncing: boolean
  onRefresh: () => void
}) {
  const configured = rows.filter((row) => METRICS.some(({ id }) => row.mapping[id]?.length)).length
  return (
    <section className="metrics-dashboard" aria-label="Dashboard generale">
      <div className="dashboard-intro">
        <div>
          <h2>
            <BarChart3 size={18} /> Situazione per progetto
          </h2>
          <p>
            {rows.length} progetti visibili · {configured} con metriche configurate
          </p>
        </div>
        <button className="button secondary" disabled={syncing || !rows.length} onClick={onRefresh}>
          {syncing ? 'Aggiornamento…' : 'Aggiorna metriche'}
        </button>
      </div>
      <p className="dashboard-explanation">
        Ogni progetto traduce i propri stati nelle stesse metriche comuni. Una issue presente in più
        progetti viene conteggiata in ciascuno. «—» indica una metrica da configurare o dati non
        ancora disponibili.
      </p>
      {rows.length ? (
        <div className="dashboard-table-scroll">
          <table className="dashboard-table">
            <caption className="sr-only">Metriche comuni dei progetti visibili</caption>
            <thead>
              <tr>
                <th scope="col">Progetto</th>
                <th scope="col">Issue</th>
                {METRICS.map(({ id, label }) => (
                  <th scope="col" key={id}>
                    {label}
                  </th>
                ))}
                <th scope="col">Senza mapping</th>
                <th scope="col">
                  <span className="sr-only">Configurazione</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ project, summary, snapshot }) => (
                <tr key={project.id}>
                  <th scope="row">
                    <button className="dashboard-project" onClick={() => onProject(project.id)}>
                      <strong>{project.title}</strong>
                      <ArrowRight size={13} />
                    </button>
                    <span className="dashboard-project-meta">
                      {snapshot?.syncedAt
                        ? date.format(snapshot.syncedAt)
                        : 'In attesa della sincronizzazione'}
                    </span>
                  </th>
                  <td>{summary?.total ?? '—'}</td>
                  {METRICS.map(({ id, color }) => (
                    <td
                      key={id}
                      style={{ color }}
                      title={summary?.values[id] === null ? 'Nessuno stato associato' : undefined}
                    >
                      {summary?.values[id] ?? '—'}
                    </td>
                  ))}
                  <td className={summary?.unmapped ? 'metrics-unmapped' : ''}>
                    {summary?.unmapped ?? '—'}
                  </td>
                  <td>
                    <button
                      className="icon-button"
                      aria-label={`Configura metriche: ${project.title}`}
                      title="Configura metriche"
                      onClick={() => onConfigure(project.id)}
                    >
                      <Settings2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state">
          <BarChart3 size={28} />
          <h3>Nessun progetto visibile</h3>
          <p>Collega GitHub o mostra i progetti da Organizza progetti.</p>
        </div>
      )}
    </section>
  )
}

export function MetricSettings({
  row,
  close,
  save,
}: {
  row: MetricRow
  close: () => void
  save: (mapping: MetricMapping) => void
}) {
  const [mapping, setMapping] = useState<MetricMapping>(row.mapping)
  const dialog = useDialog(close)
  const known = row.snapshot?.statuses ?? []
  const options = statusOptions(
    known,
    METRICS.flatMap(({ id }) => mapping[id] ?? []),
  )
  const counts = new Map(row.snapshot?.counts.map((entry) => [entry.status, entry.total]))
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => event.target === event.currentTarget && close()}
    >
      <section
        ref={dialog}
        className="customization-modal metric-settings"
        role="dialog"
        aria-modal="true"
        aria-labelledby="metric-settings-title"
      >
        <div className="customization-heading">
          <div>
            <h2 id="metric-settings-title">Configura metriche</h2>
            <p>{row.project.title}</p>
          </div>
          <button
            className="icon-button"
            aria-label="Chiudi configurazione metriche"
            onClick={close}
          >
            <X size={19} />
          </button>
        </div>
        <p className="metric-settings-description">
          Seleziona uno o più stati del progetto per ogni numerica. Per Backlog scegli gli stati
          delle issue già stimate, in attesa di lavorazione. Le associazioni sono personali e
          vengono usate anche nella dashboard generale.
        </p>
        {!row.snapshot?.syncedAt && (
          <p className="notice" role="status">
            In attesa dei dati del progetto. Gli stati saranno disponibili dopo la sincronizzazione.
          </p>
        )}
        <div className="metric-settings-grid">
          {METRICS.map(({ id, label, color }) => {
            const selected = mapping[id] ?? []
            return (
              <fieldset key={id} style={{ '--metric-color': color } as CSSProperties}>
                <legend>
                  <i />
                  {label}
                </legend>
                <div className="metric-selection-actions">
                  <span>{selected.length} selezionati</span>
                  <button
                    type="button"
                    onClick={() =>
                      setMapping((current) => ({
                        ...current,
                        [id]: options.map((option) => option.name),
                      }))
                    }
                  >
                    Tutti
                  </button>
                  <button
                    type="button"
                    onClick={() => setMapping((current) => ({ ...current, [id]: [] }))}
                  >
                    Nessuno
                  </button>
                </div>
                <div className="metric-status-options">
                  {options.map(({ name }) => (
                    <label key={name}>
                      <input
                        type="checkbox"
                        checked={selected.includes(name)}
                        onChange={() =>
                          setMapping((current) => ({
                            ...current,
                            [id]: selected.includes(name)
                              ? selected.filter((value) => value !== name)
                              : [...selected, name],
                          }))
                        }
                      />
                      <span>
                        {name}
                        {!known.some((status) => status.name === name) &&
                          name !== 'Senza stato' && (
                            <small>Non presente tra gli stati attuali</small>
                          )}
                      </span>
                      <span className="metric-status-count">{counts.get(name) ?? 0}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )
          })}
        </div>
        <p className="metric-settings-description">
          Senza stati selezionati, la metrica mostra «—». Puoi usare lo stesso stato in più
          metriche: in quel caso i conteggi si sovrappongono. Sono incluse issue chiuse, pull
          request e bozze negli stati associati.
        </p>
        <div className="customization-footer">
          <button className="button secondary" onClick={close}>
            Annulla
          </button>
          <button className="button primary" onClick={() => save(mapping)}>
            Salva metriche
          </button>
        </div>
      </section>
    </div>
  )
}
