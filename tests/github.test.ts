import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { buildSchema, parse, validate } from 'graphql'
import { GitHubClient, endpoints, normalizeHost } from '../electron/github'
import { ActivityService } from '../electron/activity'
import { IssueCache } from '../electron/issue-cache'
import type { Issue, IssueNotification, Project } from '../src/shared/types'
import { notification } from './fixtures/email'

const simulation = process.env.GITHUB_SIMULATION_URL
const config = {
  host: 'https://github.example',
  organizations: ['corebanking'],
  projectUrls: ['https://github.example/orgs/corebanking/projects/59/views/1'],
}
const schema = process.env.GITHUB_SCHEMA_FILE
  ? buildSchema(readFileSync(process.env.GITHUB_SCHEMA_FILE, 'utf8'), { assumeValid: true })
  : null
class CheckedClient extends GitHubClient {
  requests: { query: string; variables: Record<string, unknown> }[] = []
  override async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    parse(query)
    this.requests.push({ query, variables })
    if (schema)
      assert.deepEqual(
        validate(schema, parse(query)).map((e) => e.message),
        [],
        'Query must match the official GitHub GraphQL schema',
      )
    return super.graphql<T>(query, variables)
  }
}
const client = () =>
  new CheckedClient(config, 'simulation-token', {
    graphql: `${simulation}/api/graphql`,
    rest: `${simulation}/api/v3`,
  })
test(
  'real HTTP against Postman: activity is indexed once for concurrent requests, cached for quick lookup and diffed without bodies',
  { skip: !simulation },
  async (t) => {
    const folder = await mkdtemp(join(tmpdir(), 'atlas-watch-'))
    t.after(() => rm(folder, { recursive: true, force: true }))
    const store = new IssueCache(join(folder, 'cache.json'), 'test')
    const github = client()
    const activity = new ActivityService(github, store)
    const watchId = `WATCH-SYNC-${randomUUID()}`
    const projects = [{ id: watchId, title: 'Watch' }] as Project[]
    const [baseline, lookup] = await Promise.all([
      activity.sync(projects),
      activity.find(1248, projects),
    ])
    assert.deepEqual(baseline.items, [])
    assert.equal(lookup.matches[0].issue.number, 1248)
    assert.equal(
      github.requests.filter(({ query }) => query.includes('ProjectActivityItems')).length,
      1,
    )
    const index = github.requests.find(({ query }) => query.includes('ProjectActivityItems'))!
    assert.ok(!/\bbody\b|\blabels\b/.test(index.query))
    github.requests = []
    const cached = await activity.find(1248, projects)
    assert.equal(cached.matches.length, 1)
    assert.equal(github.requests.length, 0)
    const changed = await activity.sync(projects, true)
    assert.deepEqual([...changed.items.map((item) => item.type)].sort(), [
      'comment',
      'new-issue',
      'status',
    ])
    assert.equal(changed.items.find((item) => item.type === 'comment')?.newCommentCount, 2)
    assert.equal(changed.items.find((item) => item.type === 'status')?.toStatus, 'Done')
    assert.equal(store.findIssues(1248, [watchId])[0].issue.status, 'Done')
    assert.ok(
      !store.findIssues(1249, [watchId]).some((location) => location.issue.id === 'OLD_ACTIVITY'),
    )
    await store.recordActivity(
      watchId,
      [...store.findIssues(1248, [watchId]), ...store.findIssues(1249, [watchId])].map(
        (location) => location.issue,
      ),
      1,
    )
    github.requests = []
    assert.equal((await activity.find(1248, projects)).matches.length, 1)
    assert.equal(
      github.requests.length,
      0,
      'Even an older local index should answer keystrokes immediately',
    )
    const multiple = await activity.find(1248, [
      ...projects,
      { id: `WATCH-MULTI-${randomUUID()}`, title: 'Second project' } as Project,
    ])
    assert.equal(multiple.matches.length, 3)
    assert.equal(new Set(multiple.matches.map((match) => match.issue.repository)).size, 2)
    await store.recordActivity('ACTIVITY_ERROR', [cached.matches[0].issue], 100)
    const failed = await activity.sync(
      [{ id: 'ACTIVITY_ERROR', title: 'Unavailable' } as Project],
      true,
    )
    assert.match(failed.errors[0], /Activity access denied/)
    assert.equal(failed.items.length, changed.items.length)
    assert.equal(
      store.findIssues(1248, ['ACTIVITY_ERROR']).length,
      1,
      'A failed scan must preserve the previous searchable baseline',
    )
  },
)
test('resolves Enterprise and github.com endpoints and rejects insecure hosts', () => {
  assert.deepEqual(endpoints('https://github.servizi.allitude.it/orgs/corebanking/projects/59'), {
    graphql: 'https://github.servizi.allitude.it/api/graphql',
    rest: 'https://github.servizi.allitude.it/api/v3',
  })
  assert.equal(endpoints('https://github.com').graphql, 'https://api.github.com/graphql')
  assert.equal(normalizeHost('https://github.example/path'), 'https://github.example')
  assert.throws(() => normalizeHost('http://github.example'))
  assert.throws(() => normalizeHost('https://token@github.example'))
})

