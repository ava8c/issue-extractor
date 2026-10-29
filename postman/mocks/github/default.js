// Read-only fixtures based on GitHub's documented GraphQL Projects v2 contract.
// Synthetic data only. Every request passes through the real client and HTTP.
const http = require('node:http')
const date = '2026-10-23T08:42:00Z'
const page = (nodes, next = false, cursor = null) => ({
  nodes,
  pageInfo: { hasNextPage: next, endCursor: cursor },
})
const project = (number) => ({
  id: `P${number}`,
  title: `Project ${number}`,
  number,
  url: `https://github.example/orgs/corebanking/projects/${number}`,
  shortDescription: 'Test project',
  closed: false,
  owner: { login: 'corebanking' },
})
const issue = {
  __typename: 'Issue',
  id: 'I1',
  number: 1248,
  title: 'Balance issue',
  author: { login: 'giulia.rossi', name: 'Giulia Rossi' },
  body: 'A description',
  url: 'https://github.example/corebanking/banking/issues/1248',
  state: 'OPEN',
  createdAt: date,
  updatedAt: date,
  repository: { nameWithOwner: 'corebanking/banking' },
  labels: { nodes: [] },
  comments: { totalCount: 103 },
}
const changedDate = '2026-10-24T09:00:00Z'
const activityScans = new Map()
const estimateFixtures = new Map()
const notificationFixtures = new Map()
const item = (id, status, updatedAt = date, type = 'Issue') => ({
  fieldValueByName: status ? { name: status } : null,
  content: { __typename: type, id, updatedAt },
})
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => {
    body += chunk
  })
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json')
    if (req.url === '/notification-fixture' && req.method === 'POST') {
      const fixture = JSON.parse(body)
      notificationFixtures.set(fixture.id, fixture)
      return res.end('{}')
    }
    if (req.url === '/estimate-fixture' && req.method === 'POST') {
      const fixture = JSON.parse(body)
      estimateFixtures.set(fixture.id, fixture)
      return res.end('{}')
    }
    if (req.url === '/asset-start') {
      if (req.headers.authorization !== 'Bearer simulation-token') {
        res.writeHead(401)
        return res.end('{}')
      }
      res.writeHead(302, { Location: '/github/asset-image' })
      return res.end()
    }
    if (req.url === '/asset-image') {
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'X-Received-Authorization': req.headers.authorization ? 'yes' : 'no',
      })
      return res.end(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=',
          'base64',
        ),
      )
    }
    if (req.url === '/unauthorized') {
      res.writeHead(401)
      return res.end(JSON.stringify({ message: 'Bad credentials' }))
    }
    if (req.url === '/forbidden') {
      res.writeHead(403)
      return res.end(JSON.stringify({ message: 'Forbidden' }))
    }
    if (req.url === '/broken') {
      res.writeHead(502, { 'Content-Type': 'text/html' })
      return res.end('<html>Bad gateway</html>')
    }
    if (req.url === '/graphql-error')
      return res.end(
        JSON.stringify({
          data: { viewer: null },
          errors: [{ message: 'Resource not accessible by personal access token' }],
        }),
      )
    if (req.url !== '/api/graphql' || req.method !== 'POST') {
      res.writeHead(501)
      return res.end(JSON.stringify({ message: 'Not modeled by this fixture' }))
    }
    if (req.headers.authorization !== 'Bearer simulation-token') {
      res.writeHead(401)
      return res.end('{}')
    }
    try {
      const { query, variables: v = {} } = JSON.parse(body)
      if (notificationFixtures.has(v.id)) {
        const fixture = notificationFixtures.get(v.id)
        if (query.includes('query ProjectActivityItems'))
          return res.end(JSON.stringify({ data: { node: { items: page(fixture.items) } } }))
        if (query.includes('query NotificationCommentActors')) {
          const end = v.before ? Number(v.before.replace('actors-', '')) : fixture.comments.length
          const start = Math.max(0, end - v.last)
          return res.end(
            JSON.stringify({
              data: {
                node: {
                  comments: {
                    totalCount: fixture.comments.length,
                    nodes: fixture.comments.slice(start, end),
                    pageInfo: { hasPreviousPage: start > 0, startCursor: `actors-${start}` },
                  },
                },
              },
            }),
          )
        }
        if (query.includes('query NotificationStatusActors')) {
          if (fixture.unsupportedTimeline)
            return res.end(
              JSON.stringify({
                errors: [{ message: "Unknown type 'ProjectV2ItemStatusChangedEvent'" }],
              }),
            )
          const offset = v.cursor ? Number(v.cursor.replace('events-', '')) : 0
          const events = fixture.events.filter((event) => event.createdAt >= v.since)
          return res.end(
            JSON.stringify({
              data: {
                node: {
                  timelineItems: page(
                    events.slice(offset, offset + 100),
                    events.length > offset + 100,
                    `events-${offset + 100}`,
                  ),
                },
              },
            }),
          )
        }
      }
      if (estimateFixtures.has(v.id)) {
        const fixture = estimateFixtures.get(v.id)
        if (query.includes('query EstimateCommentsDelta')) {
          const end = v.before
            ? Number(v.before.replace('estimate-cursor-', ''))
            : fixture.comments.length
          const start = Math.max(0, end - v.last)
          return res.end(
            JSON.stringify({
              data: {
                node: {
                  ...fixture,
                  comments: {
                    totalCount: fixture.comments.length,
                    nodes: fixture.comments.slice(start, end),
                    pageInfo: {
                      hasPreviousPage: start > 0,
                      startCursor: `estimate-cursor-${start}`,
                    },
                  },
                },
              },
            }),
          )
        }
        const node = query.includes('query Comments')
          ? { comments: page(fixture.comments) }
          : {
              ...fixture,
              repository: { nameWithOwner: fixture.repository },
              labels: { nodes: fixture.labels },
              comments: { totalCount: fixture.comments.length },
            }
        return res.end(JSON.stringify({ data: { node } }))
      }
      let data
      if (query.includes('query Identity')) data = { viewer: { login: 'tester' } }
      else if (query.includes('query Organizations'))
        data = {
          viewer: {
            organizations: v.cursor
              ? page([{ login: 'second-org' }])
              : page([{ login: 'corebanking' }], true, 'org-next'),
          },
        }
      else if (query.includes('query Projects')) {
        const type = query.includes('organization(login:') ? 'organization' : 'user'
        const nodes =
          type === 'user' ? [] : v.owner === 'corebanking' ? [project(v.cursor ? 60 : 59)] : []
        data = {
          [type]: {
            projectsV2: page(
              nodes,
              v.owner === 'corebanking' && !v.cursor,
              v.owner === 'corebanking' && !v.cursor ? 'project-next' : null,
            ),
          },
        }
      } else if (query.includes('query ProjectByNumber'))
        data = { organization: { projectV2: project(v.number) } }
      else if (query.includes('query ProjectFields'))
        data = {
          node: {
            fields: v.cursor
              ? page([
                  {
                    id: 'status',
                    name: 'Status',
                    options: [
                      { id: 's1', name: 'Todo', color: 'GRAY' },
                      { id: 's2', name: 'In progress', color: 'YELLOW' },
                      { id: 's3', name: 'In review', color: 'PURPLE' },
                      { id: 's4', name: 'Done', color: 'GREEN' },
                    ],
                  },
                ])
              : page([{}], true, 'fields-next'),
          },
        }
      else if (query.includes('query ProjectActivityItems')) {
        if (v.id === 'ACTIVITY_ERROR')
          return res.end(JSON.stringify({ errors: [{ message: 'Activity access denied' }] }))
        const revision = (activityScans.get(v.id) || 0) + 1
        activityScans.set(v.id, revision)
        const { body: omittedBody, labels: omittedLabels, ...summary } = issue
        const initial = revision === 1
        const nodes = [
          {
            fieldValueByName: { name: initial ? 'Todo' : 'Done' },
            content: {
              ...summary,
              comments: { totalCount: initial ? 2 : 4 },
              updatedAt: initial ? date : changedDate,
            },
          },
          {
            fieldValueByName: { name: 'Todo' },
            content: {
              ...summary,
              id: initial ? 'OLD_ACTIVITY' : 'NEW_ACTIVITY',
              number: 1249,
              comments: { totalCount: 0 },
            },
          },
        ]
        if (v.id.startsWith('WATCH-MULTI'))
          nodes.push({
            fieldValueByName: { name: 'In review' },
            content: {
              ...summary,
              id: 'OTHER_REPOSITORY',
              repository: { nameWithOwner: 'corebanking/another' },
            },
          })
        data = { node: { items: page(nodes) } }
      } else if (query.includes('query ProjectItems')) {
        if (v.id === 'DENIED')
          return res.end(
            JSON.stringify({
              errors: [{ message: 'Resource not accessible by personal access token' }],
            }),
          )
        if (v.id === 'LEGACY' && query.includes('query: $query'))
          return res.end(
            JSON.stringify({
              errors: [{ message: "Field 'items' doesn't accept argument 'query'" }],
            }),
          )
        let nodes
        if (v.id === 'DELTA1')
          nodes = [item('D1', 'In progress'), item('D2', 'Todo'), item('Dremoved', 'Done')]
        else if (v.id === 'DELTA2')
          nodes = [
            item('D1', 'Done'),
            item('D2', 'Todo', changedDate),
            item('D3', 'In review', changedDate),
          ]
        else if (v.id === 'FILTER' || v.id === 'LEGACY')
          nodes = [
            item('I1', 'In progress'),
            item('OLD', 'Done'),
            item('DR1', 'Todo', date, 'DraftIssue'),
            item('PR1', 'Todo', date, 'PullRequest'),
            item('NONE', null),
          ]
        if (nodes) {
          if (v.query) {
            const names = [...v.query.matchAll(/"([^"]*)"/g)].map((match) => match[1])
            nodes = nodes.filter((node) => names.includes(node.fieldValueByName?.name))
          }
          data = { node: { items: page(nodes) } }
        } else
          data = {
            node: {
              items: v.cursor
                ? page([item('I2', null), { content: null }])
                : page([item('I1', 'In progress')], true, 'item-next'),
            },
          }
      } else if (query.includes('query IssueSummaries'))
        data = {
          nodes: v.ids.map((id) => {
            const content = {
              ...issue,
              id,
              title: id === 'I2' ? 'Second issue' : `Issue ${id}`,
              updatedAt: (id === 'D2' && v.ids.includes('D3')) || id === 'D3' ? changedDate : date,
            }
            if (id === 'DR1')
              return {
                __typename: 'DraftIssue',
                id,
                title: 'Draft',
                createdAt: date,
                updatedAt: date,
              }
            if (id === 'PR1') {
              const { state, ...pullRequest } = content
              return { ...pullRequest, __typename: 'PullRequest', pullRequestState: 'MERGED' }
            }
            const { body: omitted, ...summary } = content
            return summary
          }),
        }
      else if (query.includes('query IssueDetail') || query.includes('query NotificationContent'))
        data = {
          node:
            v.id === 'DR1'
              ? { id: 'DR1', title: 'Draft', body: 'Full draft body', updatedAt: date }
              : { ...issue, id: v.id },
        }
      else if (query.includes('query Comments')) {
        const offset = v.cursor ? 100 : 0
        const nodes = Array.from({ length: v.cursor ? 3 : 100 }, (_, i) => ({
          id: `C${offset + i}`,
          body: `Comment ${offset + i + 1}`,
          ...(query.includes('author')
            ? {
                author:
                  (offset + i) % 4 === 0
                    ? { login: 'giulia.rossi', name: 'Giulia Rossi' }
                    : (offset + i) % 4 === 1
                      ? { login: 'marco.bianchi', name: null }
                      : (offset + i) % 4 === 2
                        ? null
                        : { login: 'atlas-bot' },
              }
            : {}),
          createdAt: date,
          updatedAt: date,
        }))
        data = { node: { comments: page(nodes, !v.cursor, !v.cursor ? 'comment-next' : null) } }
      } else {
        res.writeHead(501)
        return res.end(JSON.stringify({ message: 'Unknown query' }))
      }
      res.end(JSON.stringify({ data }))
    } catch {
      res.writeHead(400)
      res.end('{}')
    }
  })
})
server.listen(process.env.PORT || 4901, '127.0.0.1')
