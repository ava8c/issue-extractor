import { contextBridge, ipcRenderer } from 'electron'
import type { AtlasAPI } from '../src/shared/types'

const api: AtlasAPI = {
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
  projectMetrics: (projectIds) => ipcRenderer.invoke('metrics:projects', projectIds),
  notificationPreferences: (projectId) => ipcRenderer.invoke('activity:preferences', projectId),
  saveNotificationPreferences: (projectId, preferences) =>
    ipcRenderer.invoke('activity:save-preferences', projectId, preferences),
  syncActivity: (projectIds, force) => ipcRenderer.invoke('activity:sync', projectIds, force),
  markNotificationsRead: (ids) => ipcRenderer.invoke('activity:read', ids),
  emailSettings: () => ipcRenderer.invoke('email:settings'),
  saveEmailSettings: (input) => ipcRenderer.invoke('email:save', input),
  verifyEmail: (input) => ipcRenderer.invoke('email:verify', input),
  testEmail: (input) => ipcRenderer.invoke('email:test', input),
  emailStatus: () => ipcRenderer.invoke('email:status'),
  retryEmail: (includeUncertain) => ipcRenderer.invoke('email:retry', includeUncertain),
  asset: (url) => ipcRenderer.invoke('asset:get', url),
  copyImage: (url) => ipcRenderer.invoke('asset:copy', url),
  copyIssue: (issue) => ipcRenderer.invoke('export:copy', issue),
  exportIssue: (issue) => ipcRenderer.invoke('export:zip', issue),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
}
contextBridge.exposeInMainWorld('atlas', api)