test(
  'real HTTP against Postman: the token account is detected automatically and own events still reach every email recipient',
  { skip: !simulation },
  async (t) => {
    const folder = await mkdtemp(join(tmpdir(), 'atlas-identity-http-'))
    t.after(() => rm(folder, { recursive: true, force: true }))
    const cache = new IssueCache(join(folder, 'cache.json'), 'identity')
    const github = client()
    const activity = new ActivityService(github, cache)
    const projectId = `IDENTITY-${randomUUID()}`
    const issueId = `IDENTITY-ISSUE-${randomUUID()}`
    const own = { login: 'tester', name: 'Mario Rossi' }
    const other = { login: 'other', name: 'Altra Persona' }
    const projects = [{ id: projectId, title: 'Own project' }] as Project[]
    const fixture = async (value: object) => {
      const response = await fetch(`${simulation}/notification-fixture`, {
        method: 'POST',
        body: JSON.stringify(value),
      })
      assert.equal(response.status, 200)
    }
    const content = {
      __typename: 'Issue',
      id: issueId,
      number: 42,
      title: 'Own activity',
      repository: { nameWithOwner: 'org/repo' },
      url: 'https://github.example/org/repo/issues/42',
      state: 'OPEN',
      createdAt: '2026-10-20T10:00:00Z',
      updatedAt: '2026-10-20T10:00:00Z',
      comments: { totalCount: 1 },
    }
    const item = (status: string, count: number) => ({
      creator: own,
      fieldValueByName: { name: status },
      content: { ...content, comments: { totalCount: count } },
    })
    cache.setLayout(projectId, { statusFieldName: 'Status', statuses: [] })
    await cache.configureEmail({
      revision: 'own-mail',
      recipients: ['team@example.com', 'other@example.com'],
    })
    await fixture({ id: projectId, items: [item('Todo', 1)] })
    assert.deepEqual((await activity.sync(projects, true)).items, [])
    const since = new Date(cache.activityTimestamp(projectId)).toISOString()
    await fixture({
      id: issueId,
      comments: [{ author: other }, { author: own }, { author: own }],
      events: [
        {
          __typename: 'ProjectV2ItemStatusChangedEvent',
          actor: other,
          project: { id: 'another-project' },
          status: 'Done',
          createdAt: since,
        },
        {
          __typename: 'ProjectV2ItemStatusChangedEvent',
          actor: own,
          project: { id: projectId },
          status: 'Done',
          wasAutomated: false,
          createdAt: since,
        },
      ],
    })
    await fixture({ id: projectId, items: [item('Done', 3)] })
    const result = await activity.sync(projects, true)
    assert.deepEqual(result.errors, [])
    assert.equal(result.items.length, 2)
    assert.ok(result.items.every((item) => item.read))
    assert.equal(cache.getNotificationLogin(), 'tester')
    assert.equal(github.requests.filter(({ query }) => query.includes('query Identity')).length, 1)
    assert.equal(cache.emailStatus('own-mail').pending, 4)
    assert.equal(cache.nextEmail('own-mail')?.notification.read, true)
    assert.ok(
      github.requests
        .filter(({ query }) => /query Notification(?:Comment|Status)Actors/.test(query))
        .every(({ query }) => !/\bbody\b/.test(query)),
    )
    await fixture({
      id: issueId,
      comments: [
        { author: other },
        { author: own },
        { author: own },
        { author: own },
        { author: other },
      ],
      events: [],
    })
    await fixture({ id: projectId, items: [item('Done', 5)] })
    const mixed = await activity.sync(projects, true)
    assert.equal(mixed.items.find((item) => item.issue.commentCount === 5)?.read, false)
    await fixture({ id: issueId, comments: [], events: [], unsupportedTimeline: true })
    await fixture({ id: projectId, items: [item('Todo', 5)] })
    const unsupported = await activity.sync(projects, true)
    assert.deepEqual(unsupported.errors, [])
    assert.equal(
      unsupported.items.find((item) => item.type === 'status' && item.toStatus === 'Todo')?.read,
      false,
    )
    assert.equal(
      cache.activityIssues(projectId)[0].status,
      'Todo',
      'Missing actor metadata does not block the pipeline or baseline',
    )
    assert.equal(github.requests.filter(({ query }) => query.includes('query Identity')).length, 1)
  },
)

