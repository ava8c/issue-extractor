import type { AtlasAPI, Issue, IssueDetail, Project, NotificationState } from './shared/types'
import { collectAssets, issueMarkdown } from './shared/export'
import { strToU8, zipSync } from 'fflate'
import { emptyEmailStatus } from './shared/email'
import { defaultGrokSettings } from './shared/grok'
import { readNotificationPreferences, isOwnNotification } from './shared/activity'
import { metricSnapshot } from './shared/metrics'
import { defaultAISettings, defaultProjectEstimates, type IssueEstimate } from './shared/estimates'
import { defaultMonitoringSettings, emptyMonitoringStatus } from './shared/monitoring'

const base = 'https://github.servizi.allitude.it'
const createdAt = '2026-10-21T08:24:00Z'
const updatedAt = '2026-10-23T08:42:00Z'
const demoNotificationKey = 'atlas:demo-notifications:v1'
const demoLogin = 'giulia.rossi'
function readOwnDemoNotifications(state: NotificationState): NotificationState {
  return {
    ...state,
    items: state.items.map((item) =>
      isOwnNotification(item, demoLogin) ? { ...item, read: true } : item,
    ),
  }
}
function demoNotifications(): NotificationState {
  try {
    const saved = JSON.parse(localStorage.getItem(demoNotificationKey) || 'null')
    if (Array.isArray(saved?.items)) return readOwnDemoNotifications(saved)
  } catch {
    /* Rebuild synthetic demo data. */
  }
  const now = Date.now()
  const state: NotificationState = {
    lastCheckedAt: now,
    items: [
      {
        id: 'demo-status',
        type: 'status',
        projectId: 'demo-core',
        issue: demoIssues[0],
        createdAt: now - 3 * 60_000,
        read: false,
        fromStatus: 'Todo',
        toStatus: 'In progress',
        actors: [{ login: 'marco.bianchi', name: 'Marco Bianchi' }],
      },
      {
        id: 'demo-comment',
        type: 'comment',
        projectId: 'demo-core',
        issue: demoIssues[1],
        createdAt: now - 12 * 60_000,
        read: false,
        newCommentCount: 2,
        actors: [{ login: 'giulia.rossi', name: 'Giulia Rossi' }],
      },
      {
        id: 'demo-new',
        type: 'new-issue',
        projectId: 'demo-core',
        issue: demoIssues[2],
        createdAt: now - 35 * 60_000,
        read: false,
        actors: [{ login: 'giulia.rossi', name: 'Giulia Rossi' }],
      },
    ],
  }
  const result = readOwnDemoNotifications(state)
  localStorage.setItem(demoNotificationKey, JSON.stringify(result))
  return result
}
export const demoProjects: Project[] = [
  {
    id: 'demo-core',
    title: 'Core Banking',
    number: 59,
    owner: 'corebanking',
    description: 'Il workspace delle esperienze bancarie. Tutte le issue, un solo posto.',
    closed: false,
    url: `${base}/orgs/corebanking/projects/59`,
  },
  {
    id: 'demo-digital',
    title: 'Digital Experience',
    number: 42,
    owner: 'corebanking',
    description: 'Esperienze digitali per i nostri clienti.',
    closed: false,
    url: `${base}/orgs/corebanking/projects/42`,
  },
  {
    id: 'demo-platform',
    title: 'Platform & API',
    number: 28,
    owner: 'corebanking',
    description: 'Servizi, integrazioni e infrastruttura.',
    closed: false,
    url: `${base}/orgs/corebanking/projects/28`,
  },
  {
    id: 'demo-design',
    title: 'Design System',
    number: 16,
    owner: 'corebanking',
    description: 'Componenti e linguaggio visivo condiviso.',
    closed: false,
    url: `${base}/orgs/corebanking/projects/16`,
  },
]
const makeIssue = (
  id: number,
  title: string,
  status: string,
  labels: string[],
  comments: number,
  repository = 'corebanking/internet-banking',
): Issue => ({
  id: `demo-${id}`,
  number: id,
  title,
  status,
  labels: labels.map((name) => ({
    name,
    color: name === 'bug' ? 'df6582' : name === 'frontend' ? '7670d5' : '5e95b0',
  })),
  commentCount: comments,
  repository,
  body: '## Obiettivo\n\nMigliorare l’esperienza di utilizzo e rendere il comportamento coerente con il design system.\n\n### Criteri di accettazione\n\n- [ ] Verificare il comportamento su desktop\n- [ ] Aggiornare gli stati di caricamento\n- [ ] Controllare l’accessibilità da tastiera',
  state: status === 'Done' ? 'CLOSED' : 'OPEN',
  kind: 'issue',
  createdAt,
  updatedAt,
  url: `${base}/${repository}/issues/${id}`,
})
const first = makeIssue(
  1248,
  'Il saldo disponibile non si aggiorna dopo un bonifico',
  'In progress',
  ['bug', 'frontend'],
  3,
)
first.body = `## Il problema

Dopo aver effettuato un bonifico, il **saldo disponibile** nella dashboard rimane invariato. Il nuovo importo compare solo dopo un refresh della pagina.

### Come riprodurlo

1. Accedere alla dashboard del conto.
2. Effettuare un bonifico dal pannello **Pagamenti**.
3. Tornare alla panoramica: il saldo mostra ancora l’importo precedente.

### Comportamento atteso

Il saldo deve aggiornarsi al completamento dell’operazione, senza ricaricare la pagina.

![Dashboard del conto dopo il bonifico](https://demo.issueatlas.local/assets/dashboard.png)

### Criteri di accettazione

- [ ] Invalidare la cache del saldo dopo la conferma
- [ ] Mostrare il saldo aggiornato nella panoramica
- [ ] Gestire gli errori senza perdere l’ultimo saldo valido

> Il problema si presenta anche tornando alla dashboard con la navigazione laterale.

Riferimento: [specifica funzionale](https://intranet.example.com/specs/saldo-disponibile).`
export const demoIssues = [
  first,
  makeIssue(
    1242,
    'Aggiungere la ricerca nei movimenti del conto',
    'Todo',
    ['feature', 'frontend'],
    5,
  ),
  makeIssue(
    1239,
    'Timeout nella conferma dei pagamenti SEPA',
    'In progress',
    ['bug', 'backend'],
    2,
    'corebanking/payments-api',
  ),
  makeIssue(1236, 'Esportazione PDF della lista movimenti', 'Todo', ['feature'], 1),
  makeIssue(1228, 'Stato vuoto per i beneficiari salvati', 'In review', ['design', 'frontend'], 4),
  makeIssue(1221, 'Correggere il formato data nel riepilogo', 'Done', ['bug'], 2),
  makeIssue(1214, 'Migliorare il caricamento dei conti collegati', 'Todo', ['performance'], 0),
]
demoIssues[1].body +=
  '\n\nStima: 3 giorni.\n\nAggiunto requisito: ricerca anche per beneficiario, da quantificare.'
