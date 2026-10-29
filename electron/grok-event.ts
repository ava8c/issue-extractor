import type { IssueDetail, IssueNotification } from '../src/shared/types'
const author = (value?: { name?: string | null; login: string } | null) =>
  value?.name || value?.login
export function notificationEvent(
  notification: IssueNotification,
  projectTitle: string,
  detail: IssueDetail | null,
) {
  const issue = notification.issue
  const comments =
    notification.type === 'comment'
      ? (detail?.comments ?? [])
          .filter((item) => Date.parse(item.createdAt) <= notification.createdAt)
          .slice(-(notification.newCommentCount || 1))
      : []
  const actors = [...new Set((notification.actors || []).map(author).filter(Boolean))]
  return {
    tipo: 'issue',
    azione:
      notification.type === 'new-issue'
        ? 'nuova'
        : notification.type === 'status'
          ? 'cambio_stato'
          : 'commento',
    sorgente: 'GitHub',
    data: new Date(notification.createdAt).toISOString(),
    progetto: projectTitle,
    url: issue.url,
    ...(actors.length
      ? { autore: actors.join(', ') }
      : notification.type === 'new-issue' && author(detail?.author)
        ? { autore: author(detail?.author) }
        : {}),
    dati: {
      id: issue.number > 0 ? String(issue.number) : issue.id,
      titolo: issue.title,
      stato: notification.toStatus || issue.status || issue.state,
      ...(notification.fromStatus ? { stato_precedente: notification.fromStatus } : {}),
      repository: issue.repository,
      ...(detail?.assignees ? { assegnatario: detail.assignees.map(author).join(', ') } : {}),
      ...(detail?.body ? { descrizione: detail.body } : {}),
      ...(comments.length
        ? {
            commento: comments.map((item) => item.body).join('\n\n'),
            autore_commento: [
              ...new Set(comments.map((item) => author(item.author)).filter(Boolean)),
            ].join(', '),
            commenti: comments.map((item) => ({
              id: item.id,
              testo: item.body,
              autore: author(item.author),
              data: item.createdAt,
            })),
          }
        : {}),
    },
    ...(!detail
      ? {
          contenuto:
            'Dettagli GitHub temporaneamente non disponibili; metadati della notifica conservati.',
        }
      : {}),
  }
}