test(
  'real HTTP against Postman: automatic identity reuses token validation while connection checks still contact GitHub',
  { skip: !simulation },
  async () => {
    const github = client()
    assert.deepEqual(
      await Promise.all([github.authenticatedLogin(), github.authenticatedLogin()]),
      ['tester', 'tester'],
    )
    assert.equal(github.requests.length, 1)
    assert.equal(await github.authenticatedLogin(), 'tester')
    assert.equal(github.requests.length, 1)
    assert.equal(await github.testConnection(), 'tester')
    assert.equal(
      github.requests.length,
      2,
      'Connection checks must still detect a lost network connection',
    )
    const validated = client()
    await validated.testConnection()
    assert.equal(await validated.authenticatedLogin(), 'tester')
    assert.equal(validated.requests.length, 1, 'A validated token already identifies the account')
  },
)

test(
  'real HTTP against Postman: notification actors include every new comment across pages and reject races or missing authors',
  { skip: !simulation },
  async () => {
    const github = client()
    const issueId = `ACTORS-${randomUUID()}`
    const own = { login: 'm12345' }
    const comments = Array.from({ length: 105 }, () => ({ author: own }))
    const fixture = async (value: object) => {
      assert.equal(
        (
          await fetch(`${simulation}/notification-fixture`, {
            method: 'POST',
            body: JSON.stringify({ id: issueId, ...value }),
          })
        ).status,
        200,
      )
    }
    await fixture({ comments })
    const event = {
      type: 'comment',
      newCommentCount: 103,
      issue: { id: issueId, kind: 'issue', commentCount: 105 },
    } as IssueNotification
    const actors = await github.notificationActors(event, undefined, 0)
    assert.equal(actors.length, 103)
    assert.ok(actors.every((actor) => actor?.login === own.login))
    assert.equal(github.requests.length, 2)
    await fixture({ comments: [...comments, { author: own }] })
    assert.deepEqual(await github.notificationActors(event, undefined, 0), [null])
    await fixture({ comments: [{ author: null }] })
    assert.deepEqual(
      await github.notificationActors(
        { ...event, newCommentCount: 1, issue: { ...event.issue, commentCount: 1 } },
        undefined,
        0,
      ),
      [null],
    )
  },
)

test(
  'real HTTP against Postman: status attribution uses project and lifecycle actors without guessing from the issue author',
  { skip: !simulation },
  async () => {
    const github = client()
    const issueId = `STATUS-ACTORS-${randomUUID()}`
    const since = Date.parse('2026-10-20T10:00:00Z')
    const own = { login: 'm12345' }
    const other = { login: 'other' }
    const previous = { id: issueId, kind: 'pull-request', state: 'OPEN', status: 'Todo' } as Issue
    const event = {
      type: 'status',
      projectId: 'P1',
      issue: { ...previous, state: 'MERGED', status: 'Done' },
    } as IssueNotification
    const events = [
      {
        __typename: 'ProjectV2ItemStatusChangedEvent',
        actor: other,
        project: { id: 'P1' },
        status: 'Done',
        createdAt: '2026-10-19T10:00:00Z',
      },
      ...Array.from({ length: 101 }, () => ({
        __typename: 'OtherEvent',
        createdAt: '2026-10-21T10:00:00Z',
      })),
      {
        __typename: 'ProjectV2ItemStatusChangedEvent',
        actor: own,
        project: { id: 'P1' },
        status: 'Done',
        wasAutomated: false,
        createdAt: '2026-10-21T10:00:00Z',
      },
      { __typename: 'MergedEvent', actor: other, createdAt: '2026-10-21T10:00:00Z' },
    ]
    await fetch(`${simulation}/notification-fixture`, {
      method: 'POST',
      body: JSON.stringify({ id: issueId, events }),
    })
    assert.deepEqual(await github.notificationActors(event, previous, since), [own, other])
    assert.equal(github.requests.length, 2)
  },
)

