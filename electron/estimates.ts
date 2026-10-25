import { createHash } from 'node:crypto'
import { readFile, writeFile, rename, unlink } from 'node:fs/promises'
import type { Issue, IssueLocation } from '../src/shared/types'
import {
  defaultProjectEstimates,
  estimateEligible,
  type EstimateResult,
  type EstimateState,
  type IssueEstimate,
  type ProjectEstimateSettings,
  type EstimateUsage,
  type EstimateContent,
  type EstimateBaseline,
  type EstimateSource,
} from '../src/shared/estimates'
import { AIConfig } from './ai-config'
import {
  OpenAIClient,
  estimatePrompt,
  estimateSchema,
  decisionPrompt,
  decisionQuestions,
} from './openai'

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const recordKey = (projectId: string, issueId: string) => JSON.stringify([projectId, issueId])
const newUsage = (): EstimateUsage => ({
  date: new Date().toISOString().slice(0, 10),
  requests: 0,
  inputTokens: 0,
  outputTokens: 0,
  chargedTokens: 0,
})
interface Source {
  id: string
  text: string
}
interface SavedEstimate {
  value: IssueEstimate
  signature?: string
  sources?: { id: string; hash: string }[]
  updatedAt?: string
  commentCount?: number
  auditedAt?: number
  retryAt?: number
  pipelineVersion?: number
}
export function validateProjectEstimates(value: ProjectEstimateSettings): ProjectEstimateSettings {
  value = { ...defaultProjectEstimates(), ...value }
  if (
    !value ||
    !Array.isArray(value.statuses) ||
    value.statuses.some((status) => typeof status !== 'string' || status.length > 200) ||
    value.statuses.length > 200 ||
    !Number.isFinite(value.hoursPerDay) ||
    value.hoursPerDay <= 0 ||
    value.hoursPerDay > 24 ||
    typeof value.instructions !== 'string' ||
    value.instructions.length > 2000 ||
    typeof value.updatedSince !== 'string' ||
    (value.updatedSince &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value.updatedSince) ||
        !Number.isFinite(Date.parse(value.updatedSince))))
  )
    throw new Error('Configurazione stime progetto non valida.')
  if (value.enabled && !value.statuses.length)
    throw new Error('Seleziona almeno uno stato da monitorare.')
  return {
    enabled: value.enabled === true,
    statuses: [...new Set(value.statuses)],
    includeClosed: value.includeClosed === true,
    includeDrafts: value.includeDrafts === true,
    hoursPerDay: value.hoursPerDay,
    instructions: value.instructions.trim(),
    updatedSince: value.updatedSince,
  }
}
export function validateEstimate(result: EstimateResult, sources: Source[]): EstimateResult {
  if (
    !result ||
    !Array.isArray(result.entries) ||
    result.entries.length > 100 ||
    typeof result.needsReview !== 'boolean' ||
    typeof result.note !== 'string' ||
    result.note.length > 500
  )
    throw new Error('La risposta OpenAI non rispetta il formato delle stime.')
  const seen = new Set<string>()
  for (const entry of result.entries) {
    const source = sources.find((source) => source.id === entry.sourceId)
    if (
      !source ||
      !Number.isFinite(entry.min) ||
      !Number.isFinite(entry.max) ||
      entry.min < 0 ||
      entry.max < entry.min ||
      entry.max > 1000000 ||
      !['hours', 'days'].includes(entry.unit) ||
      typeof entry.label !== 'string' ||
      entry.label.length > 150 ||
      typeof entry.excerpt !== 'string' ||
      !entry.excerpt.trim() ||
      entry.excerpt.length > 240 ||
      !source.text.includes(entry.excerpt)
    )
      throw new Error(
        'Stima senza fonte verificabile: risultato scartato. Ricalcola o cambia modello.',
      )
    const key = hash([entry.sourceId, entry.min, entry.max, entry.unit, entry.excerpt])
    if (seen.has(key)) throw new Error('Il modello ha duplicato una stima: risultato scartato.')
    seen.add(key)
  }
  return normalizeTotals(result)
}

