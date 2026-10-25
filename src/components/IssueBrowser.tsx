import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowUpDown,
  ChevronDown,
  CircleDashed,
  CircleDot,
  GripVertical,
  MessageSquare,
  Search,
  X,
} from 'lucide-react'
import type { Issue, ProjectStatus } from '../shared/types'
import { EstimateBadge } from './IssueEstimate'
import {
  matchesStatusFilter,
  statusOptions,
  type IssueSort,
  type StatusFilter,
} from '../shared/preferences'

export function StatusSelectionOptions({
  statuses,
  isSelected,
  toggle,
  includeDrafts,
  onDrafts,
}: {
  statuses: ProjectStatus[]
  isSelected: (name: string) => boolean
  toggle: (name: string) => void
  includeDrafts: boolean
  onDrafts: (value: boolean) => void
}) {
  return (
    <div className="status-filter-options">
      {statuses.map((status) => (
        <label key={status.name}>
          <input
            type="checkbox"
            checked={isSelected(status.name)}
            onChange={() => toggle(status.name)}
          />
          <span
            className="kanban-color"
            style={{ backgroundColor: colors[status.color ?? 'GRAY'] ?? colors.GRAY }}
          />
          <span>{status.name}</span>
        </label>
      ))}
      <label className="draft-option">
        <input
          type="checkbox"
          checked={includeDrafts}
          onChange={(event) => onDrafts(event.target.checked)}
        />
        <CircleDashed size={13} />
        <span>Bozze</span>
      </label>
    </div>
  )
}

function StatusMultiSelect({
  value,
  onChange,
  statuses,
  includeDrafts,
  onDrafts,
}: {
  value: StatusFilter
  onChange: (value: StatusFilter) => void
  statuses: ProjectStatus[]
  includeDrafts: boolean
  onDrafts: (value: boolean) => void
}) {
  const [position, setPosition] = useState<CSSProperties | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const popupId = useId()
  // Keep saved states available even while the project loads or a state is removed on GitHub.
  const options = statusOptions(statuses, value === 'all' ? [] : value)
  const selectionLabel =
    value === 'all'
      ? 'Tutti gli stati progetto'
      : value.length === 0
        ? 'Nessuno stato selezionato'
        : value.length === 1
          ? value[0]
          : `${value.length} stati selezionati`
  const label = `${selectionLabel}${includeDrafts ? '' : ' · senza bozze'}`

  function close(restoreFocus = false) {
    setPosition(null)
    if (restoreFocus) triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!position) return
    popupRef.current?.querySelector<HTMLInputElement>('input')?.focus()
    function outside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !popupRef.current?.contains(event.target) &&
        !triggerRef.current?.contains(event.target)
      )
        setPosition(null)
    }
    function dismiss() {
      setPosition(null)
    }
    function scroll(event: Event) {
      if (event.target instanceof Node && popupRef.current?.contains(event.target)) return
      dismiss()
    }
    document.addEventListener('pointerdown', outside)
    window.addEventListener('resize', dismiss)
    document.addEventListener('scroll', scroll, true)
    return () => {
      document.removeEventListener('pointerdown', outside)
      window.removeEventListener('resize', dismiss)
      document.removeEventListener('scroll', scroll, true)
    }
  }, [position])

  function toggle(name: string) {
    const selected = value === 'all' ? options.map((status) => status.name) : value
    onChange(
      selected.includes(name) ? selected.filter((status) => status !== name) : [...selected, name],
    )
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className="status-filter"
        aria-label={`Filtra stati progetto: ${label}`}
        aria-haspopup="dialog"
        aria-expanded={!!position}
        aria-controls={position ? popupId : undefined}
        title={
          value === 'all'
            ? label
            : `${value.join(', ') || selectionLabel}${includeDrafts ? '' : ' · senza bozze'}`
        }
        onKeyDown={(event) => {
          if (position && event.key === 'Escape') {
            event.stopPropagation()
            close()
          }
        }}
        onClick={() => {
          if (position) return close()
          const bounds = triggerRef.current!.getBoundingClientRect()
          const width = Math.min(Math.max(bounds.width, 280), window.innerWidth - 24)
          const below = window.innerHeight - bounds.bottom - 18
          const above = bounds.top - 18
          const opensAbove = below < 240 && above > below
          setPosition({
            left: Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12)),
            width,
            maxHeight: Math.min(360, opensAbove ? above : below),
            ...(opensAbove
              ? { bottom: window.innerHeight - bounds.top + 6 }
              : { top: bounds.bottom + 6 }),
          })
        }}
      >
        <span>{label}</span>
        <ChevronDown size={14} />
      </button>
      {position &&
        createPortal(
          <div
            ref={popupRef}
            id={popupId}
            role="dialog"
            aria-label="Filtra stati progetto"
            className="status-filter-popup"
            style={position}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                close(true)
              }
            }}
            onBlur={(event) => {
              if (
                event.relatedTarget instanceof Node &&
                !event.currentTarget.contains(event.relatedTarget) &&
                !triggerRef.current?.contains(event.relatedTarget)
              )
                close()
            }}
          >
            <div className="status-filter-heading">
              <strong>Stati del progetto</strong>
              <button type="button" aria-label="Chiudi filtro stati" onClick={() => close(true)}>
                <X size={15} />
              </button>
            </div>
            <div className="status-filter-actions">
              <button
                type="button"
                onClick={() => {
                  onChange('all')
                  onDrafts(true)
                }}
              >
                Tutti
              </button>
              <button
                type="button"
                onClick={() => {
                  onChange([])
                  onDrafts(false)
                }}
              >
                Nessuno
              </button>
            </div>
            <StatusSelectionOptions
              statuses={options}
              isSelected={(name) => matchesStatusFilter(name, value)}
              toggle={toggle}
              includeDrafts={includeDrafts}
              onDrafts={onDrafts}
            />
            <div className="status-filter-hint">
              Le bozze seguono gli stati selezionati. Scelta salvata per progetto.
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}

