import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  session,
  shell,
} from 'electron'
import { readFile, writeFile, rename, unlink, mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { GitHubClient, normalizeHost } from './github'
import { IssueCache } from './issue-cache'
import { ActivityService } from './activity'
import { AIConfig, validateAISettings } from './ai-config'
import { EstimateService } from './estimates'
import { OpenAIClient } from './openai'
import type { AISettingsInput, ProjectEstimateSettings } from '../src/shared/estimates'
import type { ProjectNotificationPreferences } from '../src/shared/activity'
import { EmailConfig } from './email-config'
import { EmailDispatcher, verifySmtp, sendTestEmail } from './email'
import { MAX_MAIL_IMAGE_BYTES } from './email-message'
import { emptyEmailStatus, type EmailSettingsInput } from '../src/shared/email'
import { issueScope } from '../src/shared/loading'
import { createExport, downloadAsset, safeFilename } from './assets'
import { nativeAssetFetch } from './network'
import { issueMarkdown } from '../src/shared/export'
import { disabledHandoff, type HandoffStatus } from '../src/shared/handoff'
import { loadHandoffConfig } from './handoff-config'
import { HandoffStore, startHandoffServer } from './handoff'
import type { Settings, SettingsInput, Issue, IssueDetail } from '../src/shared/types'

const here = dirname(fileURLToPath(import.meta.url))
const defaults: Settings = {
  host: 'https://github.servizi.allitude.it',
  organizations: ['corebanking'],
  projectUrls: ['https://github.servizi.allitude.it/orgs/corebanking/projects/59/views/1'],
  hasToken: false,
  assetHosts: [],
}
let window: BrowserWindow
let config: Settings = { ...defaults }
let encryptedToken: string | undefined
let token = ''
let githubClient: GitHubClient | undefined
let issueCache: Promise<IssueCache> | undefined
let activityService: ActivityService | undefined
let aiConfig: AIConfig
let estimateService: Promise<EstimateService> | undefined
let emailConfig: EmailConfig
let emailDispatcher: EmailDispatcher | undefined
let handoffStatus: HandoffStatus = disabledHandoff
let handoffStore: HandoffStore | undefined
let handoffServer: Awaited<ReturnType<typeof startHandoffServer>> | undefined
const issueRequests = new Map<string, Promise<Issue[]>>()
const configPath = () => join(app.getPath('userData'), 'connection.json')

async function loadConfig() {
  try {
    const stored = JSON.parse(await readFile(configPath(), 'utf8'))
    config = {
      host: normalizeHost(stored.host),
      organizations: stored.organizations ?? [],
      projectUrls: stored.projectUrls ?? [],
      hasToken: !!stored.encryptedToken,
      assetHosts: stored.assetHosts ?? [],
    }
    encryptedToken = stored.encryptedToken
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      dialog.showErrorBox(
        'Impostazioni non disponibili',
        'Non è stato possibile leggere le impostazioni salvate. Configura nuovamente la connessione.',
      )
  }
}
async function getToken() {
  if (token) return token
  if (!encryptedToken) return ''
  try {
    const result = await safeStorage.decryptStringAsync(Buffer.from(encryptedToken, 'base64'))
    token = result.result
    return token
  } catch {
    throw new Error(
      'Impossibile leggere il token dal Portachiavi. Reinseriscilo nelle impostazioni.',
    )
  }
}
async function client() {
  const value = await getToken()
  if (!value) throw new Error('Configura il token nelle impostazioni per collegare GitHub.')
  return (githubClient ??= new GitHubClient(config, value))
}
async function cache() {
  if (!issueCache) {
    issueCache = (async () => {
      const value = await getToken()
      const scope = createHash('sha256').update(`${config.host}\n${value}`).digest('hex')
      const store = new IssueCache(join(app.getPath('userData'), 'issue-cache.json'), scope)
      await store.load()
      await store.configureEmail(emailConfig.target())
      return store
    })()
  }
  return issueCache
}
async function resetConnection() {
  await handoffStore?.clear()
  if (estimateService) await (await estimateService).clear()
  else
    await unlink(join(app.getPath('userData'), 'estimates.json')).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      },
    )
  estimateService = undefined
  emailDispatcher?.stop()
  emailDispatcher = undefined
  if (issueCache) await (await issueCache).clear()
  else
    await unlink(join(app.getPath('userData'), 'issue-cache.json')).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      },
    )
  issueCache = undefined
  githubClient = undefined
  activityService = undefined
  issueRequests.clear()
}
async function activity() {
  const [github, store] = await Promise.all([client(), cache()])
  return (activityService ??= new ActivityService(github, store, flushEmail))
}
function estimatesChanged() {
  if (window && !window.isDestroyed()) window.webContents.send('estimates:changed')
}
async function estimates() {
  if (!estimateService)
    estimateService = (async () => {
      const [github, value] = await Promise.all([client(), getToken()])
      const scope = createHash('sha256').update(`${config.host}\n${value}`).digest('hex')
      const service = new EstimateService(
        join(app.getPath('userData'), 'estimates.json'),
        scope,
        aiConfig,
        (issue, baseline, fresh) =>
          baseline ? github.estimateDelta(issue, baseline) : github.issue(issue, fresh),
        new OpenAIClient(),
        estimatesChanged,
      )
      await service.load()
      return service
    })()
  return estimateService
}
async function monitorEstimates(projectIds: string[]) {
  if (!config.hasToken) return
  const [store, service] = await Promise.all([cache(), estimates()])
  await service.sync(
    projectIds.flatMap((projectId) =>
      store.activityIssues(projectId).map((issue) => ({ projectId, issue })),
    ),
  )
}
async function mail() {
  const [github, store] = await Promise.all([client(), cache()])
  return (emailDispatcher ??= new EmailDispatcher(
    store,
    emailConfig,
    (notification) => github.notificationContent(notification),
    async (url) =>
      downloadAsset(
        url,
        config.host,
        await getToken(),
        config.assetHosts,
        nativeAssetFetch,
        MAX_MAIL_IMAGE_BYTES,
      ),
  ))
}
function flushEmail() {
  if (!emailConfig.target() || !config.hasToken) return
  void mail()
    .then((dispatcher) => dispatcher.kick())
    .catch(() => {})
}
async function activityProjects(projectIds: string[]) {
  const ids = new Set(Array.isArray(projectIds) ? projectIds : [])
  return (
    (await cache()).getWorkspace()?.workspace.projects.filter((project) => ids.has(project.id)) ??
    []
  )
}
function validateInput(value: SettingsInput): SettingsInput {
  const host = normalizeHost(value.host)
  if (!Array.isArray(value.organizations) || !Array.isArray(value.projectUrls))
    throw new Error('Impostazioni non valide.')
  const organizations = [...new Set(value.organizations.map((o) => o.trim()).filter(Boolean))]
  if (organizations.some((o) => !/^[a-z\d-]+$/i.test(o)))
    throw new Error('Nome organizzazione non valido.')
  const projectUrls = value.projectUrls.map((p) => {
    const url = new URL(p.trim())
    if (url.origin !== host || !/^\/(orgs|users)\/[^/]+\/projects\/\d+(?:\/|$)/.test(url.pathname))
      throw new Error(
        'Ogni URL progetto deve appartenere all’istanza configurata ed essere un Project v2.',
      )
    return url.href
  })
  const assetHosts = [
    ...new Set(
      (value.assetHosts ?? []).map((value) => {
        const url = new URL(value.includes('://') ? value.trim() : `https://${value.trim()}`)
        if (url.protocol !== 'https:' || url.username || url.password)
          throw new Error(
            'Gli host degli allegati devono essere indirizzi HTTPS senza credenziali.',
          )
        return url.origin
      }),
    ),
  ]
  return { host, organizations, projectUrls, assetHosts, token: value.token?.trim() }
}
async function tokenFor(input: SettingsInput) {
  if (input.token) return input.token
  if (input.host !== config.host)
    throw new Error('Inserisci un nuovo token quando cambi istanza GitHub.')
  const value = await getToken()
  if (!value) throw new Error('Inserisci un token di accesso.')
  return value
}
function handle(channel: string, callback: (...args: any[]) => any) {
  ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
      throw new Error('Richiesta non autorizzata.')
    return callback(...args)
  })
}