test(
  'real HTTP against Postman: overlapping activity batches share two slots and deduplicate queued projects',
  { skip: !simulation },
  async (t) => {
    const folder = await mkdtemp(join(tmpdir(), 'atlas-watch-concurrent-'))
    t.after(() => rm(folder, { recursive: true, force: true }))
    const store = new IssueCache(join(folder, 'cache.json'), 'test')
    const github = client()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let active = 0
    let maximum = 0
    const started: string[] = []
    const read = github.activityItems.bind(github)
    github.activityItems = async (id, field) => {
      started.push(id)
      maximum = Math.max(maximum, ++active)
      try {
        await gate
        return await read(id, field)
      } finally {
        active--
      }
    }
    const activity = new ActivityService(github, store)
    const projects = ['A', 'B', 'C', 'D'].map((id) => ({
      id: `WATCH-${id}-${randomUUID()}`,
      title: id,
    })) as Project[]
    for (const project of projects)
      store.setLayout(project.id, { statusFieldName: 'Status', statuses: [] })
    const polling = activity.sync(projects.slice(0, 2), true)
    const searching = activity.find(1248, projects.slice(1))
    assert.deepEqual(
      started,
      projects.slice(0, 2).map((project) => project.id),
    )
    release()
    const [polled, found] = await Promise.all([polling, searching])
    assert.deepEqual(polled.errors, [])
    assert.deepEqual(found.warnings, [])
    assert.equal(maximum, 2)
    assert.equal(started.length, 4)
    assert.equal(new Set(started).size, 4)
    assert.equal(found.matches.length, 3)
  },
)
test(
  'real HTTP against Postman: discovers all organization/project pages and deduplicates direct URLs',
  { skip: !simulation },
  async () => {
    const workspace = await client().projects()
    assert.equal(workspace.login, 'tester')
    assert.deepEqual(
      workspace.projects.map((p) => p.number),
      [59, 60],
    )
    assert.equal(workspace.warnings.length, 0)
  },
)
test(
  'real HTTP against Postman: unchanged sync downloads only the index; delta fetches only changed/new nodes and removes old items',
  { skip: !simulation },
  async () => {
    const c = client()
    const initial = await c.issues('DELTA1')
    assert.equal(initial.length, 3)
    c.requests = []
    const unchanged = await c.issues('DELTA1', 'Status', undefined, initial)
    assert.deepEqual(unchanged, initial)
    assert.equal(c.requests.length, 1)
    assert.ok(c.requests.every(({ query }) => !/\bbody\b|labels|comments|\btitle\b/.test(query)))

    c.requests = []
    const updated = await c.issues('DELTA2', 'Status', undefined, initial)
    assert.deepEqual(
      updated.map((issue) => issue.id),
      ['D1', 'D2', 'D3'],
    )
    assert.equal(updated[0].status, 'Done')
    assert.equal(updated[1].updatedAt, '2026-10-24T09:00:00Z')
    assert.deepEqual(
      c.requests.find(({ query }) => query.includes('query IssueSummaries'))?.variables.ids,
      ['D2', 'D3'],
    )
    assert.ok(c.requests.every(({ query }) => !/\bbody\b/.test(query)))
  },
)

test(
  'real HTTP against Postman: selected statuses filter the server index and summaries; no selection performs no calls',
  { skip: !simulation },
  async () => {
    const c = client()
    assert.deepEqual(await c.issues('FILTER', 'Status', []), [])
    assert.equal(c.requests.length, 0)
    const selected = await c.issues('FILTER', 'Status', ['Todo', 'In progress'])
    assert.deepEqual(
      selected.map((issue) => issue.id),
      ['I1', 'DR1', 'PR1'],
    )
    assert.equal(selected[2].state, 'MERGED')
    assert.equal(c.requests[0].variables.query, 'status:"Todo","In progress"')
    assert.deepEqual(c.requests[1].variables.ids, ['I1', 'DR1', 'PR1'])
    const draft = await c.issue(selected[1])
    assert.equal(draft.body, 'Full draft body')
    assert.equal(draft.commentsComplete, true)
    assert.deepEqual(draft.comments, [])
    const noStatus = await c.issues('FILTER', 'Status', ['Senza stato'])
    assert.deepEqual(
      noStatus.map((issue) => issue.id),
      ['NONE'],
    )
  },
)