export function IssueFilters({
  searchRef,
  query,
  onQuery,
  state,
  onState,
  repo,
  onRepo,
  status,
  onStatus,
  includeDrafts,
  onDrafts,
  sort,
  onSort,
  repositories,
  statuses,
  count,
}: {
  searchRef: RefObject<HTMLInputElement | null>
  query: string
  onQuery: (value: string) => void
  state: string
  onState: (value: string) => void
  repo: string
  onRepo: (value: string) => void
  status: StatusFilter
  onStatus: (value: StatusFilter) => void
  includeDrafts: boolean
  onDrafts: (value: boolean) => void
  sort: IssueSort
  onSort: (value: IssueSort) => void
  repositories: string[]
  statuses: ProjectStatus[]
  count: number
}) {
  return (
    <div className="issue-controls">
      <div className="issue-search">
        <Search size={16} />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Cerca titolo, #numero, repository…"
          aria-label="Cerca issue"
        />
        <kbd>⌘ K</kbd>
      </div>
      <div className="filters">
        <select
          aria-label="Filtra apertura issue"
          value={state}
          onChange={(e) => onState(e.target.value)}
        >
          <option value="all">Aperte e chiuse</option>
          <option value="open">Aperte</option>
          <option value="closed">Chiuse</option>
        </select>
        <select
          aria-label="Filtra repository"
          value={repo}
          onChange={(e) => onRepo(e.target.value)}
        >
          <option value="all">Tutti i repository</option>
          {repositories.map((r) => (
            <option value={r} key={r}>
              {r.split('/').pop()}
            </option>
          ))}
        </select>
        <StatusMultiSelect
          value={status}
          onChange={onStatus}
          statuses={statuses}
          includeDrafts={includeDrafts}
          onDrafts={onDrafts}
        />
      </div>
      <div className="list-heading">
        <span>
          {count} ISSUE<span className="list-heading-divider">/</span>
          {state === 'all' ? 'Tutte' : state === 'open' ? 'Aperte' : 'Chiuse'}
        </span>
        <div>
          <ArrowUpDown size={13} />
          <select
            aria-label="Ordina issue"
            value={sort}
            onChange={(e) => onSort(e.target.value as IssueSort)}
          >
            <option value="status">Stato progetto</option>
            <option value="updated">Aggiornamento</option>
            <option value="created">Creazione</option>
            <option value="title">Titolo</option>
          </select>
        </div>
      </div>
    </div>
  )
}

