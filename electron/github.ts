import type {
  Comment,
  Issue,
  IssueDetail,
  Project,
  SettingsInput,
  Workspace,
  ProjectLayout,
  IssueNotification,
  Author,
} from '../src/shared/types'
import { mapConcurrent } from '../src/shared/loading'
import type { EstimateBaseline, EstimateContent } from '../src/shared/estimates'
import { GITHUB_UNAVAILABLE, isGitHubUnavailable } from '../src/shared/errors'

export function normalizeHost(value: string): string {
  const url = new URL(value.trim())
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Inserisci un indirizzo GitHub HTTPS valido.')
  return url.origin
}

export function endpoints(host: string) {
  const origin = normalizeHost(host)
  return origin === 'https://github.com'
    ? { graphql: 'https://api.github.com/graphql', rest: 'https://api.github.com' }
    : { graphql: `${origin}/api/graphql`, rest: `${origin}/api/v3` }
}

const PAGE = 'pageInfo { hasNextPage endCursor }'
const PROJECT =
  'id title number url shortDescription closed owner { ... on Organization { login } ... on User { login } }'
const ISSUE = `id number title body url state createdAt updatedAt repository { nameWithOwner } labels(first: 30) { nodes { name color } } comments { totalCount }`
const AUTHOR = `author { login ... on User { name } ... on Organization { name } }`
const SUMMARY = ISSUE.replace(' body ', ' ')
const PR_SUMMARY = SUMMARY.replace(' state ', ' pullRequestState: state ')
const CONTENT_INDEX =
  '__typename ... on Issue { id updatedAt } ... on PullRequest { id updatedAt } ... on DraftIssue { id updatedAt }'

interface ItemIndex {
  fieldValueByName?: { name: string } | null
  content?: { id: string; updatedAt: string; __typename: string } | null
}

export class GitHubClient {
  private login = ''
  private identityRequest: Promise<string> | null = null
  private urls: ReturnType<typeof endpoints>
  private supportsItemQuery = true
  private contentRequests = new Map<string, Promise<EstimateContent>>()
  private recentContent = new Map<string, { value: EstimateContent; expiresAt: number }>()
  constructor(
    private config: SettingsInput,
    private token: string,
    urls?: ReturnType<typeof endpoints>,
  ) {
    this.urls = urls ?? endpoints(config.host)
  }

