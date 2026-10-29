import { contextBridge, ipcRenderer } from 'electron'
import type { AtlasAPI } from '../src/shared/types'

const api: AtlasAPI = {
  monitoringSettings: () => ipcRenderer.invoke('monitoring:settings'),
  saveMonitoringSettings: (input) => ipcRenderer.invoke('monitoring:save', input),
  verifyMonitoring: (input) => ipcRenderer.invoke('monitoring:verify', input),
  monitoringStatus: () => ipcRenderer.invoke('monitoring:status'),
  retryMonitoring: () => ipcRenderer.invoke('monitoring:retry'),
  handoffStatus: () => ipcRenderer.invoke('handoff:status'),
  copyHandoff: (issue) => ipcRenderer.invoke('handoff:copy', issue),
  onEstimates: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('estimates:changed', listener)
    return () => ipcRenderer.removeListener('estimates:changed', listener)
  },
  aiSettings: () => ipcRenderer.invoke('ai:settings'),
  saveAISettings: (input) => ipcRenderer.invoke('ai:save', input),
  aiModels: (input) => ipcRenderer.invoke('ai:models', input),
  projectEstimates: (id) => ipcRenderer.invoke('estimates:project', id),
  saveProjectEstimates: (id, settings) =>
    ipcRenderer.invoke('estimates:save-project', id, settings),
  estimates: (ids) => ipcRenderer.invoke('estimates:get', ids),
  recalculateEstimate: (projectId, issueId) =>
    ipcRenderer.invoke('estimates:recalculate', projectId, issueId),
  onQuickSearch: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('app:quick-search', listener)
    return () => ipcRenderer.removeListener('app:quick-search', listener)
  },
  onSettings: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('app:settings', listener)
    return () => ipcRenderer.removeListener('app:settings', listener)
  },
  settings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (input) => ipcRenderer.invoke('settings:save', input),
  disconnect: () => ipcRenderer.invoke('settings:disconnect'),
  testConnection: (input) => ipcRenderer.invoke('settings:test', input),
  projects: () => ipcRenderer.invoke('github:projects'),
  cachedWorkspace: () => ipcRenderer.invoke('github:cached-workspace'),
  projectLayout: (id) => ipcRenderer.invoke('github:layout', id),
  cachedProject: (id, statuses) => ipcRenderer.invoke('github:cached-project', id, statuses),
  issues: (id, fieldName, statuses) => ipcRenderer.invoke('github:issues', id, fieldName, statuses),
  issue: (issue) => ipcRenderer.invoke('github:issue', issue),
  findIssues: (number, projectIds) => ipcRenderer.invoke('github:find-issues', number, projectIds),
  notifications: () => ipcRenderer.invoke('activity:get'),
  onNotificationsChanged: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('activity:changed', listener)
    return () => ipcRenderer.removeListener('activity:changed', listener)
  },
  onNotificationOpen: (callback) => {
    let active = true
    let handling = false
    const listener = () => {
      if (handling) return
      handling = true
      void (async () => {
        while (active) {
          const item = await ipcRenderer.invoke('activity:pending-open')
          if (!active || !item) return
          callback({ projectId: item.projectId, issue: item.issue })
          await ipcRenderer.invoke('activity:opened', item.id)
        }
      })()
        .catch(() => {})
        .finally(() => {
          handling = false
        })
    }
    ipcRenderer.on('activity:open', listener)
    listener()
    return () => {
      active = false
      ipcRenderer.removeListener('activity:open', listener)
    }
  },
  projectMetrics: (projectIds) => ipcRenderer.invoke('metrics:projects', projectIds),
  notificationPreferences: (projectId) => ipcRenderer.invoke('activity:preferences', projectId),
  saveNotificationPreferences: (projectId, preferences) =>
    ipcRenderer.invoke('activity:save-preferences', projectId, preferences),
  syncActivity: (projectIds, force) => ipcRenderer.invoke('activity:sync', projectIds, force),
  markNotificationsRead: (ids) => ipcRenderer.invoke('activity:read', ids),
  grokHistory: () => ipcRenderer.invoke('grok:history'),
  grokSettings: () => ipcRenderer.invoke('grok:settings'),
  saveGrokSettings: (input) => ipcRenderer.invoke('grok:save', input),
  verifyGrok: (input) => ipcRenderer.invoke('grok:verify', input),
  testGrok: (input) => ipcRenderer.invoke('grok:test', input),
  grokStatus: () => ipcRenderer.invoke('grok:status'),
  retryGrok: (includeUncertain) => ipcRenderer.invoke('grok:retry', includeUncertain),
  asset: (url) => ipcRenderer.invoke('asset:get', url),
  copyImage: (url) => ipcRenderer.invoke('asset:copy', url),
  copyIssue: (issue) => ipcRenderer.invoke('export:copy', issue),
  exportIssue: (issue) => ipcRenderer.invoke('export:zip', issue),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
}
contextBridge.exposeInMainWorld('atlas', api)
