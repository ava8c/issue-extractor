import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { AIConfig } from '../electron/ai-config'
import {
  EstimateService,
  normalizeTotals,
  validateEstimate,
  validateProjectEstimates,
} from '../electron/estimates'
import { OpenAIClient } from '../electron/openai'
import { GitHubClient } from '../electron/github'
import {
  defaultAISettings,
  defaultProjectEstimates,
  estimateEligible,
  formatEstimate,
  type AISettings,
  type EstimateSource,
} from '../src/shared/estimates'
import type { Issue, IssueDetail } from '../src/shared/types'
import { secrets } from './fixtures/email'

const base = process.env.OPENAI_SIMULATION_URL
const githubBase = process.env.GITHUB_SIMULATION_URL
const integration = { skip: !base || !githubBase }
const project = { ...defaultProjectEstimates(), enabled: true, statuses: ['Da stimare', 'Backlog'] }
class RecordingOpenAI extends OpenAIClient {
  inputs: { model: string; data: any }[] = []
  decisionInputs: any[] = []
  override async decide(
    key: string,
    input: string,
    sources: EstimateSource[],
    signal?: AbortSignal,
  ) {
    this.decisionInputs.push(JSON.parse(input))
    return super.decide(key, input, sources, signal)
  }
  override async extract(key: string, settings: AISettings, input: string, signal?: AbortSignal) {
    this.inputs.push({ model: settings.model, data: JSON.parse(input) })
    return super.extract(key, settings, input, signal)
  }
}
class RecordingGitHub extends GitHubClient {
  queries: string[] = []
  override async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    this.queries.push(query)
    return super.graphql<T>(query, variables)
  }
}
async function setup(t: TestContext, model = 'gpt-6-luna', timeout = 5000) {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-estimates-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const configPath = join(directory, 'openai.json')
  const config = new AIConfig(configPath, secrets)
  await config.save({
    ...defaultAISettings(),
    enabled: true,
    apiKey: 'simulation-secret-key',
    model,
  })
  const openai = new RecordingOpenAI(`${base}/v1`, timeout)
  const github = new RecordingGitHub(
    { host: 'https://github.example', organizations: [], projectUrls: [] },
    'simulation-token',
    {
      graphql: `${githubBase}/api/graphql`,
      rest: `${githubBase}/api/v3`,
    },
  )
  let details = 0
  const path = join(directory, 'estimates.json')
  const detail: IssueDetail = {
    id: `ESTIMATE-${randomUUID()}`,
    number: 42,
    title: 'Caso stima',
    body: 'Testo riservato non pertinente.\nStima: 2 giorni.',
    url: 'https://github.example/org/repo/issues/42',
    repository: 'org/repo',
    state: 'OPEN',
    status: 'Da stimare',
    labels: [],
    kind: 'issue',
    createdAt: '2026-10-01T10:00:00Z',
    updatedAt: '2026-10-24T10:00:00Z',
    commentCount: 0,
    comments: [],
    commentsComplete: true,
  }
  const service = new EstimateService(
    path,
    'scope-test',
    config,
    async (issue, baseline, fresh) => {
      details++
      return baseline ? github.estimateDelta(issue, baseline) : github.issue(issue, fresh)
    },
    openai,
  )
  await service.saveSettings('P1', project)
  const seed = async () => {
    detail.commentCount = detail.comments.length
    const response = await fetch(`${githubBase}/estimate-fixture`, {
      method: 'POST',
      body: JSON.stringify(detail),
      headers: { 'content-type': 'application/json' },
    })
    assert.equal(response.status, 200)
    return {
      projectId: 'P1',
      issue: { ...detail, comments: undefined, commentsComplete: undefined } as Issue,
    }
  }
  const sync = async () => service.sync([await seed()])
  const value = () => service.state(['P1']).items.find((item) => item.issueId === detail.id)!
  const add = (id: string, body: string) => {
    const date = new Date(Date.parse(detail.updatedAt) + 60000).toISOString()
    detail.updatedAt = date
    detail.comments.push({ id, body, createdAt: date, updatedAt: date })
  }
  return {
    service,
    config,
    configPath,
    openai,
    github,
    detail,
    seed,
    sync,
    value,
    add,
    path,
    details: () => details,
  }
}

