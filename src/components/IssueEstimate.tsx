import { Calculator, TriangleAlert } from 'lucide-react'
import { formatEstimate, type IssueEstimate } from '../shared/estimates'
import type { AtlasAPI, Project } from '../shared/types'

export function EstimateBadge({ values }: { values?: IssueEstimate[] }) {
  if (!values?.length) return null
  const value = values[0]
  const label =
    value.state === 'pending'
      ? 'Stima in attesa'
      : value.state === 'error' && !value.entries.length
        ? 'Stima non disponibile'
        : formatEstimate(value)
  const review = values.some(
    (item) => item.entries.length > 0 && ['review', 'error'].includes(item.state),
  )
  return (
    <span
      className={`estimate-badge ${review ? 'estimate-review' : ''}`}
      title={values
        .map(
          (item) =>
            `${formatEstimate(item)}${item.state === 'error' ? ` · ${item.error}` : item.needsReview && item.entries.length ? ' · Da verificare' : ''}`,
        )
        .join('\n')}
    >
      {review ? <TriangleAlert size={12} /> : <Calculator size={12} />}
      {label}
      {review && ' · verifica'}
      {new Set(values.map(formatEstimate)).size > 1 && ' · più progetti'}
    </span>
  )
}
export function IssueEstimatePanel({
  values,
  projects,
  api,
  running,
  notify,
  openSource,
  expanded = false,
}: {
  expanded?: boolean
  values: IssueEstimate[]
  projects: Project[]
  api: AtlasAPI
  running: boolean
  notify: (text: string, error?: boolean) => void
  openSource: (id: string) => void
}) {
  if (!values.length) return null
  return (
    <section className="issue-estimates" aria-label="Stime estratte">
      {values.map((value) => {
        const max = value.entries.reduce(
          (sum, entry) => sum + entry.max * (entry.unit === 'days' ? value.hoursPerDay : 1),
          0,
        )
        const hours = (amount: number) =>
          amount.toLocaleString('it-IT', { maximumFractionDigits: 2 })
        return (
          <details key={value.projectId} className="estimate-detail" open={expanded}>
            <summary>
              <EstimateBadge values={[value]} />
              <span>
                {projects.find((project) => project.id === value.projectId)?.title ??
                  'Stima progetto'}
              </span>
            </summary>
            {value.entries.length > 0 && (
              <p>
                Totale: <strong>{formatEstimate(value)}</strong> · {hours(max)} h (
                {value.hoursPerDay} h/giorno)
              </p>
            )}
            {value.note && <p>{value.note}</p>}
            {value.needsReview && value.entries.length > 0 && (
              <p className="estimate-review">
                Da verificare: il totale contiene solo le quantità esplicite.
              </p>
            )}
            {value.error && (
              <p className="estimate-review" role="status">
                {value.error} {value.entries.length > 0 && 'È mostrata l’ultima stima disponibile.'}
              </p>
            )}
            {value.monitoring === false && (
              <p>Monitoraggio sospeso per le regole attuali del progetto.</p>
            )}
            {value.entries.map((entry, index) => (
              <div className="estimate-source" key={index}>
                <strong>
                  {entry.label} · {formatEstimate({ entries: [entry] })}
                </strong>
                <blockquote>{entry.excerpt}</blockquote>
                <button className="text-button" onClick={() => openSource(entry.sourceId)}>
                  Vai alla fonte nella conversazione
                </button>
              </div>
            ))}
            <div className="estimate-detail-footer">
              <span>
                {value.checkedAt
                  ? new Date(value.checkedAt).toLocaleString('it-IT')
                  : 'Analisi non completata'}{' '}
                · {value.model}
              </span>
              <button
                className="text-button"
                disabled={running || value.monitoring === false}
                onClick={() => {
                  void api
                    .recalculateEstimate(value.projectId, value.issueId)
                    .catch((e) => notify(e.message, true))
                }}
              >
                Ricalcola da tutta la conversazione
              </button>
            </div>
          </details>
        )
      })}
    </section>
  )
}