// Compatibility with saved ranges; the original explicit total overrides its breakdown.
export function normalizeTotals(result: EstimateResult): EstimateResult {
  const entries = result.entries.map((entry) => ({ ...entry, min: entry.max }))
  for (const sourceId of new Set(entries.map((entry) => entry.sourceId))) {
    const group = entries.filter((entry) => entry.sourceId === sourceId)
    const text = [...new Set(group.map((entry) => entry.excerpt))].join('\n')
    const matches = [
      ...text.matchAll(
        /\b(?:totale(?:\s+complessivo)?|total)\s*(?::|=|di)?\s*(\d+(?:[.,]\d+)?)\s*(ore|ora|hours?|h|giorni|giorno|giornate?|gg|days?)\b[ \t]*(?=[.!;\n]|$)/gi,
      ),
    ]
    const total = matches.at(-1)
    if (!total) continue
    const afterTotal = text.slice(total.index! + total[0].length)
    if (
      /\d+(?:[.,]\d+)?\s*(?:ore|ora|hours?|h|giorni|giorno|giornate?|gg|days?)\b/i.test(afterTotal)
    )
      continue
    const amount = Number(total[1].replace(',', '.'))
    if (!Number.isFinite(amount) || amount > 1000000)
      throw new Error('Totale della stima fuori dai limiti consentiti.')
    const unit = /^(h|ora|ore|hour)/i.test(total[2]) ? ('hours' as const) : ('days' as const)
    const first = entries.findIndex((entry) => entry.sourceId === sourceId)
    const excerpt = group.find((entry) => entry.excerpt.includes(total[0]))?.excerpt ?? total[0]
    entries.splice(first, 1, { ...group[0], min: amount, max: amount, unit, excerpt })
    for (let i = entries.length - 1; i > first; i--)
      if (entries[i].sourceId === sourceId) entries.splice(i, 1)
  }
  return {
    entries,
    needsReview: entries.length > 0 && result.needsReview,
    note: entries.length ? result.note : '',
  }
}