const colors: Record<string, string> = {
  RED: '#b43d55',
  ORANGE: '#a55620',
  YELLOW: '#966918',
  GREEN: '#287551',
  BLUE: '#2e67b1',
  PURPLE: '#7151b7',
  PINK: '#a44e86',
  GRAY: '#68758a',
}
export function KanbanBoard({
  issues,
  estimates,
  statuses,
  activeStatus,
  selected,
  select,
  reorder,
}: {
  issues: Issue[]
  estimates?: Record<string, import('../shared/estimates').IssueEstimate[]>
  statuses: ProjectStatus[]
  activeStatus: StatusFilter
  selected: string | undefined
  select: (issue: Issue) => void
  reorder: (moving: string, before: string) => void
}) {
  const columns = statuses.filter((s) => matchesStatusFilter(s.name, activeStatus))
  const grouped = useMemo(() => {
    const result = new Map<string, Issue[]>()
    for (const issue of issues) {
      const cards = result.get(issue.status)
      if (cards) cards.push(issue)
      else result.set(issue.status, [issue])
    }
    return result
  }, [issues])
  return (
    <div className="kanban-board" aria-label="Vista Kanban">
      {columns.map((status) => {
        const cards = grouped.get(status.name) ?? []
        const color = colors[status.color ?? 'GRAY'] ?? colors.GRAY
        return (
          <section
            className="kanban-column"
            aria-label={`Colonna ${status.name}`}
            key={status.name}
          >
            <header
              className="kanban-column-heading"
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/atlas-status', status.name)
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes('text/atlas-status')) e.preventDefault()
              }}
              onDrop={(e) => {
                e.preventDefault()
                reorder(e.dataTransfer.getData('text/atlas-status'), status.name)
              }}
              title="Trascina per riordinare le colonne nell’app"
            >
              <span className="kanban-color" style={{ backgroundColor: color }} />
              <h3>{status.name}</h3>
              <span className="kanban-count">{cards.length}</span>
              <GripVertical size={14} />
            </header>
            <div className="kanban-cards">
              {cards.map((issue) => (
                <button
                  key={issue.id}
                  className={`kanban-card ${selected === issue.id ? 'selected' : ''}`}
                  onClick={() => select(issue)}
                >
                  <span className="kanban-card-reference">
                    <span className="issue-number">#{issue.number || 'bozza'}</span>
                    <span>
                      {issue.state === 'CLOSED' || issue.state === 'MERGED'
                        ? 'Chiusa'
                        : issue.kind === 'draft'
                          ? 'Bozza'
                          : 'Aperta'}
                    </span>
                  </span>
                  <strong>{issue.title}</strong>
                  <span className="kanban-card-repository">{issue.repository}</span>
                  <EstimateBadge values={estimates?.[issue.id]} />
                  <span className="kanban-card-footer">
                    <span className="kanban-card-label">
                      {issue.labels[0]?.name || (
                        <>
                          <CircleDot size={11} />
                          {status.name}
                        </>
                      )}
                    </span>
                    <span>
                      <MessageSquare size={12} />
                      {issue.commentCount}
                    </span>
                  </span>
                </button>
              ))}
              {!cards.length && <div className="kanban-empty">Nessuna issue</div>}
            </div>
          </section>
        )
      })}
      {!columns.length && (
        <div className="empty-state">
          <p>
            {activeStatus !== 'all' && activeStatus.length === 0
              ? 'Nessuno stato selezionato. Seleziona almeno uno stato nel filtro.'
              : 'Nessuna colonna disponibile. Aggiungi issue o verifica il campo Status del progetto.'}
          </p>
        </div>
      )}
    </div>
  )
}