  private async request(url: string, init: RequestInit = {}) {
    let response: Response
    try {
      response = await fetch(url, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          ...init.headers,
        },
      })
    } catch {
      throw new Error(GITHUB_UNAVAILABLE)
    }
    if (!response.ok) {
      const retry = response.headers.get('retry-after')
      if (response.status === 401)
        throw new Error('Token non valido o scaduto. Aggiornalo nelle impostazioni.')
      if (response.status === 403 || response.status === 429)
        throw new Error(
          `Accesso negato o limite API raggiunto. Verifica permessi e autorizzazione SSO.${retry ? ` Riprova tra ${retry} secondi.` : ''}`,
        )
      if (response.status === 404)
        throw new Error('Risorsa non trovata o non accessibile con questo token.')
      throw new Error(`GitHub ha risposto con errore ${response.status}. Riprova più tardi.`)
    }
    try {
      return await response.json()
    } catch {
      throw new Error(
        'Risposta GitHub non valida. Verifica che l’indirizzo punti a GitHub Enterprise.',
      )
    }
  }

  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const result = await this.request(this.urls.graphql, {
      method: 'POST',
      body: JSON.stringify({ query, variables }),
    })
    if (result.errors?.length) {
      const message = result.errors.map((e: { message: string }) => e.message).join(' · ')
      throw new Error(
        `GitHub GraphQL: ${message}. Verifica i permessi Projects e repository del token.`,
      )
    }
    if (!result.data) throw new Error('GitHub non ha restituito dati.')
    return result.data as T
  }

  async testConnection() {
    const result = await this.graphql<{ viewer: { login: string } }>(
      'query Identity { viewer { login } }',
    )
    this.login = result.viewer.login
    return this.login
  }

  async authenticatedLogin(): Promise<string> {
    if (this.login) return this.login
    if (this.identityRequest) return this.identityRequest
    const request = this.testConnection()
    this.identityRequest = request
    try {
      return await request
    } finally {
      if (this.identityRequest === request) this.identityRequest = null
    }
  }

  private async connection<T>(
    query: string,
    variables: Record<string, unknown>,
    select: (data: any) => any,
  ): Promise<T[]> {
    const nodes: T[] = []
    let cursor: string | null = null
    do {
      const data = await this.graphql(query, { ...variables, cursor })
      const page = select(data)
      if (!page) throw new Error('Risorsa non accessibile. Verifica il token e l’organizzazione.')
      nodes.push(...page.nodes.filter(Boolean))
      if (
        page.pageInfo.hasNextPage &&
        (!page.pageInfo.endCursor || page.pageInfo.endCursor === cursor)
      )
        throw new Error('Paginazione GitHub interrotta: aggiorna per recuperare tutti i dati.')
      cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null
    } while (cursor)
    return nodes
  }

  async projects(): Promise<Workspace> {
    const login = await this.testConnection()
    const warnings: string[] = []
    const organizations = new Set(this.config.organizations.map((o) => o.trim()).filter(Boolean))
    try {
      const discovered = await this.connection<{ login: string }>(
        `query Organizations($cursor: String) { viewer { organizations(first: 100, after: $cursor) { nodes { login } ${PAGE} } } }`,
        {},
        (d) => d.viewer.organizations,
      )
      discovered.forEach((o) => organizations.add(o.login))
    } catch (e) {
      if (isGitHubUnavailable(e)) throw e
      warnings.push(`Scoperta organizzazioni: ${(e as Error).message}`)
    }
    const projects: Project[] = []
    const map = (p: any): Project => ({
      ...p,
      description: p.shortDescription ?? '',
      owner: p.owner.login,
    })
    const owners = [
      { login, type: 'user' },
      ...[...organizations].map((login) => ({ login, type: 'organization' })),
    ]
    const ownerProjects = await mapConcurrent(owners, 3, async (owner) => {
      try {
        const nodes = await this.connection<any>(
          `query Projects($owner: String!, $cursor: String) { ${owner.type}(login: $owner) { projectsV2(first: 50, after: $cursor, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { ${PROJECT} } ${PAGE} } } }`,
          { owner: owner.login },
          (d) => d[owner.type]?.projectsV2,
        )
        return nodes.map(map)
      } catch (e) {
        if (isGitHubUnavailable(e)) throw e
        warnings.push(`${owner.login}: ${(e as Error).message}`)
        return []
      }
    })
    projects.push(...ownerProjects.flat())
    for (const value of this.config.projectUrls) {
      try {
        const url = new URL(value)
        if (url.origin !== normalizeHost(this.config.host))
          throw new Error('L’URL deve appartenere all’istanza configurata.')
        const match = url.pathname.match(/^\/(orgs|users)\/([^/]+)\/projects\/(\d+)(?:\/|$)/)
        if (!match) throw new Error('URL Projects v2 non riconosciuto.')
        const type = match[1] === 'orgs' ? 'organization' : 'user'
        const data = await this.graphql<any>(
          `query ProjectByNumber($owner: String!, $number: Int!) { ${type}(login: $owner) { projectV2(number: $number) { ${PROJECT} } } }`,
          { owner: match[2], number: Number(match[3]) },
        )
        if (!data[type]?.projectV2) throw new Error('Progetto non accessibile.')
        projects.push(map(data[type].projectV2))
      } catch (e) {
        if (isGitHubUnavailable(e)) throw e
        warnings.push(`Progetto aggiunto: ${(e as Error).message}`)
      }
    }
    if (!projects.length && warnings.length) throw new Error(warnings.join('\n'))
    return { login, projects: [...new Map(projects.map((p) => [p.id, p])).values()], warnings }
  }

  async projectLayout(projectId: string): Promise<ProjectLayout> {
    const fields = await this.connection<any>(
      `query ProjectFields($id: ID!, $cursor: String) { node(id: $id) { ... on ProjectV2 { fields(first: 100, after: $cursor) { nodes { ... on ProjectV2SingleSelectField { id name options { id name color } } } ${PAGE} } } } }`,
      { id: projectId },
      (d) => d.node?.fields,
    )
    const status =
      fields.find((field) => /^status$/i.test(field.name)) ??
      fields.find((field) => /^stato$/i.test(field.name))
    return { statusFieldName: status?.name ?? 'Status', statuses: status?.options ?? [] }
  }

  async activityItems(projectId: string, statusFieldName = 'Status'): Promise<Issue[]> {
    // Independent of list filters: a transition out of a selected state must still be observed.
    const fields = SUMMARY.replace(' labels(first: 30) { nodes { name color } }', '')
    const pullRequest = fields.replace(' state ', ' pullRequestState: state ')
    const nodes = await this.connection<any>(
      `query ProjectActivityItems($id: ID!, $cursor: String, $statusFieldName: String!) { node(id: $id) { ... on ProjectV2 { items(first: 100, after: $cursor) { nodes { ${AUTHOR.replace('author', 'creator')} fieldValueByName(name: $statusFieldName) { ... on ProjectV2ItemFieldSingleSelectValue { name } } content { __typename ... on Issue { ${fields} } ... on PullRequest { ${pullRequest} } ... on DraftIssue { id title createdAt updatedAt } } } ${PAGE} } } } }`,
      { id: projectId, statusFieldName },
      (data) => data.node?.items,
    )
    return nodes
      .filter((node) => node.content?.id)
      .map((node) => {
        const c = node.content
        return {
          id: c.id,
          number: c.number ?? 0,
          title: c.title,
          body: '',
          url: c.url ?? '',
          repository: c.repository?.nameWithOwner ?? 'Bozza del progetto',
          state: c.state ?? c.pullRequestState ?? 'DRAFT',
          status: node.fieldValueByName?.name ?? 'Senza stato',
          labels: [],
          commentCount: c.comments?.totalCount ?? 0,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          kind:
            c.__typename === 'DraftIssue'
              ? 'draft'
              : c.__typename === 'PullRequest'
                ? 'pull-request'
                : 'issue',
          projectItemCreator: node.creator ?? null,
        }
      })
  }

  async notificationActors(
    notification: IssueNotification,
    previous: Issue | undefined,
    since: number,
  ): Promise<(Author | null)[]> {
    const issue = notification.issue
    if (notification.type === 'new-issue') return [issue.projectItemCreator ?? null]
    if (issue.kind === 'draft') return [null]
    const type = issue.kind === 'pull-request' ? 'PullRequest' : 'Issue'
    if (notification.type === 'comment') {
      const count = notification.newCommentCount ?? 0
      if (count <= 0) return [null]
      const actors: (Author | null)[] = []
      let before: string | null = null
      do {
        const data: any = await this.graphql(
          `query NotificationCommentActors($id: ID!, $before: String, $last: Int!) { node(id: $id) { ... on ${type} { comments(last: $last, before: $before) { totalCount nodes { ${AUTHOR} } pageInfo { hasPreviousPage startCursor } } } } }`,
          { id: issue.id, before, last: Math.min(100, count - actors.length) },
        )
        const page = data.node?.comments
        if (!page || page.totalCount !== issue.commentCount) return [null]
        actors.unshift(...page.nodes.map((comment: any) => comment?.author ?? null))
        if (actors.length >= count) return actors
        if (
          !page.pageInfo.hasPreviousPage ||
          !page.pageInfo.startCursor ||
          page.pageInfo.startCursor === before
        )
          return [null]
        before = page.pageInfo.startCursor
      } while (before)
      return [null]
    }
    if (!previous) return [null]
    const projectChanged = previous.status !== issue.status
    const stateChanged = previous.state !== issue.state
    const actor = AUTHOR.replace('author', 'actor')
    const events = await this.connection<any>(
      `query NotificationStatusActors($id: ID!, $cursor: String, $since: DateTime!) { node(id: $id) { ... on ${type} { timelineItems(first: 100, after: $cursor, since: $since) { nodes { __typename ${projectChanged ? `... on ProjectV2ItemStatusChangedEvent { ${actor} project { id } status wasAutomated }` : ''} ${stateChanged ? `... on ClosedEvent { ${actor} } ... on ReopenedEvent { ${actor} } ${type === 'PullRequest' ? `... on MergedEvent { ${actor} }` : ''}` : ''} } ${PAGE} } } } }`,
      { id: issue.id, since: new Date(since).toISOString() },
      (data) => data.node?.timelineItems,
    )
    const latest = events.reverse()
    const actors: (Author | null)[] = []
    if (projectChanged) {
      const event = latest.find(
        (event) =>
          event.__typename === 'ProjectV2ItemStatusChangedEvent' &&
          event.project?.id === notification.projectId,
      )
      actors.push(
        event?.status === issue.status && !event.wasAutomated ? (event.actor ?? null) : null,
      )
    }
    if (stateChanged) {
      const kind =
        issue.state === 'CLOSED'
          ? 'ClosedEvent'
          : issue.state === 'MERGED'
            ? 'MergedEvent'
            : 'ReopenedEvent'
      const event = latest.find((event) =>
        ['ClosedEvent', 'ReopenedEvent', 'MergedEvent'].includes(event.__typename),
      )
      actors.push(event?.__typename === kind ? (event.actor ?? null) : null)
    }
    return actors
  }

  async issues(
    projectId: string,
    statusFieldName = 'Status',
    statuses?: string[],
    previous: Issue[] = [],
  ): Promise<Issue[]> {
    if (statuses?.length === 0) return []
    // Older Enterprise schemas lack items(query:). Fall back only for that schema error.
    // Unusual field/option names and "Senza stato" use exact local matching instead.
    const search =
      statuses &&
      /^[\p{L}\p{N}_-]+$/u.test(statusFieldName) &&
      statuses.every((name) => name !== 'Senza stato' && !/["\\,\n\r]/.test(name))
        ? `${statusFieldName.toLowerCase()}:${statuses.map((name) => JSON.stringify(name)).join(',')}`
        : undefined
    const readIndex = (filtered: boolean) =>
      this.connection<ItemIndex>(
        `query ProjectItems($id: ID!, $cursor: String, $statusFieldName: String!${filtered ? ', $query: String!' : ''}) { node(id: $id) { ... on ProjectV2 { items(first: 100, after: $cursor${filtered ? ', query: $query' : ''}) { nodes { fieldValueByName(name: $statusFieldName) { ... on ProjectV2ItemFieldSingleSelectValue { name } } content { ${CONTENT_INDEX} } } ${PAGE} } } } }`,
        { id: projectId, statusFieldName, ...(filtered ? { query: search } : {}) },
        (d) => d.node?.items,
      )
    let nodes: ItemIndex[]
    const filtered = !!search && this.supportsItemQuery
    try {
      nodes = await readIndex(filtered)
    } catch (error) {
      if (
        !filtered ||
        !/unknown argument ["'`]?query|doesn't accept argument ["'`]?query|argument ["'`]?query["'`]?.*(?:not defined|not accepted)/i.test(
          (error as Error).message,
        )
      )
        throw error
      this.supportsItemQuery = false
      nodes = await readIndex(false)
    }
    const selected = nodes.filter(
      (node) =>
        node.content?.id &&
        (!statuses || statuses.includes(node.fieldValueByName?.name ?? 'Senza stato')),
    )
    const cached = new Map(previous.map((issue) => [issue.id, issue]))
    const changedIds = [
      ...new Set(
        selected
          .filter((node) => cached.get(node.content!.id)?.updatedAt !== node.content!.updatedAt)
          .map((node) => node.content!.id),
      ),
    ]
    const changedSet = new Set(changedIds)
    const batches: string[][] = []
    for (let i = 0; i < changedIds.length; i += 50) batches.push(changedIds.slice(i, i + 50))
    const changed = await mapConcurrent(batches, 3, (ids) =>
      this.graphql<{ nodes: any[] }>(
        `query IssueSummaries($ids: [ID!]!) { nodes(ids: $ids) { __typename ... on Issue { ${SUMMARY} } ... on PullRequest { ${PR_SUMMARY} } ... on DraftIssue { id title createdAt updatedAt } } }`,
        { ids },
      ),
    )
    const fresh = new Map(
      changed
        .flatMap((batch) => batch.nodes.filter(Boolean))
        .map((content) => [content.id, content]),
    )
    return selected.flatMap((node): Issue[] => {
      const id = node.content!.id
      const status = node.fieldValueByName?.name ?? 'Senza stato'
      const c = fresh.get(id)
      if (!c) {
        // A null node means access was lost between index and summary queries.
        if (changedSet.has(id)) return []
        const existing = cached.get(id)
        return existing ? [{ ...existing, status }] : []
      }
      return [
        {
          id: c.id,
          number: c.number ?? 0,
          title: c.title,
          body: c.body ?? '',
          url: c.url ?? '',
          repository: c.repository?.nameWithOwner ?? 'Bozza del progetto',
          state: c.state ?? c.pullRequestState ?? 'DRAFT',
          status,
          labels: c.labels?.nodes ?? [],
          commentCount: c.comments?.totalCount ?? 0,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          kind:
            c.__typename === 'DraftIssue'
              ? 'draft'
              : c.__typename === 'PullRequest'
                ? 'pull-request'
                : 'issue',
        },
      ]
    })
  }

  private async cachedContent(
    key: string,
    load: () => Promise<EstimateContent>,
    fresh = false,
  ): Promise<EstimateContent> {
    const cached = this.recentContent.get(key)
    if (!fresh && cached && cached.expiresAt > Date.now()) return cached.value
    const pending = this.contentRequests.get(key)
    if (pending) return pending
    const request = load()
      .then((value) => {
        this.recentContent.delete(key)
        this.recentContent.set(key, { value, expiresAt: Date.now() + 30000 })
        while (this.recentContent.size > 20)
          this.recentContent.delete(this.recentContent.keys().next().value!)
        return value
      })
      .finally(() => this.contentRequests.delete(key))
    this.contentRequests.set(key, request)
    return request
  }

  async issue(issue: Issue, fresh = false): Promise<IssueDetail> {
    const value = await this.cachedContent(
      JSON.stringify([issue.id, issue.updatedAt, issue.commentCount, 'full']),
      () => this.loadIssue(issue),
      fresh,
    )
    return { ...value, status: issue.status }
  }

  async estimateDelta(issue: Issue, baseline: EstimateBaseline): Promise<EstimateContent> {
    if (issue.kind === 'draft' || issue.commentCount <= baseline.commentCount)
      return this.issue(issue)
    const full = this.recentContent.get(
      JSON.stringify([issue.id, issue.updatedAt, issue.commentCount, 'full']),
    )
    if (full && full.expiresAt > Date.now()) return { ...full.value, status: issue.status }
    const key = JSON.stringify([issue.id, issue.updatedAt, issue.commentCount, baseline])
    const value = await this.cachedContent(key, async () => {
      const type = issue.kind === 'pull-request' ? 'PullRequest' : 'Issue'
      const comments: Comment[] = []
      let before: string | null = null
      let fresh: any
      let total = 0
      const last = Math.min(
        100,
        Math.max(1, issue.commentCount - baseline.commentCount + (baseline.lastCommentId ? 1 : 0)),
      )
      do {
        const data: any = await this.graphql(
          `query EstimateCommentsDelta($id: ID!, $before: String, $last: Int!) { node(id: $id) { ... on ${type} { id title body updatedAt comments(last: $last, before: $before) { totalCount nodes { id body createdAt updatedAt } pageInfo { hasPreviousPage startCursor } } } } }`,
          { id: issue.id, before, last },
        )
        if (!data.node?.id || !data.node.comments)
          throw new Error('Commenti della stima non accessibili.')
        fresh ??= data.node
        const page = data.node.comments
        if (total && total !== page.totalCount) return this.issue(issue)
        total = page.totalCount
        comments.unshift(...page.nodes.filter(Boolean))
        if (
          baseline.lastCommentId &&
          comments.some((comment) => comment.id === baseline.lastCommentId)
        )
          break
        if (!baseline.lastCommentId || !page.pageInfo.hasPreviousPage) break
        if (!page.pageInfo.startCursor || page.pageInfo.startCursor === before)
          throw new Error('Paginazione dei nuovi commenti interrotta.')
        before = page.pageInfo.startCursor
      } while (before)
      const anchor = baseline.lastCommentId
        ? comments.findIndex((comment) => comment.id === baseline.lastCommentId)
        : 0
      if (
        anchor < 0 ||
        total !==
          baseline.commentCount + comments.length - anchor - (baseline.lastCommentId ? 1 : 0)
      )
        return this.issue(issue)
      return {
        ...issue,
        title: fresh.title,
        body: fresh.body ?? '',
        comments: comments.slice(anchor),
        commentCount: total,
        commentsComplete: false,
        delta: true,
        updatedAt: fresh.updatedAt,
      }
    })
    return { ...value, status: issue.status }
  }

  private async loadIssue(issue: Issue): Promise<IssueDetail> {
    const type =
      issue.kind === 'draft'
        ? 'DraftIssue'
        : issue.kind === 'pull-request'
          ? 'PullRequest'
          : 'Issue'
    const data = await this.graphql<any>(
      `query IssueDetail($id: ID!) { node(id: $id) { ... on ${type} { ${issue.kind === 'draft' ? 'id title body updatedAt' : `${ISSUE} ${AUTHOR} assignees(first: 100) { nodes { login name } }`} } } }`,
      { id: issue.id },
    )
    const fresh = data.node
    if (!fresh?.id) throw new Error('Issue non più accessibile.')
    if (issue.kind === 'draft') return { ...issue, ...fresh, comments: [], commentsComplete: true }
    const comments = await this.connection<Comment>(
      `query Comments($id: ID!, $cursor: String) { node(id: $id) { ... on ${type} { comments(first: 100, after: $cursor) { nodes { id body createdAt updatedAt ${AUTHOR} } ${PAGE} } } } }`,
      { id: issue.id },
      (d) => d.node?.comments,
    )
    if (comments.length < fresh.comments.totalCount)
      throw new Error('Commenti incompleti: ricarica l’issue prima di esportare.')
    return {
      ...issue,
      title: fresh.title,
      body: fresh.body ?? '',
      state: fresh.state,
      author: fresh.author ?? null,
      assignees: fresh.assignees?.nodes ?? [],
      updatedAt: fresh.updatedAt,
      labels: fresh.labels.nodes,
      commentCount: comments.length,
      comments: comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      commentsComplete: true,
    }
  }

  async notificationContent(notification: IssueNotification): Promise<IssueDetail> {
    if (notification.type === 'comment') return this.issue(notification.issue)
    const issue = notification.issue
    const type =
      issue.kind === 'draft'
        ? 'DraftIssue'
        : issue.kind === 'pull-request'
          ? 'PullRequest'
          : 'Issue'
    const data = await this.graphql<any>(
      `query NotificationContent($id: ID!) { node(id: $id) { ... on ${type} { ${issue.kind === 'draft' ? 'id title body updatedAt' : `${ISSUE} ${AUTHOR} assignees(first: 100) { nodes { login name } }`} } } }`,
      { id: issue.id },
    )
    if (!data.node?.id) throw new Error('Contenuto della issue non disponibile.')
    return {
      ...issue,
      title: data.node.title,
      author: data.node.author ?? null,
      assignees: data.node.assignees?.nodes ?? [],
      body: data.node.body ?? '',
      comments: [],
      commentsComplete: false,
    }
  }
}
