import type { ComponentProps } from 'react'
import { ArrowDown, BookOpen, ChevronDown, FileText } from 'lucide-react'
import type { Author, IssueDetail } from '../shared/types'
import { Markdown } from './Markdown'

const dateFormat = new Intl.DateTimeFormat('it-IT', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})
const fullDateFormat = new Intl.DateTimeFormat('it-IT', {
  dateStyle: 'full',
  timeStyle: 'long',
})

export function authorName(author?: Author | null) {
  return author?.name?.trim() || author?.login?.trim() || 'Autore non disponibile'
}

export function revealConversationSource(id: string) {
  const source = document.getElementById(`estimate-source-${id}`)
  if (!source) return false
  const disclosure = source.closest('details')
  if (disclosure) disclosure.open = true
  source.scrollIntoView({
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    block: 'start',
  })
  source.focus({ preventScroll: true })
  return true
}

function MessageAuthor({
  author,
  createdAt,
  updatedAt,
}: {
  author?: Author | null
  createdAt: string
  updatedAt?: string
}) {
  const name = authorName(author)
  const words = name.split(/\s+/u)
  const initials = author
    ? [words[0][0], words.length > 1 ? words.at(-1)![0] : ''].join('').toLocaleUpperCase('it')
    : '?'
  const color =
    [...(author?.login || name)].reduce((sum, char) => sum + char.codePointAt(0)!, 0) % 4
  return (
    <header className="message-author">
      <span className={`author-avatar author-color-${color}`} aria-hidden="true">
        {initials}
      </span>
      <div className="author-identity">
        <strong title={author?.login ? `@${author.login}` : undefined}>{name}</strong>
        <div className="message-date">
          <time dateTime={createdAt} title={fullDateFormat.format(new Date(createdAt))}>
            {dateFormat.format(new Date(createdAt))}
          </time>
          {updatedAt && updatedAt !== createdAt && (
            <span title={`Modificato il ${fullDateFormat.format(new Date(updatedAt))}`}>
              {' '}
              · modificato
            </span>
          )}
        </div>
      </div>
    </header>
  )
}

type Props = Omit<ComponentProps<typeof Markdown>, 'body' | 'baseUrl'> & { issue: IssueDetail }

export function Conversation({ issue, ...markdownProps }: Props) {
  return (
    <div className="conversation">
      <details className="issue-description" open={!issue.comments.length}>
        <summary>
          <FileText size={17} />
          <strong>Descrizione dell’issue</strong>
          <span className="description-toggle">
            <span className="when-closed">Mostra</span>
            <span className="when-open">Riduci</span>
            <ChevronDown size={16} />
          </span>
        </summary>
        <div className="description-body" id="estimate-source-description" tabIndex={-1}>
          <MessageAuthor author={issue.author} createdAt={issue.createdAt} />
          <Markdown body={issue.body} baseUrl={issue.url} {...markdownProps} />
        </div>
      </details>
      <div className="conversation-heading">
        <h3>
          Conversazione <span>{issue.comments.length}</span>
        </h3>
        {issue.comments.length > 1 && (
          <button
            className="conversation-jump"
            onClick={() => revealConversationSource(issue.comments.at(-1)!.id)}
          >
            Ultimo commento <ArrowDown size={14} />
          </button>
        )}
      </div>
      {issue.kind === 'pull-request' && (
        <div className="notice">
          <BookOpen size={15} />
          <span>Le review inline del codice non sono incluse.</span>
        </div>
      )}
      <div className="conversation-messages">
        {issue.comments.map((comment) => (
          <article
            className="conversation-message"
            key={comment.id}
            id={`estimate-source-${comment.id}`}
            tabIndex={-1}
            aria-label={`Commento di ${authorName(comment.author)}`}
          >
            <MessageAuthor
              author={comment.author}
              createdAt={comment.createdAt}
              updatedAt={comment.updatedAt}
            />
            <div className="message-body">
              <Markdown body={comment.body} baseUrl={issue.url} {...markdownProps} />
            </div>
          </article>
        ))}
      </div>
      {!issue.comments.length && <p className="no-comments">Nessun commento, per ora.</p>}
    </div>
  )
}