export class EstimateService {
  private projects: Record<string, ProjectEstimateSettings> = {}
  private records: Record<string, SavedEstimate> = {}
  private usage = newUsage()
  private writing = Promise.resolve()
  private running?: Promise<void>
  private stopped = false
  private abort = new AbortController()
  private locations = new Map<string, IssueLocation>()
  constructor(
    private path: string,
    private scope: string,
    private config: AIConfig,
    private issueDetail: (
      issue: Issue,
      baseline?: EstimateBaseline,
      fresh?: boolean,
    ) => Promise<EstimateContent>,
    private openai = new OpenAIClient(),
    private changed = () => {},
  ) {}
  async load() {
    try {
      const data = JSON.parse(await readFile(this.path, 'utf8'))
      if (data.version !== 1 || data.scope !== this.scope) return
      for (const [id, settings] of Object.entries(data.projects ?? {}))
        this.projects[id] = validateProjectEstimates(settings as ProjectEstimateSettings)
      this.records = data.records ?? {}
      for (const record of Object.values(this.records)) {
        record.value = { ...record.value, ...normalizeTotals(record.value) }
        if (!record.value.entries.length && record.value.state === 'review')
          record.value.state = 'none'
        if (!record.pipelineVersion) record.signature = this.signature(record.value.projectId)
      }
      if (data.usage?.date === this.usage.date) this.usage = data.usage
    } catch {
      /* Rebuild missing or corrupt local state on the next eligible sync. */
    }
  }
  settings(projectId: string) {
    return {
      ...(this.projects[projectId] ?? defaultProjectEstimates()),
      statuses: [...(this.projects[projectId]?.statuses ?? [])],
    }
  }
  async saveSettings(projectId: string, value: ProjectEstimateSettings) {
    if (this.stopped || typeof projectId !== 'string' || !projectId)
      throw new Error('Riapri le impostazioni progetto.')
    this.projects[projectId] = validateProjectEstimates(value)
    await this.persist()
    this.changed()
    return this.settings(projectId)
  }
  private rollUsage() {
    if (this.usage.date !== newUsage().date) this.usage = newUsage()
  }
  state(projectIds: string[]): EstimateState {
    this.rollUsage()
    const ids = new Set(projectIds)
    const pending: IssueEstimate[] = [...this.locations.entries()]
      .filter(
        ([key, location]) =>
          !this.records[key] &&
          ids.has(location.projectId) &&
          this.config.settings().enabled &&
          estimateEligible(location.issue, this.settings(location.projectId)),
      )
      .map(([, location]) => ({
        entries: [],
        needsReview: false,
        note: 'In attesa di analisi nel prossimo ciclo di controllo.',
        issueId: location.issue.id,
        projectId: location.projectId,
        checkedAt: 0,
        model: this.config.settings().model,
        hoursPerDay: this.settings(location.projectId).hoursPerDay,
        state: 'pending',
        monitoring: true,
      }))
    return {
      items: Object.entries(this.records)
        .filter(([, record]) => ids.has(record.value.projectId))
        .map<IssueEstimate>(([key, record]) => {
          const location = this.locations.get(key)
          return {
            ...record.value,
            monitoring: location
              ? this.config.settings().enabled &&
                estimateEligible(location.issue, this.settings(location.projectId))
              : undefined,
          }
        })
        .concat(pending),
      usage: { ...this.usage },
      running: !!this.running,
      dailyTokenBudget: this.config.settings().dailyTokenBudget,
    }
  }
  private persist() {
    if (this.stopped) return Promise.resolve()
    const value = JSON.stringify({
      version: 1,
      scope: this.scope,
      projects: this.projects,
      records: this.records,
      usage: this.usage,
    })
    const write = this.writing
      .catch(() => {})
      .then(async () => {
        await writeFile(`${this.path}.tmp`, value, { mode: 0o600 })
        await rename(`${this.path}.tmp`, this.path)
      })
    this.writing = write
    return write
  }
  async clear() {
    this.stop()
    await this.writing.catch(() => {})
    await unlink(this.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
  stop() {
    this.stopped = true
    this.abort.abort()
  }
  sync(locations: IssueLocation[]) {
    this.locations = new Map(
      locations.map((location) => [recordKey(location.projectId, location.issue.id), location]),
    )
    if (this.stopped) return Promise.resolve()
    if (!this.config.settings().enabled) {
      this.changed()
      return Promise.resolve()
    }
    if (this.running) return this.running
    const request = Promise.resolve()
      .then(async () => {
        let processed = 0
        const candidates = [...this.locations.entries()].sort(
          ([a], [b]) => (this.records[a]?.auditedAt ?? 0) - (this.records[b]?.auditedAt ?? 0),
        )
        for (const [key] of candidates) {
          if (
            this.stopped ||
            !this.config.settings().enabled ||
            processed >= this.config.settings().maxIssuesPerSync
          )
            break
          const location = this.locations.get(key)
          if (!location || !estimateEligible(location.issue, this.settings(location.projectId)))
            continue
          const previous = this.records[key]
          if (previous?.retryAt && previous.retryAt > Date.now()) continue
          if (
            previous &&
            previous.updatedAt === location.issue.updatedAt &&
            previous.commentCount === location.issue.commentCount &&
            previous.value.state !== 'error'
          )
            continue
          processed++
          await this.analyze(location)
        }
      })
      .finally(() => {
        if (this.running === request) this.running = undefined
        this.changed()
      })
    this.running = request
    this.changed()
    return request
  }
  private signature(projectId: string) {
    const { hoursPerDay, instructions } = this.settings(projectId)
    return hash([2, hoursPerDay, instructions])
  }
  async recalculate(projectId: string, issueId: string) {
    if (this.running) throw new Error('Analisi già in corso. Attendi il completamento.')
    const location = this.locations.get(recordKey(projectId, issueId))
    if (
      !location ||
      !this.config.settings().enabled ||
      !estimateEligible(location.issue, this.settings(projectId))
    )
      throw new Error(
        'L’issue deve trovarsi in uno stato abilitato nelle impostazioni stime del progetto.',
      )
    const request = this.analyze(location, true).finally(() => {
      this.running = undefined
      this.changed()
    })
    this.running = request
    this.changed()
    await request
  }
  private async analyze(location: IssueLocation, force = false) {
    const { issue, projectId } = location
    const key = recordKey(projectId, issue.id)
    const previous = this.records[key]
    const settings = this.config.settings()
    const project = this.settings(projectId)
    const signature = this.signature(projectId)
    const revision = this.config.revision()
    const projectRevision = hash(project)
    const current = () =>
      !this.stopped &&
      revision === this.config.revision() &&
      hash(this.settings(projectId)) === projectRevision &&
      this.config.settings().enabled &&
      !!this.locations.get(key) &&
      estimateEligible(this.locations.get(key)!.issue, this.settings(projectId))
    try {
      const baseline =
        !force &&
        previous?.sources &&
        previous.commentCount !== undefined &&
        issue.commentCount > previous.commentCount
          ? {
              commentCount: previous.commentCount,
              lastCommentId:
                previous.sources.at(-1)?.id === 'description'
                  ? undefined
                  : previous.sources.at(-1)?.id,
            }
          : undefined
      let detail = await this.issueDetail(issue, baseline, force)
      if (!current()) return
      const toSources = (value: EstimateContent): EstimateSource[] => [
        { id: 'description', text: `${value.title}\n${value.body}` },
        ...value.comments.map((comment) => ({ id: comment.id, text: comment.body })),
      ]
      let sources = toSources(detail)
      let fingerprints = sources.map((source) => ({ id: source.id, hash: hash(source.text) }))
      let append =
        !force &&
        previous?.signature === signature &&
        previous.sources &&
        previous.value.state !== 'error'
      let delta: EstimateSource[] = []
      if (detail.delta && append && previous?.sources) {
        const last = previous.sources.at(-1)!
        const anchorOK =
          last.id === 'description' ||
          (fingerprints[1]?.id === last.id && fingerprints[1]?.hash === last.hash)
        delta = sources.slice(last.id === 'description' ? 1 : 2)
        append =
          anchorOK &&
          fingerprints[0]?.hash === previous.sources[0]?.hash &&
          detail.commentCount === previous.commentCount! + delta.length
        if (append)
          fingerprints = [
            ...previous.sources,
            ...delta.map((source) => ({ id: source.id, hash: hash(source.text) })),
          ]
      } else if (!detail.delta && detail.commentsComplete && append && previous?.sources) {
        append = previous.sources.every(
          (source, index) =>
            fingerprints[index]?.id === source.id && fingerprints[index]?.hash === source.hash,
        )
        if (append) delta = sources.slice(previous.sources.length)
      } else append = false
      if (detail.delta && !append) {
        detail = await this.issueDetail(issue, undefined, true)
        sources = toSources(detail)
        fingerprints = sources.map((source) => ({ id: source.id, hash: hash(source.text) }))
      }
      if (!current()) return
      if (!append && !detail.commentsComplete)
        throw new Error('Conversazione incompleta: nessuna stima inviata a OpenAI.')
      const save = async (result: EstimateResult, model = settings.model) => {
        if (!current()) return
        const normalized = normalizeTotals(result)
        this.records[key] = {
          value: {
            ...normalized,
            issueId: issue.id,
            projectId,
            checkedAt: Date.now(),
            model,
            hoursPerDay: project.hoursPerDay,
            state: normalized.entries.length
              ? normalized.needsReview
                ? 'review'
                : 'ready'
              : 'none',
          },
          signature,
          sources: fingerprints,
          updatedAt: issue.updatedAt,
          commentCount: detail.commentCount,
          auditedAt: Date.now(),
          pipelineVersion: 2,
        }
        await this.persist()
        this.changed()
      }
      const shared =
        !force &&
        Object.values(this.records).find(
          (record) =>
            record.value.issueId === issue.id &&
            record.value.projectId !== projectId &&
            record.signature === signature &&
            record.value.state !== 'error' &&
            hash(record.sources) === hash(fingerprints),
        )
      if (shared) {
        await save(shared.value, shared.value.model)
        return
      }
      if (
        !force &&
        previous?.signature === signature &&
        hash(previous.sources) === hash(fingerprints) &&
        previous.value.state !== 'error'
      ) {
        await save(previous.value, previous.value.model)
        return
      }
      const billed = async <T extends { inputTokens?: number; outputTokens?: number }>(
        input: string,
        overhead: string,
        outputCap: number,
        run: (apiKey: string) => Promise<T>,
      ) => {
        if (input.length > settings.maxInputChars)
          throw new Error(
            'Contesto oltre il limite di caratteri configurato. Aumentalo e ricalcola; nessun testo è stato troncato.',
          )
        if (!current()) throw new Error('Configurazione modificata durante l’analisi.')
        this.rollUsage()
        const reserved = Buffer.byteLength(input + overhead) + outputCap + 512
        if (this.usage.chargedTokens + reserved > settings.dailyTokenBudget)
          throw new Error(
            'Budget giornaliero insufficiente per questa analisi. Aumentalo oppure attendi domani (UTC).',
          )
        const apiKey = await this.config.credentials()
        if (!current()) throw new Error('Configurazione modificata durante l’analisi.')
        const usage = this.usage
        usage.requests++
        usage.chargedTokens += reserved
        await this.persist()
        if (!current()) {
          usage.requests--
          usage.chargedTokens -= reserved
          await this.persist()
          throw new Error('Configurazione modificata prima dell’invio.')
        }
        const response = await run(apiKey)
        if (response.inputTokens !== undefined && response.outputTokens !== undefined)
          usage.chargedTokens += response.inputTokens + response.outputTokens - reserved
        usage.inputTokens += response.inputTokens ?? 0
        usage.outputTokens += response.outputTokens ?? 0
        await this.persist()
        return response
      }
      const extract = async (input: string, evidence: EstimateSource[]) => {
        const response = await billed(
          input,
          estimatePrompt + JSON.stringify(estimateSchema),
          settings.maxOutputTokens,
          (apiKey) => this.openai.extract(apiKey, settings, input, this.abort.signal),
        )
        return validateEstimate(response.result, evidence)
      }
      if (append && previous && delta.length && delta.length <= 400) {
        const input = JSON.stringify({
          policy: decisionPrompt,
          conventions: project.instructions,
          previousTotal: previous.value.entries.length
            ? {
                amount:
                  Math.round(
                    previous.value.entries.reduce(
                      (total, entry) =>
                        total +
                        entry.max * (entry.unit === 'days' ? previous.value.hoursPerDay : 1),
                      0,
                    ) * 1000000,
                  ) / 1000000,
                unit: 'hours',
              }
            : null,
          sources: delta,
        })
        const response = await billed(
          input,
          JSON.stringify(decisionQuestions(delta)),
          0,
          (apiKey) => this.openai.decide(apiKey, input, delta, this.abort.signal),
        )
        const certain = response.decisions.every(
          (decision) =>
            decision.action !== 'rebuild' && decision.confidence >= settings.decisionThreshold,
        )
        if (certain) {
          let actionable = delta.filter(
            (source) =>
              response.decisions.find((decision) => decision.sourceId === source.id)?.action !==
              'ignore',
          )
          if (!actionable.length) {
            await save(previous.value)
            return
          }
          let lastReplacement = -1
          actionable.forEach((source, index) => {
            if (
              response.decisions.find((decision) => decision.sourceId === source.id)?.action ===
              'replace'
            )
              lastReplacement = index
          })
          if (lastReplacement >= 0) actionable = actionable.slice(lastReplacement)
          const result = await extract(
            JSON.stringify({
              mode: 'delta',
              conventions: project.instructions,
              hoursPerDay: project.hoursPerDay,
              sources: actionable.map((source) => ({
                ...source,
                action: response.decisions.find((decision) => decision.sourceId === source.id)!
                  .action,
              })),
            }),
            actionable,
          )
          if (
            !result.needsReview &&
            actionable.every((source) =>
              result.entries.some((entry) => entry.sourceId === source.id),
            )
          ) {
            let entries = [...previous.value.entries]
            let needsReview = previous.value.needsReview
            for (const source of actionable) {
              if (
                response.decisions.find((decision) => decision.sourceId === source.id)!.action ===
                'replace'
              ) {
                entries = []
                needsReview = false
              }
              entries.push(...result.entries.filter((entry) => entry.sourceId === source.id))
            }
            await save({
              entries,
              needsReview,
              note: result.note || (needsReview ? previous.value.note : ''),
            })
            return
          }
        }
      }
      if (detail.delta) {
        detail = await this.issueDetail(issue, undefined, true)
        if (!detail.commentsComplete)
          throw new Error('Conversazione incompleta: ricostruzione della stima interrotta.')
        sources = toSources(detail)
        fingerprints = sources.map((source) => ({ id: source.id, hash: hash(source.text) }))
      }
      const result = await extract(
        JSON.stringify({
          mode: 'full',
          conventions: project.instructions,
          hoursPerDay: project.hoursPerDay,
          sources,
        }),
        sources,
      )
      await save(result)
    } catch (error) {
      if (!current()) return
      this.records[key] = {
        ...previous,
        value: {
          entries: previous?.value.entries ?? [],
          needsReview: previous?.value.needsReview ?? false,
          note: previous?.value.note ?? '',
          issueId: issue.id,
          projectId,
          checkedAt: previous?.value.checkedAt ?? 0,
          model: previous?.value.model ?? settings.model,
          hoursPerDay: previous?.value.hoursPerDay ?? project.hoursPerDay,
          state: 'error',
          error: (error as Error).message,
        },
        retryAt: Date.now() + 15 * 60000,
        auditedAt: Date.now(),
      }
      await this.persist()
    }
    this.changed()
  }
}