test('estimate eligibility is explicit per project, including old issues, closure and drafts', () => {
  const issue = {
    status: 'Da stimare',
    kind: 'issue',
    state: 'OPEN',
    updatedAt: '2026-10-24T10:00:00Z',
  } as Issue
  assert.equal(estimateEligible(issue, defaultProjectEstimates()), false)
  assert.equal(estimateEligible(issue, project), true)
  assert.equal(estimateEligible({ ...issue, status: 'Done' }, project), false)
  assert.equal(estimateEligible({ ...issue, state: 'CLOSED' }, project), false)
  assert.equal(estimateEligible({ ...issue, kind: 'draft' }, project), false)
  assert.equal(
    estimateEligible(
      { ...issue, updatedAt: '2020-01-01T00:00:00Z' },
      { ...project, updatedSince: '2026-01-01' },
    ),
    false,
  )
  assert.throws(() => validateProjectEstimates({ ...project, statuses: [] }), /stato/)
  assert.throws(() => validateProjectEstimates({ ...project, hoursPerDay: 0 }), /non valida/)
})
test('mixed units, ranges, zero and evidence are validated without inventing estimates', () => {
  const result = {
    entries: [
      {
        sourceId: 'c1',
        min: 1,
        max: 2,
        unit: 'days' as const,
        label: 'Intervento',
        excerpt: '1–2 giorni',
      },
      { sourceId: 'c2', min: 4, max: 4, unit: 'hours' as const, label: 'Extra', excerpt: '4 ore' },
    ],
    needsReview: false,
    note: '',
  }
  assert.equal(formatEstimate(result), '20 h')
  assert.equal(formatEstimate({ entries: [] }), 'Nessuna stima')
  assert.equal(
    validateEstimate(result, [
      { id: 'c1', text: 'Stima 1–2 giorni' },
      { id: 'c2', text: 'extra 4 ore' },
    ]).entries[0].min,
    2,
  )
  assert.throws(() => validateEstimate(result, []), /fonte verificabile/)
  assert.throws(
    () =>
      validateEstimate({ ...result, entries: [result.entries[0], result.entries[0]] }, [
        { id: 'c1', text: '1–2 giorni' },
      ]),
    /duplicato/,
  )
})
test('AI key is encrypted, never returned, and preserved or removed intentionally', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-ai-config-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'openai.json')
  const config = new AIConfig(path, secrets)
  await config.save({ ...defaultAISettings(), enabled: true, apiKey: 'secret-api-value' })
  assert.ok(!(await readFile(path, 'utf8')).includes('secret-api-value'))
  assert.ok(!JSON.stringify(config.settings()).includes('secret-api-value'))
  await config.save({ ...config.settings(), model: 'custom-model' })
  const loaded = new AIConfig(path, secrets)
  await loaded.load()
  assert.equal(await loaded.credentials(), 'secret-api-value')
  assert.equal(loaded.settings().model, 'custom-model')
  await loaded.save({ ...loaded.settings(), enabled: false, removeKey: true })
  assert.equal(loaded.settings().hasKey, false)
  await assert.rejects(() => loaded.credentials(), /chiave API/)
})