function requireHandoff() {
  if (!handoffStatus.enabled)
    throw new Error(
      'Copia ed export disattivati. Imposta ISSUE_ATLAS_HANDOFF_ENABLED=true nel file .env e riavvia l’app.',
    )
}

async function createWindow() {
  window = new BrowserWindow({
    width: 1512,
    height: 980,
    minWidth: 1080,
    minHeight: 700,
    title: 'Issue Atlas',
    backgroundColor: '#f8f9fc',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 20 },
    show: false,
    webPreferences: {
      preload: join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  )
  session.defaultSession.setPermissionCheckHandler(() => false)
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (!app.isPackaged && devUrl === 'http://127.0.0.1:5173') await window.loadURL(devUrl)
  else await window.loadFile(join(here, '../dist/index.html'))
}

app
  .whenReady()
  .then(async () => {
    app.setAccessibilitySupportEnabled(true)
    await loadConfig()
    aiConfig = new AIConfig(join(app.getPath('userData'), 'openai.json'), {
      encrypt: async (value) => {
        if (!(await safeStorage.isAsyncEncryptionAvailable()))
          throw new Error(
            'Portachiavi non disponibile. La chiave OpenAI non verrà salvata in chiaro.',
          )
        return (await safeStorage.encryptStringAsync(value)).toString('base64')
      },
      decrypt: async (value) => {
        try {
          return (await safeStorage.decryptStringAsync(Buffer.from(value, 'base64'))).result
        } catch {
          throw new Error(
            'Impossibile leggere la chiave OpenAI dal Portachiavi. Reinseriscila nelle impostazioni.',
          )
        }
      },
    })
    await aiConfig
      .load()
      .catch((error) => dialog.showErrorBox('OpenAI non disponibile', error.message))
    handle('ai:settings', () => aiConfig.settings())
    handle('ai:save', async (input: AISettingsInput) => {
      const result = await aiConfig.save(input)
      estimatesChanged()
      return result
    })
    handle('ai:models', async (input?: AISettingsInput) => {
      if (input) validateAISettings(input)
      return new OpenAIClient().models(await aiConfig.credentials(input))
    })
    handle('estimates:project', async (id: string) => (await estimates()).settings(id))
    handle('estimates:save-project', async (id: string, value: ProjectEstimateSettings) =>
      (await estimates()).saveSettings(id, value),
    )
    handle('estimates:get', async (ids: string[]) => (await estimates()).state(ids))
    handle('estimates:recalculate', async (projectId: string, issueId: string) =>
      (await estimates()).recalculate(projectId, issueId),
    )
    emailConfig = new EmailConfig(join(app.getPath('userData'), 'email.json'), {
      encrypt: async (value) => {
        if (!(await safeStorage.isAsyncEncryptionAvailable()))
          throw new Error(
            'Portachiavi non disponibile. La password SMTP non verrà salvata in chiaro.',
          )
        return (await safeStorage.encryptStringAsync(value)).toString('base64')
      },
      decrypt: async (value) => {
        try {
          return (await safeStorage.decryptStringAsync(Buffer.from(value, 'base64'))).result
        } catch {
          throw new Error(
            'Impossibile leggere la password SMTP dal Portachiavi. Reinseriscila nelle impostazioni.',
          )
        }
      },
    })
    await emailConfig
      .load()
      .catch((error) => dialog.showErrorBox('Email non disponibili', error.message))
    const emailTimer = setInterval(flushEmail, 60_000)
    emailTimer.unref()
    app.on('before-quit', () => {
      clearInterval(emailTimer)
      emailDispatcher?.stop()
      void estimateService?.then((service) => service.stop())
    })
    handle('email:settings', () => emailConfig.settings())
    handle('email:save', async (input: EmailSettingsInput) => {
      const settings = await emailConfig.save(input)
      emailDispatcher?.stop()
      emailDispatcher = undefined
      if (issueCache) await (await issueCache).configureEmail(emailConfig.target())
      return settings
    })
    handle('email:verify', (input: EmailSettingsInput) => verifySmtp(emailConfig, input))
    handle('email:test', (input: EmailSettingsInput) => sendTestEmail(emailConfig, input))
    handle('email:status', async () =>
      config.hasToken ? (await cache()).emailStatus(emailConfig.revision()) : emptyEmailStatus(),
    )
    handle('email:retry', async (includeUncertain?: boolean) => {
      if (!config.hasToken || !emailConfig.target())
        throw new Error(
          'Attiva la ricezione via mail e collega GitHub prima di riprovare gli invii.',
        )
      await (await cache()).retryEmail(emailConfig.revision(), includeUncertain === true)
      emailDispatcher?.stop()
      emailDispatcher = undefined
      flushEmail()
    })
    handle('settings:get', () => config)
    handle('settings:test', async (value: SettingsInput) => {
      const input = validateInput(value)
      return new GitHubClient(input, await tokenFor(input)).testConnection()
    })
    handle('settings:save', async (value: SettingsInput) => {
      const input = validateInput(value)
      const nextToken = await tokenFor(input)
      await new GitHubClient(input, nextToken).testConnection()
      if (!(await safeStorage.isAsyncEncryptionAvailable()))
        throw new Error('Portachiavi non disponibile. Il token non verrà salvato in chiaro.')
      const cipher = (await safeStorage.encryptStringAsync(nextToken)).toString('base64')
      const stored = {
        host: input.host,
        organizations: input.organizations,
        projectUrls: input.projectUrls,
        encryptedToken: cipher,
        assetHosts: input.assetHosts,
      }
      await writeFile(`${configPath()}.tmp`, JSON.stringify(stored, null, 2), { mode: 0o600 })
      await rename(`${configPath()}.tmp`, configPath())
      await resetConnection()
      config = {
        host: stored.host,
        organizations: stored.organizations,
        projectUrls: stored.projectUrls,
        hasToken: true,
        assetHosts: stored.assetHosts,
      }
      token = nextToken
      encryptedToken = cipher
      return config
    })
    handle('settings:disconnect', async () => {
      await unlink(configPath()).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'ENOENT') throw e
      })
      await resetConnection()
      token = ''
      encryptedToken = undefined
      config = { ...defaults }
    })
    handle('github:cached-workspace', async () => (await cache()).getWorkspace())
    handle('github:projects', async () => {
      const [github, store] = await Promise.all([client(), cache()])
      const workspace = await github.projects()
      await store.saveWorkspace(workspace)
      return workspace
    })
    handle('github:layout', async (id: string) => {
      const [github, store] = await Promise.all([client(), cache()])
      const layout = await github.projectLayout(id)
      store.setLayout(id, layout)
      return layout
    })
    handle('github:cached-project', async (id: string, statuses?: string[]) =>
      (await cache()).get(id, statuses),
    )
    handle('github:issues', async (id: string, fieldName?: string, statuses?: string[]) => {
      const key = issueScope(id, statuses)
      const existing = issueRequests.get(key)
      if (existing) return existing
      const request = (async () => {
        const [github, store] = await Promise.all([client(), cache()])
        const issues = await github.issues(id, fieldName, statuses, store.previous(id))
        await store.save(id, statuses, issues)
        return issues
      })()
      issueRequests.set(key, request)
      try {
        return await request
      } finally {
        if (issueRequests.get(key) === request) issueRequests.delete(key)
      }
    })
    handle('github:issue', async (issue: Issue) => (await client()).issue(issue, true))
    handle('github:find-issues', async (number: number, projectIds: string[]) =>
      (await activity()).find(number, await activityProjects(projectIds)),
    )
    handle('activity:get', async () => (await cache()).notifications())
    handle('metrics:projects', async (projectIds: string[]) => {
      const projects = await activityProjects(projectIds)
      return (await cache()).projectMetrics(projects.map((project) => project.id))
    })
    handle('activity:preferences', async (projectId: string) =>
      (await cache()).getNotificationPreferences(projectId),
    )
    handle(
      'activity:save-preferences',
      async (projectId: string, preferences: ProjectNotificationPreferences) =>
        (await cache()).setNotificationPreferences(projectId, preferences),
    )
    handle('activity:sync', async (projectIds: string[], force?: boolean) => {
      const projects = await activityProjects(projectIds)
      const result = await (await activity()).sync(projects, force === true)
      void monitorEstimates(projects.map((project) => project.id)).catch(() => estimatesChanged())
      return result
    })
    handle('activity:read', async (ids: string[]) => (await cache()).markNotificationsRead(ids))
    const download = async (url: string, signal?: AbortSignal) => {
      if (!config.hasToken && url === 'https://demo.issueatlas.local/assets/dashboard.png') {
        return {
          bytes: new Uint8Array(
            await readFile(
              join(
                here,
                process.env.VITE_DEV_SERVER_URL
                  ? '../public/demo-dashboard.png'
                  : '../dist/demo-dashboard.png',
              ),
            ),
          ),
          mime: 'image/png',
          filename: 'dashboard.png',
        }
      }
      if (!config.hasToken && url === 'https://demo.issueatlas.local/assets/request.log') {
        return {
          bytes: new TextEncoder().encode(
            'DEMO — POST /transfers 201 Created\nCache account-balance: stale\n',
          ),
          mime: 'text/plain',
          filename: 'request.log',
        }
      }
      return downloadAsset(
        url,
        config.host,
        await getToken(),
        config.assetHosts,
        nativeAssetFetch,
        undefined,
        signal,
      )
    }
    const handoffOptions = await loadHandoffConfig(
      join(app.isPackaged ? app.getPath('userData') : app.getAppPath(), '.env'),
    ).catch((error) => {
      handoffStatus = { enabled: false, error: error.message }
      return { enabled: false, port: 0 }
    })
    if (handoffOptions.enabled) {
      handoffStatus = { enabled: true }
      let root: string | undefined
      try {
        root = await mkdtemp(join(app.getPath('temp'), 'issue-atlas-handoff-'))
        handoffStore = new HandoffStore(root, download)
        handoffServer = await startHandoffServer(handoffStore, handoffOptions.port)
        handoffStatus.mcpUrl = handoffServer.url
      } catch (error) {
        handoffStatus.error = `MCP locale non disponibile: ${(error as Error).message}. Controlla ISSUE_ATLAS_MCP_PORT e riavvia l’app.`
        handoffStore = undefined
        if (root) await rm(root, { recursive: true, force: true })
      }
      let closing = false
      app.on('before-quit', (event) => {
        if (closing || !handoffServer) return
        event.preventDefault()
        closing = true
        void handoffServer
          .close()
          .then(async () => {
            if (root) await rm(root, { recursive: true, force: true })
          })
          .catch(() => {})
          .finally(() => app.quit())
      })
    }
    handle('handoff:status', () => handoffStatus)
    handle('handoff:copy', async (issue: IssueDetail) => {
      requireHandoff()
      if (!handoffStore || !handoffStatus.mcpUrl)
        throw new Error(handoffStatus.error || 'MCP locale non disponibile.')
      clipboard.writeText(await handoffStore.publish(issue, handoffStatus.mcpUrl))
    })
    handle('asset:get', async (url: string) => {
      const asset = await download(url)
      if (!asset.mime.startsWith('image/'))
        throw new Error('Questo allegato non è un’immagine. Aprilo nel browser o usa lo ZIP.')
      return {
        dataUrl: `data:${asset.mime};base64,${Buffer.from(asset.bytes).toString('base64')}`,
        mime: asset.mime,
      }
    })
    handle('asset:copy', async (url: string) => {
      requireHandoff()
      const asset = await download(url)
      if (!asset.mime.startsWith('image/')) throw new Error('Il link non restituisce un’immagine.')
      const image = nativeImage.createFromBuffer(Buffer.from(asset.bytes))
      if (image.isEmpty())
        throw new Error('Formato non copiabile. Usa il file incluso nell’export ZIP.')
      clipboard.writeImage(image)
    })
    handle('export:copy', (issue: IssueDetail) => {
      requireHandoff()
      clipboard.writeText(issueMarkdown(issue))
    })
    handle('export:zip', async (issue: IssueDetail) => {
      requireHandoff()
      issueMarkdown(issue)
      const { canceled, filePath } = await dialog.showSaveDialog(window, {
        title: 'Esporta issue',
        defaultPath: `${safeFilename(issue.repository.split('/').pop() || 'issue')}-${issue.number || 'bozza'}.zip`,
        filters: [{ name: 'Archivio ZIP', extensions: ['zip'] }],
      })
      if (canceled || !filePath) return { canceled: true, downloaded: 0, manual: 0 }
      const result = await createExport(issue, download)
      await writeFile(filePath, result.bytes, { mode: 0o600 })
      return {
        canceled: false,
        path: filePath,
        downloaded: result.downloaded,
        manual: result.manual,
      }
    })
    handle('external:open', async (value: string) => {
      const url = new URL(value)
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
        throw new Error('Puoi aprire solo link HTTP o HTTPS senza credenziali.')
      await shell.openExternal(url.href)
    })
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            {
              label: 'Impostazioni…',
              accelerator: 'CmdOrCtrl+,',
              click: () => window.webContents.send('app:settings'),
            },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { type: 'separator' },
            { role: 'quit' },
          ],
        },
        { role: 'editMenu' },
        {
          label: 'Naviga',
          submenu: [
            {
              label: 'Vai a issue…',
              accelerator: 'CmdOrCtrl+P',
              click: () => window.webContents.send('app:quick-search'),
            },
          ],
        },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
      ]),
    )
    await createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow()
    })
  })
  .catch((error) => dialog.showErrorBox('Impossibile avviare Issue Atlas', error.message))
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