demoIssues[2].body += '\n\nStima: 6 ore.'
demoIssues[3].body += '\n\nStima: 1–2 giorni.'
const demoEstimates: IssueEstimate[] = [
  {
    issueId: first.id,
    entries: [
      {
        sourceId: 'c2',
        min: 2,
        max: 2,
        unit: 'days',
        label: 'Correzione e test',
        excerpt: 'Stima: 2 giorni.',
      },
      {
        sourceId: 'c3',
        min: 4,
        max: 4,
        unit: 'hours',
        label: 'Bonifici programmati',
        excerpt: 'Per i bonifici programmati aggiungiamo 4 ore.',
      },
    ],
    needsReview: false,
    note: 'Stima iniziale e integrazione per i bonifici programmati.',
  },
  {
    issueId: demoIssues[1].id,
    entries: [
      {
        sourceId: 'description',
        min: 3,
        max: 3,
        unit: 'days',
        label: 'Ricerca movimenti',
        excerpt: 'Stima: 3 giorni.',
      },
    ],
    needsReview: true,
    note: 'La ricerca per beneficiario è un requisito aggiunto senza stima.',
  },
  {
    issueId: demoIssues[2].id,
    entries: [
      {
        sourceId: 'description',
        min: 6,
        max: 6,
        unit: 'hours',
        label: 'Correzione timeout',
        excerpt: 'Stima: 6 ore.',
      },
    ],
    needsReview: false,
    note: '',
  },
  {
    issueId: demoIssues[3].id,
    entries: [
      {
        sourceId: 'description',
        min: 1,
        max: 2,
        unit: 'days',
        label: 'Esportazione PDF',
        excerpt: 'Stima: 1–2 giorni.',
      },
    ],
    needsReview: false,
    note: '',
  },
].map(
  (value) =>
    ({
      ...value,
      projectId: 'demo-core',
      checkedAt: Date.parse(updatedAt),
      model: 'Esempio demo',
      hoursPerDay: 8,
      monitoring: false,
      state: value.needsReview ? 'review' : 'ready',
    }) as IssueEstimate,
)
export function demoDetail(issue: Issue): IssueDetail {
  const comments =
    issue.id === first.id
      ? [
          {
            id: 'c1',
            author: { name: 'Giulia Rossi', login: 'giulia.rossi' },
            createdAt: '2026-10-21T09:15:00Z',
            updatedAt: '2026-10-21T09:15:00Z',
            body: 'Confermato anche nell’ambiente di test. La risposta di `POST /transfers` è corretta, ma la query del saldo non viene invalidata.\n\nAllego il [log della richiesta](https://demo.issueatlas.local/assets/request.log).',
          },
          {
            id: 'c2',
            author: { name: 'Marco Bianchi', login: 'marco.bianchi' },
            createdAt: '2026-10-22T13:30:00Z',
            updatedAt: '2026-10-22T14:05:00Z',
            body: "La cache viene aggiornata soltanto al mount del componente. Possiamo invalidare la query dopo la conferma:\n\n```typescript\nawait queryClient.invalidateQueries({\n  queryKey: ['account-balance', accountId],\n})\n```\n\nManteniamo l’ultimo valore valido durante il caricamento.",
          },
          {
            id: 'c3',
            author: { name: 'Alessandro Moretti', login: 'alessandro.moretti' },
            createdAt: '2026-10-23T08:42:00Z',
            updatedAt: '2026-10-23T08:42:00Z',
            body: 'Aggiunto ai criteri di accettazione il caso di errore. La soluzione deve coprire anche i bonifici programmati.\n\n- [x] Riproduzione verificata\n- [ ] Correzione e verifica finale',
          },
        ]
      : Array.from({ length: issue.commentCount }, (_, i) => ({
          id: `${issue.id}-c${i}`,
          author:
            i % 2
              ? { name: 'Marco Bianchi', login: 'marco.bianchi' }
              : { name: 'Giulia Rossi', login: 'giulia.rossi' },
          createdAt,
          updatedAt: createdAt,
          body: `Verifica ${i + 1}: comportamento confermato nell’ambiente di test. Procediamo con i criteri di accettazione indicati nella descrizione.`,
        }))
  if (issue.id === first.id) {
    comments[1].body += '\n\nStima: 2 giorni.'
    comments[2].body += '\n\nPer i bonifici programmati aggiungiamo 4 ore.'
  }
  return {
    ...issue,
    author: { name: 'Giulia Rossi', login: 'giulia.rossi' },
    comments,
    commentsComplete: true,
  }
}
function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/zip' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export const demoAPI: AtlasAPI = {
  monitoringSettings: async () => defaultMonitoringSettings(),
  saveMonitoringSettings: async () => {
    throw new Error('Configura Monitoraggio nell’app macOS.')
  },
  verifyMonitoring: async () => {
    throw new Error('La connessione a Monitoraggio è disponibile nell’app macOS.')
  },
  monitoringStatus: async () => emptyMonitoringStatus(),
  retryMonitoring: async () => {
    throw new Error('Gli invii sono disponibili nell’app macOS.')
  },
  handoffStatus: async () =>
    window.atlas
      ? window.atlas.handoffStatus()
      : { enabled: import.meta.env.ISSUE_ATLAS_HANDOFF_ENABLED === 'true' },
  copyHandoff: async (issue) => {
    if (window.atlas) return window.atlas.copyHandoff(issue)
    throw new Error(
      'Il riferimento MCP è disponibile nell’app macOS. Usa Copia testo o Esporta ZIP nella demo web.',
    )
  },
  aiSettings: async () => defaultAISettings(),
  saveAISettings: async () => {
    throw new Error(
      'Le impostazioni OpenAI si salvano nell’app macOS. La demo non conserva chiavi API.',
    )
  },
  aiModels: async () => {
    throw new Error('L’elenco modelli OpenAI è disponibile nell’app macOS.')
  },
  projectEstimates: async (id) =>
    JSON.parse(localStorage.getItem(`atlas:demo-estimates:${id}`) || 'null') ??
    defaultProjectEstimates(),
  saveProjectEstimates: async (id, settings) => {
    localStorage.setItem(`atlas:demo-estimates:${id}`, JSON.stringify(settings))
    return settings
  },
  estimates: async (ids) => ({
    items: ids.includes('demo-core') ? demoEstimates : [],
    running: false,
    dailyTokenBudget: defaultAISettings().dailyTokenBudget,
    usage: {
      date: new Date().toISOString().slice(0, 10),
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      chargedTokens: 0,
    },
  }),
  recalculateEstimate: async () => {
    throw new Error('Il calcolo delle stime è disponibile nell’app macOS.')
  },
  settings: async () => ({
    host: base,
    organizations: ['corebanking'],
    projectUrls: [`${base}/orgs/corebanking/projects/59/views/1`],
    hasToken: false,
  }),
  saveSettings: async () => {
    throw new Error(
      'Configura il token nell’app macOS. L’anteprima browser usa solo dati dimostrativi.',
    )
  },
  disconnect: async () => {},
  testConnection: async () => {
    throw new Error('La connessione a GitHub e il Portachiavi sono disponibili nell’app macOS.')
  },
  projects: async () => ({ projects: demoProjects, warnings: [], login: demoLogin }),
  cachedWorkspace: async () => null,
  projectLayout: async () => ({
    statusFieldName: 'Status',
    statuses: ['Todo', 'In progress', 'In review', 'Done'].map((name, i) => ({
      id: `status-${i}`,
      name,
      color: ['GRAY', 'YELLOW', 'PURPLE', 'GREEN'][i],
    })),
  }),
  cachedProject: async () => null,
  issues: async (id, _fieldName, statuses) =>
    (id === 'demo-core'
      ? demoIssues
      : demoIssues.slice(id === 'demo-digital' ? 1 : 3).map((issue, i) => ({
          ...issue,
          id: `${id}-${i}`,
          repository: id === 'demo-design' ? 'corebanking/design-system' : issue.repository,
        }))
    ).filter((issue) => !statuses || statuses.includes(issue.status)),
  issue: async (issue) => demoDetail(issue),
  findIssues: async (number, projectIds) => ({
    matches: (
      await Promise.all(
        demoProjects
          .filter((project) => projectIds.includes(project.id))
          .map(async (project) =>
            (await demoAPI.issues(project.id))
              .filter((issue) => issue.number === number)
              .map((issue) => ({ projectId: project.id, issue })),
          ),
      )
    ).flat(),
    warnings: [],
  }),
  notifications: async () => demoNotifications(),
  projectMetrics: async (projectIds) =>
    Promise.all(
      demoProjects
        .filter((project) => projectIds.includes(project.id))
        .map(async (project) => {
          const layout = await demoAPI.projectLayout(project.id)
          return metricSnapshot(
            project.id,
            await demoAPI.issues(project.id),
            Date.now(),
            layout.statuses,
          )
        }),
    ),
  notificationPreferences: async (projectId) => {
    try {
      return readNotificationPreferences(
        JSON.parse(
          localStorage.getItem(`atlas:demo-notification-preferences:${projectId}`) || 'null',
        ),
      )
    } catch {
      return readNotificationPreferences()
    }
  },
  saveNotificationPreferences: async (projectId, preferences) => {
    const value = readNotificationPreferences(preferences)
    localStorage.setItem(`atlas:demo-notification-preferences:${projectId}`, JSON.stringify(value))
    return value
  },
  grokHistory: async () => [],
  grokSettings: async () => defaultGrokSettings(),
  grokStatus: async () => emptyEmailStatus(),
  saveGrokSettings: async () => {
    throw new Error(
      'Le impostazioni Grok si salvano nell’app macOS. La demo non conserva credenziali.',
    )
  },
  verifyGrok: async () => {
    throw new Error('La verifica webhook è disponibile nell’app macOS.')
  },
  testGrok: async () => {
    throw new Error('L’invio della evento di prova è disponibile nell’app macOS.')
  },
  retryGrok: async () => {},
  syncActivity: async () => {
    const state = { ...demoNotifications(), lastCheckedAt: Date.now() }
    localStorage.setItem(demoNotificationKey, JSON.stringify(state))
    return { ...state, errors: [] }
  },
  markNotificationsRead: async (ids) => {
    const state = demoNotifications()
    state.items = state.items.map((item) =>
      ids.includes(item.id) ? { ...item, read: true } : item,
    )
    localStorage.setItem(demoNotificationKey, JSON.stringify(state))
    return state
  },
  asset: async (url) => {
    if (window.atlas) return window.atlas.asset(url)
    if (!url.startsWith('https://demo.issueatlas.local/'))
      throw new Error('Allegato non incluso nella demo.')
    const response = await fetch(`${import.meta.env.BASE_URL}demo-dashboard.svg`)
    const text = await response.text()
    return {
      dataUrl: `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`,
      mime: 'image/svg+xml',
    }
  },
  copyImage: async (url) => {
    if (!(await demoAPI.handoffStatus()).enabled) throw new Error('Copia ed export disattivati.')
    if (window.atlas) return window.atlas.copyImage(url)
    const asset = await demoAPI.asset(url)
    const img = new Image()
    img.src = asset.dataUrl
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    canvas.getContext('2d')!.drawImage(img, 0, 0)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Copia non disponibile.'))),
        'image/png',
      ),
    )
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  },
  copyIssue: async (issue) => {
    if (!(await demoAPI.handoffStatus()).enabled) throw new Error('Copia ed export disattivati.')
    return window.atlas
      ? window.atlas.copyIssue(issue)
      : navigator.clipboard.writeText(issueMarkdown(issue))
  },
  exportIssue: async (issue) => {
    if (!(await demoAPI.handoffStatus()).enabled) throw new Error('Copia ed export disattivati.')
    if (window.atlas) return window.atlas.exportIssue(issue)
    const files: Record<string, string> = {}
    const entries: Record<string, Uint8Array> = {}
    for (const asset of collectAssets(issue).filter((a) => a.kind !== 'link')) {
      const path = `assets/${asset.id}-${asset.kind === 'image' ? 'dashboard.svg' : 'request.log'}`
      files[asset.url] = path
      entries[path] =
        asset.kind === 'image'
          ? strToU8(await (await fetch(`${import.meta.env.BASE_URL}demo-dashboard.svg`)).text())
          : strToU8('DEMO — POST /transfers 201 Created\nCache account-balance: stale\n')
    }
    entries['issue.md'] = strToU8(issueMarkdown(issue, files))
    entries['manifest.json'] = strToU8(
      JSON.stringify(
        {
          demo: true,
          assets: collectAssets(issue).map((a) => ({
            ...a,
            localPath: files[a.url] ?? null,
            status: files[a.url] ? 'downloaded' : 'manual-check',
          })),
        },
        null,
        2,
      ),
    )
    download(zipSync(entries), `demo-issue-${issue.number}.zip`)
    return {
      canceled: false,
      downloaded: Object.keys(files).length,
      manual: collectAssets(issue).length - Object.keys(files).length,
    }
  },
  openExternal: async (url) => {
    if (window.atlas) return window.atlas.openExternal(url)
    if (['https:', 'http:'].includes(new URL(url).protocol))
      window.open(url, '_blank', 'noopener,noreferrer')
  },
}