test(
  'real HTTP: full analysis, append only new comments, no calls for unchanged or metadata-only changes',
  integration,
  async (t) => {
    const s = await setup(t)
    await s.sync()
    assert.equal(formatEstimate(s.value()), '2 gg')
    assert.equal(s.openai.inputs[0].data.mode, 'full')
    await s.sync()
    assert.equal(s.details(), 1)
    s.detail.updatedAt = '2026-10-24T11:00:00Z'
    await s.sync()
    assert.equal(s.details(), 2)
    assert.equal(s.openai.inputs.length, 1)
    s.add('extra', 'Aggiungiamo 4 ore.')
    await s.sync()
    assert.equal(formatEstimate(s.value()), '20 h')
    const input = s.openai.inputs[1].data
    assert.equal(input.mode, 'delta')
    assert.deepEqual(
      input.sources.map((source: { id: string }) => source.id),
      ['extra'],
    )
    assert.ok(!JSON.stringify(input).includes('Testo riservato non pertinente.'))
    assert.equal(s.service.state(['P1']).usage.requests, 3)
    assert.equal(s.service.state(['P1']).usage.chargedTokens, 640)
    assert.ok(!(await readFile(s.path, 'utf8')).includes('Testo riservato non pertinente.'))
    const restored = new EstimateService(
      s.path,
      'scope-test',
      s.config,
      (issue) => s.github.issue(issue),
      s.openai,
    )
    await restored.load()
    await restored.sync([await s.seed()])
    assert.equal(s.openai.inputs.length, 2, 'Restart must reuse hashes and successful results')
    assert.equal(formatEstimate(restored.state(['P1']).items[0]), '20 h')
    const otherScope = new EstimateService(
      s.path,
      'another-token',
      s.config,
      (issue) => s.github.issue(issue),
      s.openai,
    )
    await otherScope.load()
    assert.equal(otherScope.state(['P1']).items.length, 0)
    assert.equal(otherScope.settings('P1').enabled, false)
  },
)
test(
  'real HTTP: replacement supersedes previous totals; edits and deletions rebuild all sources',
  integration,
  async (t) => {
    const s = await setup(t)
    await s.sync()
    s.add('extra', 'Aggiungiamo 4 ore.')
    await s.sync()
    s.add('replacement', 'Nuovo totale: 5 giorni.')
    await s.sync()
    assert.equal(formatEstimate(s.value()), '5 gg')
    s.detail.comments.pop()
    s.detail.updatedAt = '2026-10-24T13:00:00Z'
    await s.sync()
    assert.equal(s.openai.inputs.at(-1)!.data.mode, 'full')
    assert.equal(formatEstimate(s.value()), '20 h')
    s.detail.body = 'Testo riservato non pertinente.\nStima: 3 giorni.'
    s.detail.updatedAt = '2026-10-24T14:00:00Z'
    await s.sync()
    assert.equal(s.openai.inputs.at(-1)!.data.mode, 'full')
    assert.equal(formatEstimate(s.value()), '28 h')
    s.detail.comments[0].body = 'Nessun extra concordato.'
    s.detail.updatedAt = '2026-10-24T15:00:00Z'
    await s.sync()
    assert.equal(s.openai.inputs.at(-1)!.data.mode, 'full')
    assert.equal(formatEstimate(s.value()), '3 gg')
  },
)
test(
  'real HTTP: unquantified scope changes preserve known total and flag review; no estimate is explicit',
  integration,
  async (t) => {
    const s = await setup(t)
    await s.sync()
    s.add('requirement', 'Serve anche esportare in PDF.')
    await s.sync()
    assert.equal(formatEstimate(s.value()), '2 gg')
    assert.equal(s.value().state, 'review')
    assert.match(s.value().note, /senza stima/)
    s.detail.body = 'Nessuna quantità esplicita.'
    s.detail.comments = []
    s.detail.updatedAt = '2026-10-24T16:00:00Z'
    await s.sync()
    assert.equal(s.value().state, 'none')
    assert.equal(s.value().entries.length, 0)
  },
)
test(
  'real HTTP: state exclusions stop downloads and retain the last estimate; manual recalculation respects rules',
  integration,
  async (t) => {
    const s = await setup(t)
    s.detail.status = 'Done'
    await s.sync()
    assert.equal(s.details(), 0)
    s.detail.status = 'Da stimare'
    await s.sync()
    s.detail.status = 'Done'
    await s.sync()
    assert.equal(s.details(), 1)
    assert.equal(formatEstimate(s.value()), '2 gg')
    assert.equal(s.value().monitoring, false)
    await assert.rejects(() => s.service.recalculate('P1', s.detail.id), /stato abilitato/)
  },
)
test(
  'real HTTP: limits prevent requests before sending, persist budgets and limit new issues per cycle fairly',
  integration,
  async (t) => {
    const s = await setup(t)
    await s.config.save({ ...s.config.settings(), dailyTokenBudget: 1000 })
    await s.sync()
    assert.equal(s.openai.inputs.length, 0)
    assert.match(s.value().error!, /Budget/)
    await s.config.save({ ...s.config.settings(), dailyTokenBudget: 100000, maxIssuesPerSync: 1 })
    await s.service.recalculate('P1', s.detail.id)
    assert.equal(s.openai.inputs.length, 1)
    const first = await s.seed()
    s.detail.id = `ESTIMATE-${randomUUID()}`
    const second = await s.seed()
    await s.service.sync([first, second])
    assert.equal(s.openai.inputs.length, 2)
    assert.equal(s.service.state(['P1']).items.length, 2)
    s.detail.body = 'x'.repeat(2000)
    s.detail.updatedAt = '2026-10-24T16:00:00Z'
    await s.config.save({ ...s.config.settings(), maxInputChars: 1000 })
    await s.sync()
    assert.equal(s.openai.inputs.length, 2)
    assert.match(s.value().error!, /limite di caratteri/)
  },
)
test(
  'real HTTP: duplicate syncs share one request; stopped runs cannot commit stale results',
  integration,
  async (t) => {
    const s = await setup(t, 'test-slow')
    const location = await s.seed()
    await Promise.all([s.service.sync([location]), s.service.sync([location])])
    assert.equal(s.openai.inputs.length, 1)
    s.add('extra', 'Aggiungiamo 4 ore.')
    const pending = s.service.sync([await s.seed()])
    while (s.openai.inputs.length < 2) await new Promise((resolve) => setTimeout(resolve, 5))
    s.service.stop()
    await pending
    assert.equal(formatEstimate(s.value()), '2 gg')
  },
)
for (const [model, message] of [
  ['test-rate-limit', /Limite OpenAI/],
  ['test-html-error', /HTTP 503/],
  ['test-invalid-source', /fonte verificabile/],
  ['test-incomplete', /incompleta/],
  ['test-refusal', /non ha potuto/],
  ['test-invalid-json', /non valida/],
  ['test-slow', /scaduta/],
] as const) {
  test(
    `real HTTP: ${model} preserves last valid total, records error and applies backoff`,
    integration,
    async (t) => {
      const s = await setup(t)
      await s.sync()
      await s.config.save({ ...s.config.settings(), model })
      const client = model === 'test-slow' ? new RecordingOpenAI(`${base}/v1`, 40) : s.openai
      const service =
        model === 'test-slow'
          ? new EstimateService(
              s.path,
              'scope-test',
              s.config,
              (issue) => s.github.issue(issue),
              client,
            )
          : s.service
      if (service !== s.service) await service.load()
      const location = await s.seed()
      await service.sync([location])
      await service.recalculate('P1', s.detail.id)
      const result = service.state(['P1'])
      assert.equal(result.items[0].state, 'error')
      assert.equal(formatEstimate(result.items[0]), '2 gg')
      assert.match(result.items[0].error!, message)
      const count = client.inputs.length
      await service.sync([location])
      assert.equal(client.inputs.length, count)
      assert.ok(result.usage.chargedTokens > 270)
    },
  )
}
test(
  'real HTTP: models use saved or candidate API key without generating responses',
  integration,
  async (t) => {
    const s = await setup(t)
    assert.ok((await s.openai.models(await s.config.credentials())).includes('gpt-6-luna'))
    await assert.rejects(() => s.openai.models('bad-key'), /non valida/)
    assert.equal(s.service.state(['P1']).usage.requests, 0)
  },
)

