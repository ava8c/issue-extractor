import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  CheckCheck,
  Bell,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Clock3,
  ExternalLink,
  FileArchive,
  FileText,
  FolderKanban,
  Github,
  Inbox,
  Keyboard,
  Layers3,
  Link2,
  LoaderCircle,
  LockKeyhole,
  MessageSquare,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Star,
  TriangleAlert,
  Unplug,
  X,
  GripVertical,
  List,
  Columns3,
  Pencil,
  LayoutDashboard,
} from 'lucide-react'
import { demoAPI } from './demo'
import { Conversation, revealConversationSource } from './components/Conversation'
import { AssetImage, clearImageCache } from './components/Markdown'
import { collectAssets } from './shared/export'
import { disabledHandoff, type HandoffStatus } from './shared/handoff'
import { HandoffContext } from './components/HandoffContext'
import { IssueExportBar, IssueExportView } from './components/IssueExport'
import type {
  Issue,
  IssueLocation,
  CachedProject,
  IssueDetail,
  Project,
  ProjectLayout,
  Settings,
  SettingsInput,
  Workspace,
} from './shared/types'
import { errorMessage } from './shared/errors'
import { issueScope, mapConcurrent, PROJECT_CACHE_MAX_AGE } from './shared/loading'
import { labelColors } from './shared/colors'
import {
  defaultPreferences,
  matchesIssueFilter,
  moveBefore,
  orderProjects,
  orderStatuses,
  readPreferences,
  sortIssues,
  type IssueSort,
  type ProjectPreferences,
  type StatusFilter,
  type WorkspacePreferences,
} from './shared/preferences'
import { IssueFilters, KanbanBoard } from './components/IssueBrowser'
import { ProjectManager, StatusManager, SidebarResizer } from './components/WorkspaceCustomization'
import { QuickIssueSearch } from './components/QuickIssueSearch'
import { NotificationCenter } from './components/NotificationCenter'
import { ProjectNotificationSettings } from './components/ProjectNotificationSettings'
import { useActivity } from './useActivity'
import { EmailSettingsPanel } from './components/EmailSettings'
import { AISettingsPanel, ProjectEstimateSettingsModal } from './components/EstimateSettings'
import { EstimateBadge, IssueEstimatePanel } from './components/IssueEstimate'
import { useEstimates } from './useEstimates'
import type { IssueEstimate } from './shared/estimates'
import { summarizeMetrics } from './shared/metrics'
import { useProjectMetrics } from './useProjectMetrics'
import {
  MetricsOverview,
  MetricsDashboard,
  MetricSettings,
  type MetricRow,
} from './components/ProjectMetrics'

const native = window.atlas
const palette = ['#7770d8', '#4e9b97', '#c88e50', '#b270a8', '#688fb9']
const shortDate = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short' })
const fullDate = new Intl.DateTimeFormat('it-IT', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZoneName: 'short',
})
function localDate(date: string, full = false) {
  return (full ? fullDate : shortDate).format(new Date(date))
}
function stateColor(status: string) {
  if (/done|closed|complet|chius/i.test(status)) return 'green'
  if (/progress|corso|lavor/i.test(status)) return 'amber'
  if (/review|revis/i.test(status)) return 'purple'
  return 'gray'
}
function StatusIcon({ issue, size = 16 }: { issue: Issue; size?: number }) {
  return issue.state === 'CLOSED' || issue.state === 'MERGED' ? (
    <CircleCheck className="state-closed" size={size} />
  ) : issue.kind === 'draft' ? (
    <CircleDashed className="state-draft" size={size} />
  ) : (
    <CircleDot className="state-open" size={size} />
  )
}
function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`logo ${small ? 'small' : ''}`}>
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
        <path
          d="m5 18 7-12 7 12M8.5 13h7M12 6v14"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="6" r="1.5" fill="currentColor" />
      </svg>
    </span>
  )
}
function SettingsModal({
  initial,
  onClose,
  onSave,
  notify,
  onAISaved,
}: {
  initial: Settings
  onClose: () => void
  onSave: (settings: Settings) => void
  notify: (s: string, error?: boolean) => void
  onAISaved: () => void
}) {
  const [host, setHost] = useState(initial.host)
  const [settingsTab, setSettingsTab] = useState<'github' | 'email' | 'ai'>('github')
  const [token, setToken] = useState('')
  const [organizations, setOrganizations] = useState(initial.organizations.join(', '))
  const [urls, setUrls] = useState(initial.projectUrls.join('\n'))
  const [assetHosts, setAssetHosts] = useState((initial.assetHosts ?? []).join('\n'))
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')
  const modalRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    function trap(event: KeyboardEvent) {
      if (event.key !== 'Tab') return
      const elements = modalRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input, select, textarea, a[href]',
      )
      if (!elements?.length) return
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', trap)
    return () => {
      document.removeEventListener('keydown', trap)
      previous?.focus()
    }
  }, [])
  const api = native ?? demoAPI
  const input = (): SettingsInput => ({
    host,
    token: token || undefined,
    assetHosts: assetHosts
      .split(/[,\n]/)
      .map((value) => value.trim())
      .filter(Boolean),
    organizations: organizations
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean),
    projectUrls: urls
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  })
  const dirty = () => {
    setResult('')
    setError('')
  }
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => e.target === e.currentTarget && !saving && onClose()}
    >
      <section
        ref={modalRef}
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <div className="modal-header">
          <span className="modal-icon">
            <Settings2 size={21} />
          </span>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Chiudi impostazioni"
            disabled={saving}
          >
            <X size={19} />
          </button>
        </div>
        <h2 id="settings-title">
          {settingsTab === 'github'
            ? 'Il tuo GitHub, connesso.'
            : settingsTab === 'ai'
              ? 'Le stime, sempre visibili.'
              : 'Ricevi notifiche via mail.'}
        </h2>
        <p className="modal-description">
          {settingsTab === 'github'
            ? 'Collega la tua istanza Enterprise. I tuoi progetti e le tue issue, in un unico workspace.'
            : settingsTab === 'ai'
              ? 'Scegli modello e limiti, poi abilita i singoli progetti.'
              : 'I cambiamenti delle tue issue, direttamente nella tua casella.'}
        </p>
        <div className="settings-tabs" role="tablist" aria-label="Sezione impostazioni">
          <button
            type="button"
            role="tab"
            aria-selected={settingsTab === 'github'}
            disabled={saving || testing}
            onClick={() => setSettingsTab('github')}
          >
            GitHub
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={settingsTab === 'email'}
            disabled={saving || testing}
            onClick={() => setSettingsTab('email')}
          >
            Notifiche via mail
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={settingsTab === 'ai'}
            disabled={saving || testing}
            onClick={() => setSettingsTab('ai')}
          >
            OpenAI e stime
          </button>
        </div>
        {settingsTab === 'ai' ? (
          <AISettingsPanel api={api} onBusy={setSaving} saved={onAISaved} />
        ) : settingsTab === 'email' ? (
          <EmailSettingsPanel api={api} onBusy={setSaving} />
        ) : (
          <>
            {!native && (
              <div className="notice">
                <BookOpen size={16} />
                <span>Anteprima browser. La connessione è disponibile nell’app macOS.</span>
              </div>
            )}
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                setSaving(true)
                setError('')
                try {
                  const settings = await api.saveSettings(input())
                  setToken('')
                  onSave(settings)
                  notify('GitHub collegato. Caricamento dei tuoi progetti…')
                } catch (e) {
                  setError(errorMessage(e))
                } finally {
                  setSaving(false)
                }
              }}
            >
              <label htmlFor="host">Indirizzo GitHub Enterprise</label>
              <div className="input-icon">
                <Github size={17} />
                <input
                  id="host"
                  autoFocus
                  type="url"
                  required
                  value={host}
                  onChange={(e) => {
                    setHost(e.target.value)
                    dirty()
                  }}
                  placeholder="https://github.azienda.it"
                />
              </div>
              <label htmlFor="token">
                Personal access token{' '}
                <span className="field-optional">
                  {initial.hasToken ? 'Token già salvato' : 'Richiesto'}
                </span>
              </label>
              <div className="input-icon">
                <LockKeyhole size={16} />
                <input
                  id="token"
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  value={token}
                  required={!initial.hasToken || host !== initial.host}
                  onChange={(e) => {
                    setToken(e.target.value)
                    dirty()
                  }}
                  placeholder={
                    initial.hasToken
                      ? 'Lascia vuoto per conservare il token'
                      : 'Incolla il tuo token di accesso'
                  }
                />
              </div>
              <p className="field-help">
                PAT classico: <code>read:project</code>, <code>repo</code> e <code>read:org</code>.
                Autorizza il token via SSO se richiesto dall’organizzazione.
              </p>
              <label htmlFor="organizations">
                Organizzazioni{' '}
                <span className="field-optional">Scoperta automatica + aggiunte manuali</span>
              </label>
              <input
                id="organizations"
                value={organizations}
                onChange={(e) => {
                  setOrganizations(e.target.value)
                  dirty()
                }}
                placeholder="corebanking, altra-organizzazione"
              />
              <label htmlFor="urls">
                Link diretti ai progetti{' '}
                <span className="field-optional">Facoltativo · uno per riga</span>
              </label>
              <textarea
                id="urls"
                rows={2}
                value={urls}
                onChange={(e) => {
                  setUrls(e.target.value)
                  dirty()
                }}
                placeholder="https://github.azienda.it/orgs/team/projects/59/views/1"
              />
              <label htmlFor="asset-hosts">
                Host allegati aziendali{' '}
                <span className="field-optional">Facoltativo · uno per riga</span>
              </label>
              <textarea
                id="asset-hosts"
                rows={2}
                value={assetHosts}
                onChange={(e) => {
                  setAssetHosts(e.target.value)
                  dirty()
                }}
                placeholder="https://allegati.azienda.it"
              />
              <p className="field-help">
                Gli host dello stesso dominio aziendale sono già supportati, anche via VPN. Aggiungi
                qui eventuali server su altri domini. Il token viene inviato soltanto all’istanza
                GitHub.
              </p>
              <div className="secure-note">
                <ShieldCheck size={17} />
                <span>
                  Token cifrato con il Portachiavi macOS. Le richieste partono dal tuo Mac; nessun
                  server intermedio.
                </span>
              </div>
              {error && (
                <div role="alert" className="notice error">
                  <TriangleAlert size={16} />
                  <span>{error}</span>
                </div>
              )}
              {result && (
                <div role="status" className="notice success">
                  <CheckCheck size={16} />
                  <span>Connessione riuscita come {result}. Salva per caricare i progetti.</span>
                </div>
              )}
              <div className="modal-footer">
                <button
                  className="button secondary"
                  type="button"
                  disabled={testing || saving}
                  onClick={async () => {
                    setTesting(true)
                    setError('')
                    setResult('')
                    try {
                      setResult(await api.testConnection(input()))
                    } catch (e) {
                      setError(errorMessage(e))
                    } finally {
                      setTesting(false)
                    }
                  }}
                >
                  {testing ? <LoaderCircle size={15} className="spin" /> : <Unplug size={15} />}
                  Verifica connessione
                </button>
                <button className="button primary" type="submit" disabled={saving || testing}>
                  {saving ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}Salva
                  e connetti
                </button>
              </div>
            </form>
            {initial.hasToken && (
              <button
                className="disconnect"
                onClick={async () => {
                  try {
                    await api.disconnect()
                    onSave(await api.settings())
                    notify('Token rimosso dal Mac.')
                  } catch (e) {
                    setError(errorMessage(e))
                  }
                }}
              >
                Disconnetti e rimuovi il token
              </button>
            )}
          </>
        )}
      </section>
    </div>
  )
}

