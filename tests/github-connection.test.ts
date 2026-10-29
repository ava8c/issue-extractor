import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createServer } from 'node:net'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GitHubClient } from '../electron/github'
import { IssueCache } from '../electron/issue-cache'
import { ActivityService } from '../electron/activity'
import { githubConnection } from '../src/shared/github-connection'
import { errorMessage, GITHUB_UNAVAILABLE, isGitHubUnavailable } from '../src/shared/errors'
import type { AtlasAPI, Project, Settings } from '../src/shared/types'
import { demoAPI } from '../src/demo'

const simulation = process.env.GITHUB_SIMULATION_URL
const settings: Settings = {
  host: 'https://github.example',
  organizations: ['corebanking'],
  projectUrls: [],
  hasToken: true,
}

async function closedPort() {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return `http://127.0.0.1:${address.port}`
}

test('network classification survives Electron IPC prefixes and keeps access errors distinct', () => {
  assert.ok(
    isGitHubUnavailable(
      new Error(`Error invoking remote method 'github:issue': Error: ${GITHUB_UNAVAILABLE}`),
    ),
  )
  assert.equal(
    errorMessage(
      new Error(`Error invoking remote method 'github:issue': Error: ${GITHUB_UNAVAILABLE}`),
    ),
    GITHUB_UNAVAILABLE,
  )
  assert.equal(isGitHubUnavailable('Token non valido o scaduto.'), false)
  assert.equal(isGitHubUnavailable('GitHub ha risposto con errore 502. Riprova più tardi.'), false)
})

test(
  'real HTTP: VPN loss preserves local navigation and loaded conversations, then reconnects',
  { skip: !simulation },
  async (t) => {
    const folder = await mkdtemp(join(tmpdir(), 'atlas-vpn-'))
    t.after(() => rm(folder, { recursive: true, force: true }))
    // Reserve then close a local port to exercise a real connection refusal.
    const unreachable = await closedPort()
    function client(base: string, token = 'simulation-token') {
      return new GitHubClient(settings, token, {
        graphql: `${base}/api/graphql`,
        rest: `${base}/api/v3`,
      })
    }
    let github = client(simulation!)
    let requests = 0
    const store = new IssueCache(join(folder, 'cache.json'), 'connection')
    const source: AtlasAPI = {
      ...demoAPI,
      testConnection: () => {
        requests++
        return github.testConnection()
      },
      projects: () => {
        requests++
        return github.projects()
      },
      projectLayout: (id: string) => {
        requests++
        return github.projectLayout(id)
      },
      issues: (id: string) => {
        requests++
        return github.issues(id)
      },
      issue: (issue) => {
        requests++
        return github.issue(issue, true)
      },
      cachedProject: async (id, statuses) => store.available(id, statuses),
      notifications: async () => store.notifications(),
      syncActivity: (ids, force) =>
        new ActivityService(github, store).sync(
          ids.map((id) => ({ id, title: id }) as Project),
          force,
        ),
      findIssues: (number, ids) =>
        new ActivityService(github, store).find(
          number,
          ids.map((id) => ({ id, title: id }) as Project),
        ),
    }
    const changes: boolean[] = []
    const connection = githubConnection(source, settings, (offline) => changes.push(offline))
    t.after(() => connection.dispose())
    assert.equal(await connection.check(), true)
    const workspace = await connection.api.projects()
    await store.saveWorkspace(workspace)
    const projectId = workspace.projects[0].id
    const items = await connection.api.issues(projectId)
    await store.save(projectId, ['In progress'], items)
    const issue = items.find((item) => item.kind === 'issue')!
    const detail = await connection.api.issue(issue)
    assert.equal(detail.commentsComplete, true)
    assert.ok(detail.comments.length > 100)

    github = client(unreachable)
    assert.equal(await connection.check(), false)
    assert.deepEqual(changes, [true])
    const beforeNavigation = requests
    assert.deepEqual(await connection.api.issue({ ...issue, status: 'Backlog' }), {
      ...detail,
      status: 'Backlog',
    })
    const search = await connection.api.findIssues(issue.number, [projectId])
    assert.ok(search.matches.some((match) => match.issue.id === issue.id))
    assert.deepEqual(search.warnings, [])
    assert.deepEqual((await connection.api.syncActivity([projectId], true)).errors, [])
    await assert.rejects(connection.api.issue({ ...issue, id: 'NOT_CACHED' }), isGitHubUnavailable)
    await assert.rejects(connection.api.issues(projectId), isGitHubUnavailable)
    assert.equal(requests, beforeNavigation, 'Offline navigation must not wait on network requests')
    assert.equal(
      (await readFile(join(folder, 'cache.json'), 'utf8')).includes('A description'),
      false,
    )

    github = client(simulation!)
    const firstCheck = connection.check()
    assert.equal(connection.check(), firstCheck, 'Concurrent retries share the same probe')
    assert.equal(await firstCheck, true)
    assert.deepEqual(changes, [true, false])
    assert.ok((await connection.api.projects()).projects.length)

    github = client(simulation!, 'invalid-token')
    await assert.rejects(connection.check(), /Token non valido/)
    assert.deepEqual(
      changes,
      [true, false],
      'Invalid credentials must not appear as waiting for VPN',
    )
    await assert.rejects(connection.api.projects(), /Token non valido/)

    connection.dispose()
    const next = githubConnection(source, settings, () => {})
    t.after(() => next.dispose())
    github = client(unreachable)
    await next.check()
    await assert.rejects(
      next.api.issue(issue),
      isGitHubUnavailable,
      'A new connection must not reuse private conversation data',
    )
  },
)

test(
  'real HTTP: polling consolidates VPN failures but preserves permission errors',
  { skip: !simulation },
  async (t) => {
    const folder = await mkdtemp(join(tmpdir(), 'atlas-vpn-poll-'))
    t.after(() => rm(folder, { recursive: true, force: true }))
    const store = new IssueCache(join(folder, 'cache.json'), 'connection')
    let github = new GitHubClient(settings, 'simulation-token', {
      graphql: `${simulation}/api/graphql`,
      rest: `${simulation}/api/v3`,
    })
    const changes: boolean[] = []
    const source: AtlasAPI = {
      ...demoAPI,
      notifications: async () => store.notifications(),
      syncActivity: () =>
        new ActivityService(github, store).sync(
          [{ id: 'ACTIVITY_ERROR', title: 'Denied' }] as Project[],
          true,
        ),
    }
    const connection = githubConnection(source, settings, (offline) => changes.push(offline))
    t.after(() => connection.dispose())
    const result = await connection.api.syncActivity(['ACTIVITY_ERROR'], true)
    assert.match(result.errors[0], /Activity access denied/)
    assert.deepEqual(changes, [])
    const unreachable = await closedPort()
    github = new GitHubClient(settings, 'simulation-token', {
      graphql: `${unreachable}/api/graphql`,
      rest: `${unreachable}/api/v3`,
    })
    const offline = await connection.api.syncActivity(['ACTIVITY_ERROR'], true)
    assert.deepEqual(offline.errors, [])
    assert.deepEqual(changes, [true])
  },
)