test(
  'real HTTP against Postman: older Enterprise falls back once to a lightweight index without swallowing access errors',
  { skip: !simulation },
  async () => {
    const c = client()
    const selected = await c.issues('LEGACY', 'Stato', ['In progress'])
    assert.deepEqual(
      selected.map((issue) => issue.id),
      ['I1'],
    )
    assert.equal(c.requests.length, 3)
    assert.ok(!c.requests[1].query.includes('query: $query'))
    assert.deepEqual(c.requests[2].variables.ids, ['I1'])
    c.requests = []
    await c.issues('LEGACY', 'Stato', ['In progress'], selected)
    assert.equal(c.requests.length, 1)
    assert.ok(!c.requests[0].query.includes('query: $query'))
    const denied = client()
    await assert.rejects(denied.issues('DENIED', 'Status', ['Todo']), /not accessible/)
    assert.equal(denied.requests.length, 1)
  },
)
test(
  'real HTTP against Postman: paginates status fields and preserves the GitHub option order',
  { skip: !simulation },
  async () => {
    const layout = await client().projectLayout('P59')
    assert.equal(layout.statusFieldName, 'Status')
    assert.deepEqual(
      layout.statuses.map((status) => status.name),
      ['Todo', 'In progress', 'In review', 'Done'],
    )
    assert.equal(layout.statuses[1].color, 'YELLOW')
    const issues = await client().issues('P59', layout.statusFieldName)
    assert.equal(issues[0].status, 'In progress')
  },
)
test(
  'real HTTP against Postman: loads project item pages and all 103 comments with names, missing profiles and bots',
  { skip: !simulation },
  async () => {
    const c = client()
    const issues = await c.issues('P59')
    assert.equal(issues.length, 2)
    assert.equal(issues[0].status, 'In progress')
    const issue = await c.issue(issues[0])
    assert.equal(issue.comments.length, 103)
    assert.equal(issue.comments[102].body, 'Comment 103')
    assert.equal(issue.commentsComplete, true)
    assert.deepEqual(issue.author, { login: 'giulia.rossi', name: 'Giulia Rossi' })
    assert.equal(issue.comments[0].author?.name, 'Giulia Rossi')
    assert.equal(issue.comments[1].author?.login, 'marco.bianchi')
    assert.equal(issue.comments[1].author?.name, null)
    assert.equal(issue.comments[2].author, null)
    assert.deepEqual(issue.comments[3].author, { login: 'atlas-bot' })
    assert.equal(issue.comments[100].author?.name, 'Giulia Rossi')
    assert.equal(c.requests.filter(({ query }) => query.includes('query Comments')).length, 2)
    assert.ok(
      c.requests
        .filter(({ query }) => query.includes('query Comments'))
        .every(({ query }) => query.includes('... on User { name }')),
    )
    assert.ok(!c.requests.some(({ query }) => /user\(login/.test(query)), 'No per-author requests')
  },
)
test(
  'real HTTP against Postman: mail descriptions avoid comment downloads; comment notifications load the complete conversation',
  { skip: !simulation },
  async () => {
    const c = client()
    const stateChange = await c.notificationContent({ ...notification, type: 'status' })
    assert.equal(stateChange.body, 'A description')
    assert.deepEqual(stateChange.comments, [])
    assert.equal(c.requests.length, 1)
    assert.ok(c.requests[0].query.includes('query NotificationContent'))
    c.requests = []
    const comment = await c.notificationContent(notification)
    assert.equal(comment.comments.length, 103)
    assert.equal(c.requests.filter((request) => request.query.includes('query Comments')).length, 2)
  },
)
test(
  'real HTTP against Postman: readable auth, permission, server and partial GraphQL errors',
  { skip: !simulation },
  async () => {
    for (const [path, pattern] of [
      ['unauthorized', /Token non valido/],
      ['forbidden', /Accesso negato/],
      ['broken', /502/],
      ['graphql-error', /GraphQL/],
    ] as const) {
      const c = new GitHubClient(config, 'simulation-token', {
        graphql: `${simulation}/${path}`,
        rest: '',
      })
      await assert.rejects(c.testConnection(), pattern)
    }
  },
)
