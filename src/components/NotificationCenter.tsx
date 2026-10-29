import { useMemo, useState } from 'react'
import {
  ArrowRight,
  Bell,
  CheckCheck,
  CircleDot,
  MessageSquare,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react'
import type { IssueLocation, IssueNotification, NotificationType, Project } from '../shared/types'
import { useDialog } from './useDialog'

const time = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' })
const date = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })
const labels = { status: 'Stato', 'new-issue': 'Nuove issue', comment: 'Commenti' }
function NotificationIcon({ type }: { type: NotificationType }) {
  return type === 'status' ? (
    <CircleDot size={17} />
  ) : type === 'comment' ? (
    <MessageSquare size={17} />
  ) : (
    <Plus size={17} />
  )
}

export function NotificationCenter({
  items,
  projects,
  lastCheckedAt,
  syncing,
  error,
  nativeError,
  onRefresh,
  onRead,
  onOpen,
  onClose,
}: {
  items: IssueNotification[]
  projects: Project[]
  lastCheckedAt: number | null
  syncing: boolean
  error: string
  nativeError?: string
  onRefresh: () => void
  onRead: (ids: string[]) => void
  onOpen: (location: IssueLocation) => void
  onClose: () => void
}) {
  const [filter, setFilter] = useState<NotificationType | 'all'>('all')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const dialog = useDialog(onClose)
  const unread = items.filter((item) => !item.read)
  const groups = useMemo(() => {
    const result = new Map<string, IssueNotification[]>()
    const sorted = items
      .filter((item) => (filter === 'all' || filter === item.type) && (!unreadOnly || !item.read))
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
    for (const item of sorted) {
      const day = date.format(new Date(item.createdAt))
      const group = result.get(day)
      if (group) group.push(item)
      else result.set(day, [item])
    }
    return result
  }, [items, filter, unreadOnly])
  return (
    <div
      className="notification-backdrop"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        ref={dialog}
        className="notification-center"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-title"
      >
        <header className="notification-header">
          <div>
            <Bell size={21} />
            <h2 id="notification-title">Notifiche</h2>
            <span className="notification-total">{unread.length} da leggere</span>
          </div>
          <button className="icon-button" aria-label="Chiudi notifiche" onClick={onClose}>
            <X size={19} />
          </button>
        </header>
        <p className="notification-description">
          I cambiamenti nei tuoi progetti, dal più recente.
        </p>
        <div className="notification-tabs" role="tablist" aria-label="Tipo notifica">
          {(['all', 'status', 'new-issue', 'comment'] as const).map((type) => (
            <button
              key={type}
              role="tab"
              aria-selected={filter === type}
              aria-controls="notification-results"
              onClick={() => setFilter(type)}
            >
              {type === 'all' ? 'Tutte' : labels[type]}
              <span>
                {
                  items.filter((item) => !item.read && (type === 'all' || item.type === type))
                    .length
                }
              </span>
            </button>
          ))}
        </div>
        <div className="notification-tools">
          <label>
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(event) => setUnreadOnly(event.target.checked)}
            />
            Solo da leggere
          </label>
          <button disabled={!unread.length} onClick={() => onRead(unread.map((item) => item.id))}>
            <CheckCheck size={14} />
            Segna tutte come lette
          </button>
        </div>
        {error && (
          <p className="activity-error" role="status">
            Aggiornamento incompleto: {error}. I dati precedenti sono conservati.
          </p>
        )}
        {nativeError && (
          <p className="activity-error" role="status">
            {nativeError}
          </p>
        )}
        <div
          className="notification-results"
          id="notification-results"
          role="tabpanel"
          aria-label={filter === 'all' ? 'Tutte le notifiche' : labels[filter]}
          aria-busy={syncing}
        >
          {[...groups].map(([day, notifications]) => (
            <section key={day}>
              <h3 className="notification-day">{day}</h3>
              {notifications.map((item) => (
                <article
                  className={`notification-item ${item.read ? 'read' : 'unread'}`}
                  key={item.id}
                >
                  <button
                    className="notification-open"
                    onClick={() => {
                      onRead([item.id])
                      onOpen(item)
                    }}
                  >
                    <span className={`notification-kind kind-${item.type}`}>
                      <NotificationIcon type={item.type} />
                    </span>
                    <span className="notification-copy">
                      <span className="notification-item-meta">
                        {labels[item.type]} · {time.format(new Date(item.createdAt))}
                        {!item.read && <i aria-label="Non letta" />}
                      </span>
                      <strong>
                        #{item.issue.number || 'bozza'} {item.issue.title}
                      </strong>
                      <span className="notification-change">
                        {item.type === 'status' ? (
                          <>
                            {item.fromStatus}
                            <ArrowRight size={12} />
                            {item.toStatus}
                          </>
                        ) : item.type === 'comment' ? (
                          `${item.newCommentCount} ${item.newCommentCount === 1 ? 'nuovo commento' : 'nuovi commenti'}`
                        ) : (
                          'Aggiunta al progetto'
                        )}
                      </span>
                      <span className="notification-project">
                        {projects.find((project) => project.id === item.projectId)?.title ??
                          item.projectId}{' '}
                        · {item.issue.repository}
                      </span>
                    </span>
                  </button>
                  {!item.read && (
                    <button
                      className="notification-read"
                      title="Segna come letta"
                      aria-label={`Segna come letta: #${item.issue.number}`}
                      onClick={() => onRead([item.id])}
                    >
                      <CheckCheck size={15} />
                    </button>
                  )}
                </article>
              ))}
            </section>
          ))}
          {!groups.size && (
            <div className="notification-empty">
              <Bell size={30} />
              <h3>{syncing ? 'Controllo degli aggiornamenti…' : 'Nessuna notifica da mostrare'}</h3>
              <p>
                {filter !== 'all' || unreadOnly
                  ? 'Prova un altro tipo o mostra anche le notifiche lette.'
                  : 'Dal primo controllo raccogliamo nuove issue, cambi di stato e nuovi commenti.'}
              </p>
            </div>
          )}
        </div>
        <footer className="notification-footer">
          <span>
            Controllo ogni 2 minuti con l’app aperta.
            <br />
            {lastCheckedAt
              ? `Ultimo controllo: ${date.format(new Date(lastCheckedAt))}, ${time.format(new Date(lastCheckedAt))}`
              : 'Primo controllo in preparazione.'}
          </span>
          <button className="button secondary" disabled={syncing} onClick={onRefresh}>
            <RefreshCw size={14} className={syncing ? 'spin' : ''} />
            Aggiorna
          </button>
        </footer>
      </section>
    </div>
  )
}