test(
  'real HTTP: the same issue and conventions in two projects reuse one AI result',
  integration,
  async (t) => {
    const s = await setup(t)
    await s.service.saveSettings('P2', project)
    const location = await s.seed()
    await s.service.sync([location, { ...location, projectId: 'P2' }])
    assert.equal(s.openai.inputs.length, 1)
    assert.equal(s.service.state(['P1', 'P2']).items.length, 2)
    await s.service.saveSettings('P2', { ...project, instructions: 'Convenzione diversa' })
    await s.service.sync([location, { ...location, projectId: 'P2' }])
    assert.equal(s.openai.inputs.length, 1)
    await s.service.recalculate('P2', s.detail.id)
    assert.equal(s.openai.inputs.length, 2)
  },
)
test(
  'real HTTP: elapsed time and a model change never trigger a periodic recalculation',
  integration,
  async (t) => {
    const s = await setup(t)
    await s.sync()
    const data = JSON.parse(await readFile(s.path, 'utf8'))
    Object.values(data.records).forEach((record) => {
      ;(record as { auditedAt: number }).auditedAt = 1
    })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(s.path, JSON.stringify(data))
    const restored = new EstimateService(
      s.path,
      'scope-test',
      s.config,
      (issue, baseline, fresh) =>
        baseline ? s.github.estimateDelta(issue, baseline) : s.github.issue(issue, fresh),
      s.openai,
    )
    await restored.load()
    await s.config.save({ ...s.config.settings(), model: 'another-model' })
    s.detail.body = 'Stima: 3 giorni.'
    await restored.sync([await s.seed()])
    assert.equal(s.openai.inputs.length, 1)
    assert.equal(s.openai.decisionInputs.length, 0)
    await restored.recalculate('P1', s.detail.id)
    assert.equal(s.openai.inputs.length, 2)
    assert.equal(formatEstimate(restored.state(['P1']).items[0]), '3 gg')
  },
)
test(
  'real HTTP: a project disabled during extraction cannot commit the in-flight result',
  integration,
  async (t) => {
    const s = await setup(t, 'test-slow')
    const location = await s.seed()
    const request = s.service.sync([location])
    while (!s.openai.inputs.length) await new Promise((resolve) => setTimeout(resolve, 5))
    await s.service.saveSettings('P1', { ...project, enabled: false })
    await request
    assert.equal(s.service.state(['P1']).items.length, 0)
  },
)