export function App() {
  const [handoff, setHandoff] = useState<HandoffStatus>(disabledHandoff)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [quickSearchOpen, setQuickSearchOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notificationSettingsOpen, setNotificationSettingsOpen] = useState(false)
  const [estimateSettingsOpen, setEstimateSettingsOpen] = useState(false)
  const [navigationTarget, setNavigationTarget] = useState<IssueLocation | null>(null)
  const [projects, setProjects] = useState<Project[]>([])
  const [selectedProject, setSelectedProject] = useState('dashboard')
  const [metricSettingsProject, setMetricSettingsProject] = useState<string | null>(null)
  const [issues, setIssues] = useState<Issue[]>([])
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null)
  const [detail, setDetail] = useState<IssueDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [syncedAt, setSyncedAt] = useState<number | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [detailError, setDetailError] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])
  const [warningsOpen, setWarningsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [projectQuery, setProjectQuery] = useState('')
  const [storedPreferences, setStoredPreferences] = useState<{
    key: string | null
    value: WorkspacePreferences
  }>({ key: null, value: defaultPreferences() })
  const [managerOpen, setManagerOpen] = useState(false)
  const [statusManagerOpen, setStatusManagerOpen] = useState(false)
  const [layouts, setLayouts] = useState<Record<string, ProjectLayout>>({})
  const [tab, setTab] = useState<'conversation' | 'assets' | 'estimate' | 'export'>('conversation')
  const [refresh, setRefresh] = useState(0)
  const [detailRefresh, setDetailRefresh] = useState(0)
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null)
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null)
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('atlas:favorites') || '[]')
    } catch {
      return []
    }
  })
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [projectSearch, setProjectSearch] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const cache = useRef(new Map<string, CachedProject>())
  const isDemo = !settings?.hasToken
  const api = isDemo ? demoAPI : (native ?? demoAPI)
  const preferenceKey = settings ? `atlas:preferences:${isDemo ? 'demo' : settings.host}` : null
  const preferences = useMemo(
    () =>
      storedPreferences.key === preferenceKey
        ? storedPreferences.value
        : readPreferences(preferenceKey ? localStorage.getItem(preferenceKey) : null),
    [storedPreferences, preferenceKey],
  )
  const projectPreferences = preferences.projects[selectedProject] ?? {}
  function updatePreferences(update: (current: WorkspacePreferences) => WorkspacePreferences) {
    setStoredPreferences((current) => ({
      key: preferenceKey,
      value: update(
        current.key === preferenceKey
          ? current.value
          : readPreferences(preferenceKey ? localStorage.getItem(preferenceKey) : null),
      ),
    }))
  }
  function updateProject(id: string, patch: Partial<ProjectPreferences>) {
    updatePreferences((current) => ({
      ...current,
      projects: { ...current.projects, [id]: { ...current.projects[id], ...patch } },
    }))
  }
  const stateFilter = projectPreferences.stateFilter ?? 'all'
  const repoFilter = projectPreferences.repoFilter ?? 'all'
  const statusFilter = projectPreferences.statusFilter ?? 'all'
  const includeDrafts = projectPreferences.includeDrafts !== false
  const statusKey = JSON.stringify(statusFilter === 'all' ? null : [...statusFilter].sort())
  const sort = projectPreferences.sort ?? 'status'
  const viewMode = projectPreferences.view ?? 'list'
  const viewRef = useRef(viewMode)
  viewRef.current = viewMode
  const setStateFilter = (value: string) => updateProject(selectedProject, { stateFilter: value })
  const setRepoFilter = (value: string) => updateProject(selectedProject, { repoFilter: value })
  const setStatusFilter = (value: StatusFilter) =>
    updateProject(selectedProject, { statusFilter: value })
  const setIncludeDrafts = (value: boolean) =>
    updateProject(selectedProject, { includeDrafts: value })
  const setSort = (value: IssueSort) => updateProject(selectedProject, { sort: value })
  const layoutCache = useRef(new Map<string, ProjectLayout>())
  const orderedProjects = useMemo(
    () => orderProjects(projects, preferences.projectOrder),
    [projects, preferences.projectOrder],
  )
  const visibleProjectKey = projects
    .filter((p) => !preferences.projects[p.id]?.hidden)
    .map((p) => p.id)
    .sort()
    .join('|')
  const visibleIds = new Set(visibleProjectKey.split('|'))
  const activity = useActivity(
    api,
    visibleProjectKey,
    !!settings && projects.length > 0 && !loading && !syncing && !discovering,
    settings,
  )
  const metrics = useProjectMetrics(
    api,
    visibleProjectKey,
    settings,
    activity.lastCheckedAt,
    activity.syncing,
  )
  const isDashboard = selectedProject === 'dashboard'
  const activityItems = useMemo(() => {
    const visible = new Set(visibleProjectKey.split('|'))
    return activity.items.filter((item) => visible.has(item.projectId))
  }, [activity.items, visibleProjectKey])
  const unreadNotifications = activityItems.filter((item) => !item.read).length
  const estimates = useEstimates(api, visibleProjectKey, settings)
  const estimatesByIssue = useMemo(() => {
    const result: Record<string, IssueEstimate[]> = {}
    for (const item of estimates.state?.items ?? []) {
      if (selectedProject !== 'all' && item.projectId !== selectedProject) continue
      ;(result[item.issueId] ??= []).push(item)
    }
    return result
  }, [estimates.state, selectedProject])
  const navigationProjects = useMemo(() => {
    const visible = new Set(visibleProjectKey.split('|'))
    return orderedProjects
      .filter((project) => visible.has(project.id))
      .map((project) => ({
        ...project,
        title: preferences.projects[project.id]?.title?.trim() || project.title,
      }))
  }, [orderedProjects, visibleProjectKey, preferences.projects])
  const metricRows = useMemo<MetricRow[]>(() => {
    const snapshots = new Map(metrics.snapshots.map((snapshot) => [snapshot.projectId, snapshot]))
    return navigationProjects.map((project) => {
      const snapshot = snapshots.get(project.id)
      const mapping = preferences.projects[project.id]?.metricMapping ?? {}
      return {
        project,
        snapshot,
        mapping,
        summary: snapshot?.syncedAt ? summarizeMetrics(snapshot, mapping) : null,
      }
    })
  }, [metrics.snapshots, navigationProjects, preferences.projects])
  const metricSettingsRow = metricRows.find((row) => row.project.id === metricSettingsProject)
  const originalProject = projects.find((p) => p.id === selectedProject)
  const project = originalProject
    ? { ...originalProject, title: projectPreferences.title?.trim() || originalProject.title }
    : undefined
  const currentMetricRows = project
    ? metricRows.filter((row) => row.project.id === project.id)
    : metricRows
  useEffect(() => {
    setStoredPreferences({
      key: preferenceKey,
      value: readPreferences(preferenceKey ? localStorage.getItem(preferenceKey) : null),
    })
  }, [preferenceKey])
  useEffect(() => {
    if (preferenceKey && storedPreferences.key === preferenceKey)
      localStorage.setItem(preferenceKey, JSON.stringify(storedPreferences.value))
  }, [preferenceKey, storedPreferences])
  useEffect(() => {
    if (
      selectedProject &&
      selectedProject !== 'all' &&
      selectedProject !== 'dashboard' &&
      projects.length &&
      !visibleProjectKey.split('|').includes(selectedProject)
    )
      setSelectedProject(visibleProjectKey.split('|')[0] || 'all')
  }, [selectedProject, visibleProjectKey, projects.length])

  const assets = useMemo(() => (detail ? collectAssets(detail) : []), [detail])
  const notify = useCallback(
    (text: string, error = false) =>
      setToast({
        text: errorMessage(text),
        error,
      }),
    [],
  )
  const openImage = useCallback((src: string, alt: string) => setLightbox({ src, alt }), [])
  useEffect(() => {
    const readStatus = (native ?? demoAPI).handoffStatus
    if (!readStatus) return // The main process/preload may still need a restart during development.
    void readStatus()
      .then((status) => {
        setHandoff(status)
        if (status.error) notify(status.error, true)
      })
      .catch((error) => notify(error.message, true))
  }, [notify])
  useEffect(() => {
    void (native ?? demoAPI)
      .settings()
      .then(setSettings)
      .catch((e) => {
        setSettings({
          host: 'https://github.servizi.allitude.it',
          organizations: ['corebanking'],
          projectUrls: [],
          hasToken: false,
        })
        notify(e.message, true)
      })
  }, [notify])
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), toast.error ? 10000 : 6000)
    return () => clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    localStorage.setItem('atlas:favorites', JSON.stringify(favorites))
  }, [favorites])
  useEffect(() => native?.onSettings?.(() => setSettingsOpen(true)), [])
  useEffect(
    () =>
      native?.onQuickSearch?.(() => {
        setNotificationsOpen(false)
        setQuickSearchOpen(true)
      }),
    [],
  )
  useEffect(() => {
    function key(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setNotificationsOpen(false)
        setQuickSearchOpen(true)
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        if (document.querySelector('[role="dialog"]')) return
        e.preventDefault()
        searchRef.current?.focus()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        setSettingsOpen(true)
      }
      if (e.key === 'Escape') {
        setLightbox(null)
        setSettingsOpen(false)
        setWarningsOpen(false)
        setManagerOpen(false)
        setStatusManagerOpen(false)
        setNotificationsOpen(false)
        setQuickSearchOpen(false)
        setNavigationTarget(null)
        if (viewRef.current === 'kanban') setSelectedIssue(null)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])
  useEffect(() => {
    cache.current.clear()
    layoutCache.current.clear()
    setLayouts({})
    setIssues([])
    setSelectedIssue(null)
    setDetail(null)
    setNavigationTarget(null)
    setQuickSearchOpen(false)
    setNotificationsOpen(false)
    setNotificationSettingsOpen(false)
    setMetricSettingsProject(null)
  }, [settings, api])
  useEffect(() => {
    if (!settings) return
    let active = true
    setDiscovering(false)
    if (!projects.length) setLoading(true)
    setError('')
    let hasProjects = projects.length > 0
    function publishWorkspace(workspace: Workspace) {
      if (!active) return
      hasProjects = workspace.projects.length > 0
      setProjects([...workspace.projects])
      setWarnings(workspace.warnings)
      setSelectedProject((current) =>
        current === 'all' ||
        current === 'dashboard' ||
        workspace.projects.some((p) => p.id === current)
          ? current
          : 'dashboard',
      )
    }
    async function loadWorkspace() {
      const cached = await api.cachedWorkspace().catch(() => null)
      if (!active) return
      if (cached && !hasProjects) publishWorkspace(cached.workspace)
      if (
        cached &&
        Date.now() - cached.syncedAt < PROJECT_CACHE_MAX_AGE &&
        cached.syncedAt >= refresh
      )
        return
      setDiscovering(true)
      const workspace = await api.projects()
      publishWorkspace(workspace)
    }
    loadWorkspace()
      .catch((e) => {
        if (active) {
          if (hasProjects)
            notify(`Dati locali conservati. Aggiornamento progetti: ${errorMessage(e)}`, true)
          else {
            setError(errorMessage(e))
            setProjects([])
            setSelectedProject('')
          }
        }
      })
      .finally(() => {
        if (active) setDiscovering(false)
        if (active && !hasProjects) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [settings, api, refresh])
  useEffect(() => {
    if (selectedProject === 'dashboard') {
      setLoading(false)
      setSyncing(false)
      setSyncedAt(null)
      setIssues([])
      setSelectedIssue(null)
      return
    }
    if (
      !selectedProject ||
      !projects.length ||
      (selectedProject !== 'all' && !visibleProjectKey.split('|').includes(selectedProject))
    )
      return
    let active = true
    setLoading(true)
    setSyncing(false)
    setSyncedAt(null)
    setError('')
    setSelectedIssue(null)
    setIssues([])
    async function load() {
      const selectedStatuses: string[] | undefined = JSON.parse(statusKey) ?? undefined
      const visible = new Set(visibleProjectKey.split('|'))
      const targets =
        selectedProject === 'all'
          ? projects.filter((p) => visible.has(p.id))
          : projects.filter((p) => p.id === selectedProject)
      const snapshots = new Map<string, CachedProject>()
      function publish() {
        if (!active) return
        // Project order makes deduplication deterministic while requests finish independently.
        const next = targets.flatMap((p) => snapshots.get(p.id)?.issues ?? [])
        setIssues([...new Map(next.map((issue) => [issue.id, issue])).values()])
        setLayouts(Object.fromEntries(layoutCache.current))
        const times = [...snapshots.values()].map((snapshot) => snapshot.syncedAt)
        setSyncedAt(times.length ? Math.min(...times) : null)
        if (snapshots.size) setLoading(false)
      }
      await mapConcurrent(targets, 3, async (p) => {
        const key = issueScope(p.id, selectedStatuses)
        const snapshot =
          cache.current.get(key) ??
          (await api.cachedProject(p.id, selectedStatuses).catch(() => null))
        if (!active || !snapshot) return
        snapshots.set(p.id, snapshot)
        cache.current.set(key, snapshot)
        while (cache.current.size > 30) cache.current.delete(cache.current.keys().next().value!)
        if (snapshot.layout) layoutCache.current.set(p.id, snapshot.layout)
      })
      publish()
      const stale = targets.filter((p) => {
        const snapshot = snapshots.get(p.id)
        return (
          !snapshot ||
          Date.now() - snapshot.syncedAt >= PROJECT_CACHE_MAX_AGE ||
          snapshot.syncedAt < refresh
        )
      })
      if (active) setSyncing(stale.length > 0)
      const failures: string[] = []
      await mapConcurrent(stale, 3, async (p) => {
        if (!active) return
        try {
          let layout = layoutCache.current.get(p.id)
          try {
            layout = await api.projectLayout(p.id)
            if (active) {
              layoutCache.current.set(p.id, layout)
              setLayouts(Object.fromEntries(layoutCache.current))
            }
          } catch (error) {
            layout ??= { statusFieldName: 'Status', statuses: [] }
            if (active)
              setWarnings((current) => [
                ...new Set([...current, `Stati di ${p.title}: ${errorMessage(error)}`]),
              ])
          }
          if (!active) return
          const result = await api.issues(p.id, layout.statusFieldName, selectedStatuses)
          if (!active) return
          const snapshot = { issues: result, syncedAt: Date.now(), layout }
          snapshots.set(p.id, snapshot)
          cache.current.set(issueScope(p.id, selectedStatuses), snapshot)
          while (cache.current.size > 30) cache.current.delete(cache.current.keys().next().value!)
          publish()
        } catch (error) {
          failures.push(`${p.title}: ${errorMessage(error)}`)
        }
      })
      if (active && failures.length) {
        if (!snapshots.size) setError(failures.join('\n'))
        else
          notify(`Dati locali conservati. Aggiornamento incompleto: ${failures.join(' · ')}`, true)
      }
    }
    load()
      .catch((e) => {
        if (active) setError(errorMessage(e))
      })
      .finally(() => {
        if (active) {
          setLoading(false)
          setSyncing(false)
        }
      })
    return () => {
      active = false
    }
  }, [selectedProject, projects, api, visibleProjectKey, statusKey])
  useEffect(() => {
    if (!selectedIssue) {
      setDetail(null)
      return
    }
    let active = true
    setDetail(null)
    setDetailLoading(true)
    setDetailError('')
    setTab('conversation')
    contentRef.current?.scrollTo(0, 0)
    api
      .issue(selectedIssue)
      .then((issue) => {
        if (active) setDetail(issue)
      })
      .catch((e) => {
        if (active) setDetailError(errorMessage(e))
      })
      .finally(() => {
        if (active) setDetailLoading(false)
      })
    return () => {
      active = false
    }
  }, [selectedIssue, api, detailRefresh])
  const statuses = useMemo(
    () =>
      orderStatuses(
        selectedProject === 'all'
          ? projects
              .filter((p) => visibleProjectKey.split('|').includes(p.id))
              .flatMap((p) => layouts[p.id]?.statuses ?? [])
          : (layouts[selectedProject]?.statuses ?? []),
        issues,
        projectPreferences.statusOrder,
      ),
    [layouts, issues, selectedProject, visibleProjectKey, projects, projectPreferences.statusOrder],
  )
  const searchableIssues = useMemo(
    () =>
      new Map(
        issues.map((issue) => [
          issue.id,
          `${issue.title} ${issue.number} ${issue.repository} ${issue.labels.map((label) => label.name).join(' ')}`.toLocaleLowerCase(),
        ]),
      ),
    [issues],
  )
  const filtered = useMemo(() => {
    const search = deferredQuery.toLocaleLowerCase().replace(/^#/, '')
    return sortIssues(
      issues.filter((i) => {
        return (
          (!search || searchableIssues.get(i.id)?.includes(search)) &&
          (stateFilter === 'all' ||
            (stateFilter === 'open'
              ? i.state === 'OPEN' || i.state === 'DRAFT'
              : i.state === 'CLOSED' || i.state === 'MERGED')) &&
          (repoFilter === 'all' || i.repository === repoFilter) &&
          matchesIssueFilter(i, statusFilter, includeDrafts)
        )
      }),
      sort,
      statuses,
    )
  }, [
    issues,
    deferredQuery,
    searchableIssues,
    stateFilter,
    repoFilter,
    statusFilter,
    includeDrafts,
    sort,
    statuses,
  ])
  const repos = useMemo(
    () => [
      ...new Set([
        ...issues.map((issue) => issue.repository),
        ...(repoFilter === 'all' ? [] : [repoFilter]),
      ]),
    ],
    [issues, repoFilter],
  )
  useEffect(() => {
    if (isDashboard) return
    if (navigationTarget?.projectId === selectedProject) {
      // The direct target may contain a newer project status than the cached filtered list.
      const target = navigationTarget.issue
      if (selectedIssue !== target) setSelectedIssue(target)
      return
    }
    if (loading || viewMode !== 'list') return
    if (selectedIssue && filtered.some((issue) => issue.id === selectedIssue.id)) return
    setSelectedIssue(filtered[0] ?? null)
  }, [
    filtered,
    loading,
    selectedIssue,
    viewMode,
    navigationTarget,
    selectedProject,
    issues,
    isDashboard,
  ])
  const shownProjects = orderedProjects.filter(
    (p) =>
      visibleIds.has(p.id) &&
      (preferences.projects[p.id]?.title || p.title)
        .toLowerCase()
        .includes(projectQuery.toLowerCase()) &&
      (!favoritesOnly || favorites.includes(p.id)),
  )
  async function copy() {
    if (!detail || !handoff.enabled) return
    setBusy('copy')
    try {
      await api.copyIssue(detail)
      notify('Testo copiato con tutti i commenti e le reference degli allegati.')
    } catch (e) {
      notify((e as Error).message, true)
    } finally {
      setBusy('')
    }
  }
  async function exportZip() {
    if (!detail || !handoff.enabled) return
    setBusy('zip')
    try {
      const result = await api.exportIssue(detail)
      if (!result.canceled)
        notify(
          `ZIP esportato: ${result.downloaded} allegati scaricati${result.manual ? ` · ${result.manual} link da verificare nel manifest` : ' · contesto completo'}.`,
        )
    } catch (e) {
      notify((e as Error).message, true)
    } finally {
      setBusy('')
    }
  }
  async function copyReference() {
    if (!detail || !handoff.enabled) return
    setBusy('reference')
    try {
      await api.copyHandoff(detail)
      notify(
        'Riferimento copiato con le istruzioni per recuperare contesto e allegati. Mantieni l’app aperta.',
      )
    } catch (error) {
      notify((error as Error).message, true)
    } finally {
      setBusy('')
    }
  }
  function selectProject(id: string) {
    setNavigationTarget(null)
    setSelectedProject(id)
    setQuery('')
    setFavoritesOnly(false)
  }
  function selectIssue(issue: Issue | null) {
    setNavigationTarget(null)
    setSelectedIssue(issue)
  }
  function openIssueLocation(location: IssueLocation) {
    setQuickSearchOpen(false)
    setNotificationsOpen(false)
    setSelectedProject(location.projectId)
    setFavoritesOnly(false)
    setQuery('')
    setNavigationTarget(location)
  }
  function toggleFavorite(id: string) {
    setFavorites((current) =>
      current.includes(id) ? current.filter((i) => i !== id) : [...current, id],
    )
  }
  const displayIssue = detail ?? selectedIssue
  return (
    <HandoffContext.Provider value={handoff}>
      <div className={`app ${native ? 'native' : 'browser-preview'}`}>
        <aside className="sidebar" style={{ width: preferences.sidebarWidth }}>
          <SidebarResizer
            width={preferences.sidebarWidth}
            onResize={(sidebarWidth) =>
              updatePreferences((current) => ({ ...current, sidebarWidth }))
            }
          />
          <div className="window-drag">
            <span className="traffic-lights">
              <i />
              <i />
              <i />
            </span>
          </div>
          <div className="brand">
            <Logo />
            <div>Issue Atlas</div>
          </div>
          <div className="workspace-card">
            <span className="workspace-avatar">
              <Layers3 size={18} />
            </span>
            <div>
              <strong>
                {isDemo ? 'Workspace demo' : settings?.organizations[0] || 'Il mio workspace'}
              </strong>
              <span>GitHub Enterprise</span>
            </div>
            <span
              className={`connection-dot ${isDemo ? 'demo' : ''}`}
              title={isDemo ? 'Modalità demo' : 'Token configurato'}
            />
          </div>
          <nav className="nav-primary" aria-label="Navigazione principale">
            <button
              className={isDashboard ? 'active' : ''}
              aria-current={isDashboard ? 'page' : undefined}
              onClick={() => selectProject('dashboard')}
            >
              <LayoutDashboard size={17} />
              Dashboard
            </button>
            <button
              className={selectedProject === 'all' && !favoritesOnly ? 'active' : ''}
              onClick={() => selectProject('all')}
            >
              <Inbox size={17} />
              Tutte le issue
              {selectedProject === 'all' && <span className="nav-count">{issues.length}</span>}
            </button>
            <button
              className={favoritesOnly ? 'active' : ''}
              onClick={() => setFavoritesOnly((v) => !v)}
            >
              <Star size={17} />
              Progetti preferiti
              {favorites.length > 0 && <span className="nav-count">{favorites.length}</span>}
            </button>
          </nav>
          <div className="sidebar-section-title">
            <span>PROGETTI</span>
            <div>
              <button
                className="tiny-button"
                title="Organizza progetti"
                aria-label="Organizza progetti"
                onClick={() => setManagerOpen(true)}
              >
                <Settings2 size={15} />
              </button>
              <button
                className={`tiny-button ${projectSearch ? 'selected' : ''}`}
                title="Cerca progetto"
                onClick={() => {
                  setProjectSearch((v) => !v)
                  setProjectQuery('')
                }}
              >
                <Search size={14} />
              </button>
              <button
                className="tiny-button"
                title="Aggiungi organizzazioni o progetti"
                onClick={() => setSettingsOpen(true)}
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
          {projectSearch && (
            <input
              className="project-search"
              autoFocus
              placeholder="Cerca progetto…"
              value={projectQuery}
              onChange={(e) => setProjectQuery(e.target.value)}
            />
          )}
          <nav className="projects-nav" aria-label="Progetti">
            {shownProjects.map((p) => (
              <div
                key={p.id}
                className={`project-nav-item ${selectedProject === p.id ? 'active' : ''}`}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes('text/atlas-project')) e.preventDefault()
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const id = e.dataTransfer.getData('text/atlas-project')
                  updatePreferences((current) => ({
                    ...current,
                    projectOrder: moveBefore(
                      orderedProjects.map((p) => p.id),
                      id,
                      p.id,
                    ),
                  }))
                }}
              >
                <span
                  className="project-drag-handle"
                  draggable
                  title="Trascina per riordinare il progetto"
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/atlas-project', p.id)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                >
                  <GripVertical size={12} />
                </span>
                <button
                  className="project-main"
                  onClick={() => selectProject(p.id)}
                  title={preferences.projects[p.id]?.title || p.title}
                >
                  <FolderKanban
                    size={16}
                    style={{ color: palette[projects.indexOf(p) % palette.length] }}
                  />
                  <span>{preferences.projects[p.id]?.title?.trim() || p.title}</span>
                  {p.closed && <LockKeyhole size={11} />}
                </button>
                <button
                  className={`favorite-button ${favorites.includes(p.id) ? 'is-favorite' : ''}`}
                  onClick={() => toggleFavorite(p.id)}
                  title={
                    favorites.includes(p.id) ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'
                  }
                  aria-label={`Preferito: ${p.title}`}
                >
                  <Star size={12} />
                </button>
              </div>
            ))}
            {!shownProjects.length && !loading && (
              <p className="sidebar-empty">
                {favoritesOnly
                  ? 'Aggiungi un progetto ai preferiti con la stella.'
                  : 'Nessun progetto trovato.'}
              </p>
            )}
          </nav>
          <div className="sidebar-bottom">
            <button className="settings-button" onClick={() => setManagerOpen(true)}>
              <FolderKanban size={17} />
              Organizza progetti
            </button>
            <button className="settings-button" onClick={() => setSettingsOpen(true)}>
              <Settings2 size={17} />
              Impostazioni<kbd>⌘ ,</kbd>
            </button>
          </div>
        </aside>
        <main className="main">
          <header className="titlebar">
            <div className="breadcrumb">
              <Layers3 size={14} />
              <span>Workspace</span>
              <ChevronRight size={13} />
              <strong>{isDashboard ? 'Dashboard' : project?.title || 'Tutte le issue'}</strong>
            </div>
            <div className="titlebar-right">
              <button
                className="quick-search-trigger"
                onClick={() => {
                  setNotificationsOpen(false)
                  setQuickSearchOpen(true)
                }}
                aria-label="Ricerca rapida issue (⌘P)"
                title="Vai a issue · ⌘P / Ctrl+P"
              >
                <Search size={14} />
                <span>Vai a issue</span>
                <kbd>⌘ P</kbd>
              </button>
              <button
                className="icon-button notification-trigger"
                aria-label={`Notifiche, ${unreadNotifications} non lette`}
                title="Notifiche"
                onClick={() => {
                  setQuickSearchOpen(false)
                  setNotificationsOpen(true)
                }}
              >
                <Bell size={16} />
                {unreadNotifications > 0 && (
                  <span className="notification-badge">
                    {unreadNotifications > 99 ? '99+' : unreadNotifications}
                  </span>
                )}
              </button>
              <span className="sync-status" aria-live="polite">
                {syncing || discovering || activity.syncing ? 'Aggiornamento…' : ''}
              </span>
              <button
                className="icon-button"
                aria-label="Aggiorna progetti e issue"
                title={
                  syncedAt
                    ? `Aggiorna · Ultima sincronizzazione: ${localDate(new Date(syncedAt).toISOString(), true)}`
                    : 'Aggiorna progetti e issue'
                }
                disabled={loading || syncing || discovering || activity.syncing}
                onClick={() => {
                  setRefresh(Date.now())
                  void activity.refresh(true)
                }}
              >
                <RefreshCw
                  size={15}
                  className={loading || syncing || discovering || activity.syncing ? 'spin' : ''}
                />
              </button>
            </div>
          </header>
          {isDemo && (
            <div className="demo-banner">
              <span>
                <span className="demo-pill">DEMO</span>Dati di esempio
              </span>
              <button onClick={() => setSettingsOpen(true)}>
                Collega il tuo GitHub <ArrowRight size={13} />
              </button>
            </div>
          )}
          <div className="workspace-heading">
            <div>
              <h1>
                {isDashboard ? 'Dashboard generale' : project?.title || 'Tutte le issue'}
                {project && (
                  <button
                    className="icon-button rename-project"
                    title="Rinomina progetto nell’app"
                    aria-label="Rinomina progetto nell’app"
                    onClick={() => setManagerOpen(true)}
                  >
                    <Pencil size={16} />
                  </button>
                )}
              </h1>
            </div>
            {!isDashboard && (
              <button
                className="button secondary project-link"
                disabled={!project}
                onClick={() =>
                  project &&
                  void api.openExternal(project.url).catch((e) => notify(e.message, true))
                }
              >
                <Github size={16} />
                Apri progetto
                <ExternalLink size={13} />
              </button>
            )}
          </div>
          <MetricsOverview
            rows={currentMetricRows}
            onConfigure={project ? () => setMetricSettingsProject(project.id) : undefined}
          />
          {(metrics.error || activity.error) && (
            <div className="metrics-error notice error" role="alert">
              <TriangleAlert size={15} />
              <span>
                Metriche: {metrics.error || activity.error} I dati già disponibili restano visibili.
              </span>
              <button
                className="button secondary"
                disabled={activity.syncing}
                onClick={() => void activity.refresh(true)}
              >
                Riprova
              </button>
            </div>
          )}
          {warnings.length > 0 && (
            <div className="workspace-warning">
              <button onClick={() => setWarningsOpen((v) => !v)}>
                <TriangleAlert size={15} />
                {warnings.length} avvisi di accesso. Alcuni progetti potrebbero non essere visibili.
                <ChevronDown size={14} />
              </button>
              {warningsOpen && (
                <div>
                  {warnings.map((w, i) => (
                    <p key={i}>{w}</p>
                  ))}
                </div>
              )}
            </div>
          )}
          {isDashboard ? (
            <MetricsDashboard
              rows={metricRows}
              onProject={selectProject}
              onConfigure={setMetricSettingsProject}
              syncing={activity.syncing}
              onRefresh={() => void activity.refresh(true)}
            />
          ) : (
            <>
              <div className="workspace-view-controls">
                <div className="view-switch" aria-label="Vista progetto">
                  <button
                    className={viewMode === 'list' ? 'active' : ''}
                    aria-pressed={viewMode === 'list'}
                    onClick={() => {
                      updateProject(selectedProject, { view: 'list' })
                      if (!selectedIssue && filtered[0]) setSelectedIssue(filtered[0])
                    }}
                  >
                    <List size={15} />
                    Lista
                  </button>
                  <button
                    className={viewMode === 'kanban' ? 'active' : ''}
                    aria-pressed={viewMode === 'kanban'}
                    onClick={() => {
                      updateProject(selectedProject, { view: 'kanban' })
                      setSelectedIssue(null)
                    }}
                  >
                    <Columns3 size={15} />
                    Kanban
                  </button>
                </div>
                {estimates.state?.running && (
                  <span
                    className="estimate-usage"
                    role="status"
                    title={`Input: ${estimates.state.usage.inputTokens} · output: ${estimates.state.usage.outputTokens}. Il conteggio prudenziale include chiamate in corso o senza conteggio disponibile.`}
                  >
                    Analisi stime…
                  </span>
                )}
                {estimates.error && (
                  <span role="status" className="estimate-usage estimate-review">
                    Stime non disponibili: {estimates.error}
                  </span>
                )}
                {project && (
                  <button
                    className="button secondary"
                    disabled={loading}
                    onClick={() => setEstimateSettingsOpen(true)}
                  >
                    <Clock3 size={14} /> Stime progetto
                  </button>
                )}
                {project && (
                  <button
                    className="button secondary project-notifications-button"
                    disabled={loading}
                    onClick={() => setNotificationSettingsOpen(true)}
                  >
                    <Bell size={14} />
                    Notifiche progetto
                  </button>
                )}
                <button
                  className="button secondary"
                  onClick={() => setStatusManagerOpen(true)}
                  disabled={!statuses.length}
                >
                  <GripVertical size={14} />
                  Ordine stati
                </button>
              </div>
              <div className={`workspace-body ${viewMode === 'kanban' ? 'kanban-workspace' : ''}`}>
                {viewMode === 'kanban' && (
                  <section className="kanban-pane" aria-label="Issue Kanban">
                    <IssueFilters
                      searchRef={searchRef}
                      query={query}
                      onQuery={setQuery}
                      state={stateFilter}
                      onState={setStateFilter}
                      repo={repoFilter}
                      onRepo={setRepoFilter}
                      status={statusFilter}
                      onStatus={setStatusFilter}
                      includeDrafts={includeDrafts}
                      onDrafts={setIncludeDrafts}
                      sort={sort}
                      onSort={setSort}
                      repositories={repos}
                      statuses={statuses}
                      count={filtered.length}
                    />
                    {loading ? (
                      <div className="detail-loading">
                        <LoaderCircle className="spin" size={24} />
                        <p>Caricamento del Kanban…</p>
                      </div>
                    ) : error ? (
                      <div className="empty-state">
                        <TriangleAlert size={26} />
                        <p>{error}</p>
                        <button className="button secondary" onClick={() => setRefresh(Date.now())}>
                          Riprova
                        </button>
                      </div>
                    ) : (
                      <KanbanBoard
                        issues={filtered}
                        estimates={estimatesByIssue}
                        statuses={statuses}
                        activeStatus={statusFilter}
                        selected={selectedIssue?.id}
                        select={selectIssue}
                        reorder={(moving, before) =>
                          updateProject(selectedProject, {
                            statusOrder: moveBefore(
                              statuses.map((s) => s.name),
                              moving,
                              before,
                            ),
                          })
                        }
                      />
                    )}
                  </section>
                )}
                {viewMode === 'list' && (
                  <section className="issue-list-pane" aria-label="Elenco issue">
                    <IssueFilters
                      searchRef={searchRef}
                      query={query}
                      onQuery={setQuery}
                      state={stateFilter}
                      onState={setStateFilter}
                      repo={repoFilter}
                      onRepo={setRepoFilter}
                      status={statusFilter}
                      onStatus={setStatusFilter}
                      includeDrafts={includeDrafts}
                      onDrafts={setIncludeDrafts}
                      sort={sort}
                      onSort={setSort}
                      repositories={repos}
                      statuses={statuses}
                      count={filtered.length}
                    />
                    <div
                      className="issue-list"
                      role="listbox"
                      aria-label="Issue"
                      onKeyDown={(e) => {
                        if (!['ArrowDown', 'ArrowUp'].includes(e.key)) return
                        e.preventDefault()
                        const i = filtered.findIndex((x) => x.id === selectedIssue?.id)
                        const next =
                          filtered[
                            Math.max(
                              0,
                              Math.min(filtered.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)),
                            )
                          ]
                        if (next) selectIssue(next)
                      }}
                    >
                      {loading ? (
                        <div className="list-skeleton">
                          {[1, 2, 3, 4, 5].map((i) => (
                            <div key={i}>
                              <i />
                              <i />
                              <i />
                            </div>
                          ))}
                        </div>
                      ) : error ? (
                        <div className="empty-state">
                          <TriangleAlert size={28} />
                          <h3>Connessione da verificare</h3>
                          <p>{error}</p>
                          <button
                            className="button secondary"
                            onClick={() => setRefresh(Date.now())}
                          >
                            <RefreshCw size={14} />
                            Riprova
                          </button>
                          <button className="text-button" onClick={() => setSettingsOpen(true)}>
                            Apri impostazioni
                          </button>
                        </div>
                      ) : filtered.length ? (
                        filtered.map((issue) => (
                          <button
                            key={issue.id}
                            role="option"
                            aria-selected={selectedIssue?.id === issue.id}
                            className={`issue-row ${selectedIssue?.id === issue.id ? 'selected' : ''}`}
                            onClick={() => selectIssue(issue)}
                          >
                            <span className="issue-row-icon">
                              <StatusIcon issue={issue} size={17} />
                            </span>
                            <span className="issue-row-main">
                              <span className="issue-row-meta">
                                <span>
                                  {issue.repository.split('/').pop()}{' '}
                                  <span className="issue-number">#{issue.number || 'bozza'}</span>
                                </span>
                                <span>{localDate(issue.updatedAt)}</span>
                              </span>
                              <strong>{issue.title}</strong>
                              <span className="issue-row-bottom">
                                <span className={`status-dot ${stateColor(issue.status)}`} />
                                <span className="row-status">{issue.status}</span>
                                <EstimateBadge values={estimatesByIssue[issue.id]} />
                                {issue.labels.slice(0, 1).map((l) => (
                                  <span className="label" key={l.name} style={labelColors(l.color)}>
                                    {l.name}
                                  </span>
                                ))}
                                <span className="row-comments">
                                  <MessageSquare size={12} />
                                  {issue.commentCount}
                                </span>
                              </span>
                            </span>
                          </button>
                        ))
                      ) : (
                        <div className="empty-state">
                          <Search size={29} />
                          <h3>
                            {statusFilter !== 'all' && !statusFilter.length
                              ? 'Nessuno stato selezionato'
                              : issues.length
                                ? 'Nessuna corrispondenza'
                                : 'Nessuna issue qui'}
                          </h3>
                          <p>
                            {statusFilter !== 'all' && !statusFilter.length
                              ? 'Seleziona almeno uno stato nel filtro per caricare le issue.'
                              : issues.length
                                ? 'Prova un’altra ricerca o modifica i filtri.'
                                : 'Le issue accessibili del progetto compariranno qui.'}
                          </p>
                          {issues.length > 0 && (
                            <button
                              className="text-button"
                              onClick={() => {
                                setQuery('')
                                setStateFilter('all')
                                setRepoFilter('all')
                                setStatusFilter('all')
                                setIncludeDrafts(true)
                              }}
                            >
                              Azzera filtri
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="list-footer">
                      <Keyboard size={13} />
                      <span>↑ ↓ per navigare</span>
                      <span>⌘ K per cercare</span>
                    </div>
                  </section>
                )}
                {(viewMode === 'list' || displayIssue) && (
                  <section className="detail-pane" aria-label="Dettaglio issue">
                    {displayIssue ? (
                      <>
                        {navigationTarget &&
                          !filtered.some((issue) => issue.id === displayIssue.id) && (
                            <div className="navigation-context">
                              Issue aperta direttamente, fuori dai filtri della lista.
                              <button onClick={() => selectIssue(null)}>Torna alla lista</button>
                            </div>
                          )}
                        <div className="detail-topline">
                          {viewMode === 'kanban' && (
                            <button
                              className="icon-button close-board-detail"
                              aria-label="Chiudi dettaglio Kanban"
                              onClick={() => selectIssue(null)}
                            >
                              <X size={17} />
                            </button>
                          )}
                          <div>
                            <StatusIcon issue={displayIssue} size={15} />
                            <span>{displayIssue.repository}</span>
                            <span className="muted">/</span>
                            <strong>#{displayIssue.number || 'bozza'}</strong>
                          </div>
                          <button
                            className="icon-button"
                            title="Aggiorna conversazione"
                            disabled={detailLoading || !!busy}
                            onClick={() => {
                              clearImageCache()
                              setDetailRefresh((v) => v + 1)
                            }}
                          >
                            <RefreshCw size={14} className={detailLoading ? 'spin' : ''} />
                          </button>
                        </div>
                        <div className="detail-title">
                          <h2>{displayIssue.title}</h2>
                          <div className="detail-metadata">
                            <span className={`status-badge ${stateColor(displayIssue.status)}`}>
                              <span className={`status-dot ${stateColor(displayIssue.status)}`} />
                              {displayIssue.status}
                            </span>
                            <EstimateBadge values={estimatesByIssue[displayIssue.id]} />
                            {displayIssue.labels.map((l) => (
                              <span className="label" key={l.name} style={labelColors(l.color)}>
                                {l.name}
                              </span>
                            ))}
                            <span
                              className="detail-date"
                              title={`Ultimo aggiornamento: ${localDate(displayIssue.updatedAt, true)}`}
                            >
                              <Clock3 size={12} />
                              {localDate(displayIssue.updatedAt)}
                            </span>
                          </div>
                        </div>
                        <div className="detail-tabs" role="tablist">
                          <button
                            role="tab"
                            aria-selected={tab === 'conversation'}
                            className={tab === 'conversation' ? 'active' : ''}
                            onClick={() => setTab('conversation')}
                          >
                            <MessageSquare size={14} />
                            Conversazione
                            <span>{detail?.comments.length ?? displayIssue.commentCount}</span>
                          </button>
                          <button
                            role="tab"
                            aria-selected={tab === 'assets'}
                            className={tab === 'assets' ? 'active' : ''}
                            onClick={() => setTab('assets')}
                          >
                            <Paperclip size={14} />
                            Allegati
                            {detail && (
                              <span>{assets.filter((a) => a.kind !== 'link').length}</span>
                            )}
                          </button>
                          {!!estimatesByIssue[displayIssue.id]?.length && (
                            <button
                              role="tab"
                              aria-selected={tab === 'estimate'}
                              className={tab === 'estimate' ? 'active' : ''}
                              onClick={() => setTab('estimate')}
                            >
                              <Clock3 size={14} />
                              Stima
                            </button>
                          )}
                          {handoff.enabled && (
                            <button
                              role="tab"
                              aria-selected={tab === 'export'}
                              className={tab === 'export' ? 'active' : ''}
                              onClick={() => setTab('export')}
                            >
                              <FileText size={14} />
                              Export
                            </button>
                          )}
                          <button
                            className="open-github"
                            title="Apri issue su GitHub"
                            aria-label="Apri issue su GitHub"
                            disabled={!displayIssue.url}
                            onClick={() =>
                              void api
                                .openExternal(displayIssue.url)
                                .catch((e) => notify(e.message, true))
                            }
                          >
                            <ExternalLink size={14} />
                          </button>
                        </div>
                        <div
                          className="detail-content"
                          ref={contentRef}
                          role="tabpanel"
                          aria-label={
                            tab === 'conversation'
                              ? 'Conversazione'
                              : tab === 'assets'
                                ? 'Allegati'
                                : tab === 'estimate'
                                  ? 'Stima'
                                  : 'Anteprima export'
                          }
                          key={displayIssue.id + tab}
                        >
                          {tab === 'estimate' && (
                            <IssueEstimatePanel
                              expanded
                              values={estimatesByIssue[displayIssue.id] ?? []}
                              projects={navigationProjects}
                              api={api}
                              running={estimates.state?.running ?? false}
                              notify={notify}
                              openSource={(id) => {
                                setTab('conversation')
                                setTimeout(() => {
                                  if (!revealConversationSource(id))
                                    notify(
                                      'La fonte non è più presente. Aggiorna la conversazione e ricalcola la stima.',
                                      true,
                                    )
                                }, 0)
                              }}
                            />
                          )}

                          {detailLoading ? (
                            <div className="detail-loading">
                              <LoaderCircle className="spin" size={23} />
                              <p>Recupero descrizione e tutti i commenti…</p>
                            </div>
                          ) : detailError ? (
                            <div className="empty-state">
                              <TriangleAlert size={27} />
                              <h3>Conversazione non disponibile</h3>
                              <p>{detailError}</p>
                              <button
                                className="button secondary"
                                onClick={() => setDetailRefresh((v) => v + 1)}
                              >
                                Riprova
                              </button>
                            </div>
                          ) : detail && tab === 'conversation' ? (
                            <Conversation
                              issue={detail}
                              api={api}
                              notify={notify}
                              open={openImage}
                            />
                          ) : detail && tab === 'assets' ? (
                            <div className="attachments-view">
                              <div className="tab-intro">
                                <span className="feature-icon">
                                  <Paperclip size={22} />
                                </span>
                                <h3>Allegati</h3>
                                <p>
                                  Immagini e file da descrizione e commenti, con i link originali.
                                </p>
                              </div>
                              {assets
                                .filter((a) => a.kind === 'image')
                                .map((a) => (
                                  <div className="attachment-card" key={a.id}>
                                    <div className="attachment-header">
                                      <span className="asset-id">{a.id}</span>
                                      <strong>{a.label}</strong>
                                      <span>{a.sources.join(', ')}</span>
                                    </div>
                                    <AssetImage
                                      src={a.url}
                                      alt={a.label}
                                      api={api}
                                      notify={notify}
                                      open={openImage}
                                    />
                                    <button
                                      className="attachment-url"
                                      onClick={() =>
                                        void api
                                          .openExternal(a.url)
                                          .catch((e) => notify(e.message, true))
                                      }
                                    >
                                      <Link2 size={12} />
                                      <span>{a.url}</span>
                                      <ExternalLink size={12} />
                                    </button>
                                  </div>
                                ))}
                              {assets
                                .filter((a) => a.kind === 'file')
                                .map((a) => (
                                  <div className="file-card" key={a.id}>
                                    <span className="file-icon">
                                      <FileArchive size={21} />
                                    </span>
                                    <div>
                                      <strong>{a.label}</strong>
                                      <span>
                                        {a.id} · {a.sources.join(', ')}
                                      </span>
                                    </div>
                                    <button
                                      className="icon-button"
                                      title="Apri file originale"
                                      onClick={() =>
                                        void api
                                          .openExternal(a.url)
                                          .catch((e) => notify(e.message, true))
                                      }
                                    >
                                      <ExternalLink size={15} />
                                    </button>
                                  </div>
                                ))}
                              {!assets.some((a) => a.kind !== 'link') && (
                                <div className="empty-state compact">
                                  <Paperclip size={24} />
                                  <p>Nessuna immagine o file rilevato.</p>
                                </div>
                              )}
                              <div className="manual-links">
                                <h4>
                                  <TriangleAlert size={15} />
                                  Da verificare manualmente{' '}
                                  <span>{assets.filter((a) => a.kind === 'link').length}</span>
                                </h4>
                                <p>Il contenuto di questi link non viene estratto.</p>
                                {assets
                                  .filter((a) => a.kind === 'link')
                                  .map((a) => (
                                    <button
                                      key={a.id}
                                      onClick={() =>
                                        void api
                                          .openExternal(a.url)
                                          .catch((e) => notify(e.message, true))
                                      }
                                    >
                                      <Link2 size={14} />
                                      <span>
                                        <strong>{a.label}</strong>
                                        <span>{a.url}</span>
                                      </span>
                                      <ExternalLink size={13} />
                                    </button>
                                  ))}
                              </div>
                            </div>
                          ) : detail && tab === 'export' ? (
                            <IssueExportView
                              issue={detail}
                              busy={busy}
                              copy={() => void copy()}
                              exportZip={() => void exportZip()}
                              copyReference={() => void copyReference()}
                            />
                          ) : null}
                        </div>
                        <IssueExportBar
                          issue={detail}
                          busy={busy}
                          copy={() => void copy()}
                          exportZip={() => void exportZip()}
                          copyReference={() => void copyReference()}
                        />
                      </>
                    ) : (
                      <div className="detail-welcome">
                        <Logo />
                        <h2>Seleziona un’issue</h2>
                        <p>
                          {loading
                            ? 'Sto caricando i tuoi progetti…'
                            : 'Seleziona un’issue per leggere descrizione, commenti e allegati.'}
                        </p>
                      </div>
                    )}
                  </section>
                )}
              </div>
            </>
          )}
        </main>
        {metricSettingsRow && (
          <MetricSettings
            key={metricSettingsRow.project.id}
            row={metricSettingsRow}
            close={() => setMetricSettingsProject(null)}
            save={(metricMapping) => {
              updateProject(metricSettingsRow.project.id, { metricMapping })
              setMetricSettingsProject(null)
              notify('Metriche salvate. Dashboard aggiornata.')
            }}
          />
        )}
        {quickSearchOpen && (
          <QuickIssueSearch
            api={api}
            projects={navigationProjects}
            openIssue={openIssueLocation}
            onClose={() => setQuickSearchOpen(false)}
            onActivityChange={activity.reload}
            indexVersion={activity.lastCheckedAt}
          />
        )}
        {notificationsOpen && (
          <NotificationCenter
            items={activityItems}
            projects={navigationProjects}
            lastCheckedAt={activity.lastCheckedAt}
            syncing={activity.syncing}
            error={activity.error}
            onRefresh={() => void activity.refresh(true)}
            onRead={(ids) => void activity.markRead(ids)}
            onOpen={openIssueLocation}
            onClose={() => setNotificationsOpen(false)}
          />
        )}
        {managerOpen && (
          <ProjectManager
            projects={orderedProjects}
            preferences={preferences}
            updateProject={updateProject}
            reorder={(projectOrder) =>
              updatePreferences((current) => ({ ...current, projectOrder }))
            }
            close={() => setManagerOpen(false)}
          />
        )}
        {notificationSettingsOpen && project && (
          <ProjectNotificationSettings
            key={project.id}
            api={api}
            project={project}
            statuses={statuses}
            close={() => setNotificationSettingsOpen(false)}
            saved={() => notify('Preferenze notifiche salvate per questo progetto.')}
          />
        )}
        {estimateSettingsOpen && project && (
          <ProjectEstimateSettingsModal
            key={project.id}
            api={api}
            project={project}
            statuses={statuses}
            close={() => setEstimateSettingsOpen(false)}
            saved={() => {
              notify('Monitoraggio stime salvato per questo progetto.')
              void activity.refresh(true)
            }}
          />
        )}
        {statusManagerOpen && (
          <StatusManager
            statuses={statuses}
            custom={Boolean(projectPreferences.statusOrder)}
            reorder={(statusOrder) => updateProject(selectedProject, { statusOrder })}
            close={() => setStatusManagerOpen(false)}
          />
        )}
        {settingsOpen && settings && (
          <SettingsModal
            initial={settings}
            onClose={() => setSettingsOpen(false)}
            onSave={(next) => {
              clearImageCache()
              cache.current.clear()
              setProjects([])
              setSelectedProject('')
              setIssues([])
              setSelectedIssue(null)
              setSettings(next)
              setSettingsOpen(false)
            }}
            notify={notify}
            onAISaved={() => {
              void activity.refresh(true)
            }}
          />
        )}
        {lightbox && (
          <div
            className="lightbox"
            role="dialog"
            aria-modal="true"
            aria-label={lightbox.alt}
            onClick={() => setLightbox(null)}
          >
            <button
              className="icon-button"
              onClick={() => setLightbox(null)}
              aria-label="Chiudi immagine"
            >
              <X size={23} />
            </button>
            <img src={lightbox.src} alt={lightbox.alt} onClick={(e) => e.stopPropagation()} />
            <p>{lightbox.alt}</p>
          </div>
        )}
        {toast && (
          <div
            className={`toast ${toast.error ? 'error' : ''}`}
            role={toast.error ? 'alert' : 'status'}
          >
            {toast.error ? <TriangleAlert size={17} /> : <CheckCheck size={17} />}
            <span>{toast.text}</span>
            <button onClick={() => setToast(null)} aria-label="Chiudi notifica">
              <X size={14} />
            </button>
          </div>
        )}
      </div>
    </HandoffContext.Provider>
  )
}
