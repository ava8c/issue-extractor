import { useEffect, useId, useRef, useState } from 'react'
import { ArrowUpRight, FolderKanban, Hash, LoaderCircle, Search, X } from 'lucide-react'
import type { AtlasAPI, IssueLocation, Project } from '../shared/types'
import { errorMessage } from '../shared/errors'
import { useDialog } from './useDialog'

export function QuickIssueSearch({
  api,
  projects,
  openIssue,
  onClose,
  onActivityChange,
  indexVersion,
}: {
  api: AtlasAPI
  projects: Project[]
  openIssue: (location: IssueLocation) => void
  onClose: () => void
  onActivityChange: () => void
  indexVersion: number | null
}) {
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<IssueLocation[]>([])
  const [selected, setSelected] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const dialog = useDialog(onClose)
  const rows = useRef<(HTMLButtonElement | null)[]>([])
  const id = useId()
  const projectKey = JSON.stringify(projects.map((project) => project.id))
  const number = /^#?[1-9]\d*$/.test(query.trim()) ? Number(query.trim().replace('#', '')) : null
  const valid = number !== null && Number.isSafeInteger(number)
  useEffect(() => {
    if (!valid) return
    let active = true
    setLoading(true)
    const timer = setTimeout(() => {
      api
        .findIssues(number!, JSON.parse(projectKey))
        .then((result) => {
          if (!active) return
          setMatches(result.matches)
          setError(result.warnings.join(' · '))
          onActivityChange()
        })
        .catch((error) => {
          if (active) setError(errorMessage(error))
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }, 180)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [query, number, valid, projectKey, api, onActivityChange, indexVersion])
  useEffect(() => {
    rows.current[selected]?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  return (
    <div
      className="modal-backdrop quick-search-backdrop"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        ref={dialog}
        className="quick-issue-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
      >
        <div className="quick-search-input">
          <Search size={21} />
          <input
            role="combobox"
            aria-label="Numero issue"
            aria-expanded="true"
            aria-controls={`${id}-results`}
            aria-autocomplete="list"
            aria-activedescendant={matches[selected] ? `${id}-${selected}` : undefined}
            inputMode="numeric"
            maxLength={16}
            placeholder="Vai a issue… digita il numero"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setMatches([])
              setSelected(0)
              setError('')
              setLoading(false)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                setSelected((index) =>
                  Math.max(
                    0,
                    Math.min(matches.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
                  ),
                )
              }
              if (event.key === 'Enter' && matches[selected] && !loading) {
                event.preventDefault()
                openIssue(matches[selected])
              }
            }}
          />
          <button className="icon-button" aria-label="Chiudi ricerca rapida" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <div className="quick-search-heading">
          <h2 id={`${id}-title`}>Ricerca rapida</h2>
          <span>Nei progetti visibili, in tutti gli stati</span>
        </div>
        {error && (
          <p className="activity-error" role="status">
            {error}
          </p>
        )}
        <div
          id={`${id}-results`}
          className="quick-issue-results"
          role="listbox"
          aria-label="Issue e progetti"
          aria-busy={loading}
        >
          {matches.map((location, index) => (
            <button
              key={`${location.projectId}-${location.issue.id}`}
              id={`${id}-${index}`}
              role="option"
              aria-selected={selected === index}
              tabIndex={-1}
              ref={(element) => {
                rows.current[index] = element
              }}
              className={`quick-issue-result ${selected === index ? 'active' : ''}`}
              onMouseEnter={() => setSelected(index)}
              onClick={() => openIssue(location)}
            >
              <span className="quick-result-number">
                <Hash size={15} />
                {location.issue.number}
              </span>
              <span className="quick-result-main">
                <strong>{location.issue.title}</strong>
                <span>
                  {location.issue.repository} · {location.issue.status}
                </span>
                <span className="quick-result-project">
                  <FolderKanban size={13} />
                  {projects.find((project) => project.id === location.projectId)?.title ??
                    location.projectId}
                </span>
              </span>
              <ArrowUpRight size={16} />
            </button>
          ))}
          {!matches.length && (
            <div className="quick-search-empty">
              {loading ? (
                <>
                  <LoaderCircle className="spin" size={24} />
                  <p>Ricerca nei progetti…</p>
                  <span>Il primo controllo dei progetti può richiedere qualche istante.</span>
                </>
              ) : (
                <>
                  <Hash size={26} />
                  <p>
                    {!query
                      ? 'Quale issue vuoi aprire?'
                      : !valid
                        ? 'Inserisci un numero issue valido'
                        : error
                          ? 'Ricerca incompleta'
                          : `Nessuna issue #${number}`}
                  </p>
                  <span>
                    {!query
                      ? 'Digita un numero, anche con #. Scegli il progetto con le frecce.'
                      : valid
                        ? 'La ricerca include anche le issue escluse dai filtri della lista.'
                        : 'Per esempio: 1248 oppure #1248'}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        <footer className="quick-search-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> seleziona progetto
          </span>
          <span>
            <kbd>↵</kbd> apri issue
          </span>
          <span>
            <kbd>esc</kbd> chiudi
          </span>
        </footer>
      </section>
    </div>
  )
}