test('explicit decimal totals override breakdowns and legacy ranges without double counting', () => {
  const excerpt = 'Tempo di analisi 1h. Tempo di fix 0,5h.\n\nTotale 1,5h.'
  const result = normalizeTotals({
    entries: [{ sourceId: 'c1', min: 1, max: 1.5, unit: 'hours', excerpt, label: 'Analisi/fix' }],
    needsReview: false,
    note: '',
  })
  assert.equal(formatEstimate(result), '1,5 h')
  assert.equal(result.entries[0].min, 1.5)
  const breakdown = normalizeTotals({
    ...result,
    entries: [
      { ...result.entries[0], min: 1, max: 1 },
      { ...result.entries[0], min: 0.5, max: 0.5 },
    ],
  })
  assert.equal(breakdown.entries.length, 1)
  assert.equal(formatEstimate(breakdown), '1,5 h')
  assert.deepEqual(normalizeTotals({ entries: [], needsReview: true, note: 'Verificare' }), {
    entries: [],
    needsReview: false,
    note: '',
  })
})
test(
  'real HTTP: the reported analysis/fix case yields a scalar total despite a wrong model amount',
  integration,
  async (t) => {
    const s = await setup(t)
    s.detail.body = 'Tempo di analisi 1h. Tempo di fix 0,5h.\n\nTotale 1,5h.'
    await s.sync()
    assert.equal(formatEstimate(s.value()), '1,5 h')
    assert.equal(s.value().entries.length, 1)
    assert.equal(s.openai.inputs[0].model, 'gpt-6-luna')
  },
)
test(
  'real HTTP: new comments use the GitHub tail and batched Decisions, ignored comments do not run extraction',
  integration,
  async (t) => {
    const s = await setup(t)
    await s.sync()
    s.github.queries = []
    s.add('discussion', 'Grazie, approvato.')
    s.add('another-discussion', 'Il rilascio è previsto per domani.')
    await s.sync()
    assert.equal(s.openai.decisionInputs.length, 1)
    assert.deepEqual(s.openai.decisionInputs[0].previousTotal, { amount: 16, unit: 'hours' })
    assert.deepEqual(
      s.openai.decisionInputs[0].sources.map((source: any) => source.id),
      ['discussion', 'another-discussion'],
    )
    assert.equal(s.openai.inputs.length, 1)
    assert.equal(formatEstimate(s.value()), '2 gg')
    assert.equal(
      s.github.queries.filter((query) => query.includes('EstimateCommentsDelta')).length,
      1,
    )
    assert.ok(
      !s.github.queries.some(
        (query) => query.includes('query IssueDetail') || query.includes('query Comments('),
      ),
    )
    await s.sync()
    assert.equal(s.openai.decisionInputs.length, 1)
  },
)
test(
  'real HTTP: mixed additions and new totals are applied in chronological order using only delta text',
  integration,
  async (t) => {
    const s = await setup(t)
    await s.sync()
    s.add('add1', 'Aggiungiamo 4 ore.')
    s.add('replace', 'Nuovo totale: 5 giorni.')
    s.add('add2', 'Altre 2 ore.')
    await s.sync()
    assert.equal(formatEstimate(s.value()), '42 h')
    assert.deepEqual(
      s.openai.inputs.at(-1)!.data.sources.map((source: any) => source.id),
      ['replace', 'add2'],
    )
    assert.equal(s.openai.inputs.at(-1)!.data.mode, 'delta')
    assert.ok(!JSON.stringify(s.openai.inputs.at(-1)!.data).includes('Testo riservato'))
  },
)
for (const text of [
  'Non sono sicuro, forse cambia la stima.',
  'Decisione incerta. Aggiungiamo 4 ore.',
  'Rifiuto decisione',
]) {
  test(`real HTTP: uncertainty or refusal rebuilds history: ${text}`, integration, async (t) => {
    const s = await setup(t)
    await s.sync()
    s.add('uncertain', text)
    await s.sync()
    assert.equal(s.openai.decisionInputs.length, 1)
    assert.equal(s.openai.inputs.at(-1)!.data.mode, 'full')
    assert.ok(JSON.stringify(s.openai.inputs.at(-1)!.data).includes('Testo riservato'))
    assert.ok(s.github.queries.some((query) => query.includes('EstimateCommentsDelta')))
  })
}
test(
  'real HTTP: a Decisions outage preserves the estimate and never falls back to another paid API',
  integration,
  async (t) => {
    const s = await setup(t)
    await s.sync()
    await s.config.save({ ...s.config.settings(), apiKey: 'simulation-decisions-rate-limit' })
    s.add('add', 'Altre 2 ore.')
    await s.sync()
    assert.equal(s.value().state, 'error')
    assert.equal(formatEstimate(s.value()), '2 gg')
    assert.equal(s.openai.inputs.length, 1)
    await s.sync()
    assert.equal(s.openai.decisionInputs.length, 1)
  },
)
test(
  'real HTTP: modified description or tail anchor forces a full rebuild without trusting the delta',
  integration,
  async (t) => {
    const s = await setup(t)
    s.add('anchor', 'Commento esistente.')
    await s.sync()
    s.detail.comments[0].body = 'Stima: 3 giorni.'
    s.add('extra', 'Altre 2 ore.')
    await s.sync()
    assert.equal(s.openai.decisionInputs.length, 0)
    assert.equal(s.openai.inputs.at(-1)!.data.mode, 'full')
    assert.equal(s.openai.inputs.at(-1)!.data.sources.length, 3)
  },
)
test(
  'real HTTP: delta pagination handles more than 100 new comments without downloading old history',
  integration,
  async (t) => {
    const s = await setup(t)
    s.add('anchor', 'Commento esistente.')
    await s.sync()
    s.github.queries = []
    for (let i = 0; i < 103; i++) s.add(`delta-${i}`, 'Discussione senza stime.')
    await s.sync()
    assert.equal(s.openai.inputs.length, 1)
    assert.equal(s.openai.decisionInputs[0].sources.length, 103)
    assert.equal(
      s.github.queries.filter((query) => query.includes('EstimateCommentsDelta')).length,
      2,
    )
    assert.ok(!s.github.queries.some((query) => query.includes('query Comments(')))
  },
)
test(
  'real HTTP: recently loaded notification content is shared with estimate processing',
  integration,
  async (t) => {
    const s = await setup(t)
    await s.sync()
    s.add('extra', 'Altre 2 ore.')
    const location = await s.seed()
    await s.github.issue(location.issue)
    s.github.queries = []
    await s.service.sync([location])
    assert.equal(s.github.queries.length, 0)
    assert.equal(formatEstimate(s.value()), '18 h')
    assert.equal(s.openai.inputs.at(-1)!.data.mode, 'delta')
  },
)

