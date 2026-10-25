import { useRef } from 'react'
import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical, RotateCcw, X } from 'lucide-react'
import type { Project, ProjectStatus } from '../shared/types'
import {
  clampSidebar,
  moveBy,
  type ProjectPreferences,
  type WorkspacePreferences,
} from '../shared/preferences'

export function SidebarResizer({
  width,
  onResize,
}: {
  width: number
  onResize: (width: number) => void
}) {
  const drag = useRef<{ x: number; width: number } | null>(null)
  return (
    <div
      className="sidebar-resizer"
      role="separator"
      aria-label="Larghezza barra laterale"
      aria-orientation="vertical"
      aria-valuemin={180}
      aria-valuemax={420}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault()
        drag.current = { x: e.clientX, width }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        if (drag.current) onResize(clampSidebar(drag.current.width + e.clientX - drag.current.x))
      }}
      onPointerUp={() => {
        drag.current = null
      }}
      onPointerCancel={() => {
        drag.current = null
      }}
      onDoubleClick={() => onResize(232)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault()
          onResize(clampSidebar(width + (e.key === 'ArrowRight' ? 10 : -10)))
        }
      }}
      title="Trascina per ridimensionare · doppio clic per ripristinare"
    />
  )
}

export function ProjectManager({
  projects,
  preferences,
  updateProject,
  reorder,
  close,
}: {
  projects: Project[]
  preferences: WorkspacePreferences
  updateProject: (id: string, patch: Partial<ProjectPreferences>) => void
  reorder: (order: string[]) => void
  close: () => void
}) {
  const ids = projects.map((p) => p.id)
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <section
        className="customization-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-manager-title"
      >
        <div className="customization-heading">
          <div>
            <h2 id="project-manager-title">Organizza i progetti</h2>
            <p>
              Nomi e ordine sono personali, salvati nell’app. I progetti nascosti sono esclusi anche
              da “Tutte le issue”.
            </p>
          </div>
          <button className="icon-button" aria-label="Chiudi gestione progetti" onClick={close}>
            <X size={19} />
          </button>
        </div>
        <div className="project-manager-list">
          {projects.map((p, i) => {
            const preference = preferences.projects[p.id] ?? {}
            return (
              <div
                className={`project-manager-row ${preference.hidden ? 'hidden-project' : ''}`}
                key={p.id}
              >
                <GripVertical size={16} className="grip-decoration" />
                <div className="project-name-editor">
                  <label className="sr-only" htmlFor={`name-${p.id}`}>
                    Nome locale di {p.title}
                  </label>
                  <input
                    id={`name-${p.id}`}
                    value={preference.title ?? p.title}
                    maxLength={150}
                    onChange={(e) => updateProject(p.id, { title: e.target.value })}
                    placeholder={p.title}
                  />
                  <span>
                    {p.owner} · #{p.number} · GitHub: {p.title}
                  </span>
                </div>
                <div className="project-manager-actions">
                  <button
                    className="icon-button"
                    aria-label={`Sposta su ${preference.title || p.title}`}
                    disabled={i === 0}
                    onClick={() => reorder(moveBy(ids, p.id, -1))}
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Sposta giù ${preference.title || p.title}`}
                    disabled={i === projects.length - 1}
                    onClick={() => reorder(moveBy(ids, p.id, 1))}
                  >
                    <ArrowDown size={15} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`${preference.hidden ? 'Mostra' : 'Nascondi'} ${preference.title || p.title}`}
                    title={preference.hidden ? 'Mostra progetto' : 'Nascondi progetto'}
                    onClick={() => updateProject(p.id, { hidden: !preference.hidden })}
                  >
                    {preference.hidden ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Ripristina nome di ${p.title}`}
                    disabled={!preference.title}
                    onClick={() => updateProject(p.id, { title: undefined })}
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        <div className="customization-footer">
          <span>Puoi anche trascinare i progetti nella barra laterale.</span>
          <button className="button primary" onClick={close}>
            Fine
          </button>
        </div>
      </section>
    </div>
  )
}

export function StatusManager({
  statuses,
  custom,
  reorder,
  close,
}: {
  statuses: ProjectStatus[]
  custom: boolean
  reorder: (order: string[] | undefined) => void
  close: () => void
}) {
  const names = statuses.map((s) => s.name)
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <section
        className="customization-modal status-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="status-manager-title"
      >
        <div className="customization-heading">
          <div>
            <h2 id="status-manager-title">Ordine degli stati</h2>
            <p>
              Usato dalle colonne Kanban e dall’ordinamento “Stato progetto” della lista. La scelta
              viene ricordata per questo progetto.
            </p>
          </div>
          <button className="icon-button" aria-label="Chiudi ordine stati" onClick={close}>
            <X size={19} />
          </button>
        </div>
        <div className="order-source">
          {custom
            ? 'Ordine personalizzato nell’app'
            : 'Ordine delle opzioni del campo stato su GitHub'}
        </div>
        {statuses.map((status, i) => (
          <div className="status-manager-row" key={status.name}>
            <span className="status-order-number">{i + 1}</span>
            <strong>{status.name}</strong>
            <button
              className="icon-button"
              aria-label={`Sposta su stato ${status.name}`}
              disabled={!i}
              onClick={() => reorder(moveBy(names, status.name, -1))}
            >
              <ArrowUp size={16} />
            </button>
            <button
              className="icon-button"
              aria-label={`Sposta giù stato ${status.name}`}
              disabled={i === statuses.length - 1}
              onClick={() => reorder(moveBy(names, status.name, 1))}
            >
              <ArrowDown size={16} />
            </button>
          </div>
        ))}
        {!statuses.length && <p>Nessuno stato disponibile per questo progetto.</p>}
        <div className="customization-footer">
          <button
            className="button secondary"
            disabled={!custom}
            onClick={() => reorder(undefined)}
          >
            <RotateCcw size={14} />
            Ripristina ordine GitHub
          </button>
          <button className="button primary" onClick={close}>
            Fine
          </button>
        </div>
      </section>
    </div>
  )
}