test('saved settings migrate the previous default to GPT-6 Luna without replacing the key', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'atlas-luna-migration-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'openai.json')
  const old = new AIConfig(path, secrets)
  await old.save({
    ...defaultAISettings(),
    enabled: true,
    model: 'gpt-4.1-mini',
    apiKey: 'simulation-migrated-key',
  })
  const current = new AIConfig(path, secrets)
  await current.load()
  assert.equal(current.settings().model, 'gpt-6-luna')
  assert.equal(await current.credentials(), 'simulation-migrated-key')
})
test('a later additional amount is not discarded by an earlier explicit subtotal', () => {
  const entries = [
    {
      sourceId: 'c1',
      min: 10,
      max: 10,
      unit: 'hours' as const,
      excerpt: 'Totale 10h.',
      label: 'Base',
    },
    {
      sourceId: 'c1',
      min: 2,
      max: 2,
      unit: 'hours' as const,
      excerpt: 'Altre 2 ore.',
      label: 'Extra',
    },
  ]
  assert.equal(formatEstimate(normalizeTotals({ entries, needsReview: false, note: '' })), '12 h')
})
test(
  'real HTTP: saved legacy intervals are corrected locally without rerunning AI',
  integration,
  async (t) => {
    const s = await setup(t)
    await s.sync()
    const data = JSON.parse(await readFile(s.path, 'utf8'))
    const record = Object.values(data.records)[0] as any
    delete record.pipelineVersion
    record.value.entries = [
      {
        sourceId: 'description',
        min: 1,
        max: 1.5,
        unit: 'hours',
        label: 'Analisi/fix',
        excerpt: 'Tempo di analisi 1h. Tempo di fix 0,5h.\n\nTotale 1,5h.',
      },
    ]
    const { writeFile } = await import('node:fs/promises')
    await writeFile(s.path, JSON.stringify(data))
    const restored = new EstimateService(
      s.path,
      'scope-test',
      s.config,
      (issue) => s.github.issue(issue),
      s.openai,
    )
    await restored.load()
    await restored.sync([await s.seed()])
    assert.equal(formatEstimate(restored.state(['P1']).items[0]), '1,5 h')
    assert.equal(s.openai.inputs.length, 1)
  },
)
