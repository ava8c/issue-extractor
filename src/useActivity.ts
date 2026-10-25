import { useCallback, useEffect, useRef, useState } from 'react'
import type { AtlasAPI, NotificationState } from './shared/types'
import { ACTIVITY_INTERVAL } from './shared/activity'
import { errorMessage } from './shared/errors'

const empty: NotificationState = { items: [], lastCheckedAt: null }

export function useActivity(
  api: AtlasAPI,
  projectKey: string,
  enabled: boolean,
  connection: object | null,
) {
  const [state, setState] = useState<NotificationState>(empty)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')
  const epoch = useRef(0)
  const pending = useRef<Promise<void> | null>(null)
  useEffect(() => {
    epoch.current++
    pending.current = null
    setState(empty)
    setError('')
    setSyncing(false)
    return () => {
      epoch.current++
    }
  }, [api, connection])
  const reload = useCallback(async () => {
    const current = epoch.current
    try {
      const result = await api.notifications()
      if (current === epoch.current) setState(result)
    } catch (error) {
      if (current === epoch.current) setError(errorMessage(error))
    }
  }, [api, connection])
  useEffect(() => {
    void reload()
  }, [reload])

  const refresh = useCallback(
    (force = false) => {
      if (pending.current) return pending.current
      const current = epoch.current
      setSyncing(true)
      const request = (async () => {
        // Install the in-flight promise before invoking APIs that might throw synchronously.
        await Promise.resolve()
        try {
          const result = await api.syncActivity(projectKey ? projectKey.split('|') : [], force)
          if (current !== epoch.current) return
          setState({ items: result.items, lastCheckedAt: result.lastCheckedAt })
          setError(result.errors.join(' · '))
        } catch (error) {
          if (current === epoch.current) setError(errorMessage(error))
        } finally {
          if (current === epoch.current) {
            pending.current = null
            setSyncing(false)
          }
        }
      })()
      pending.current = request
      return request
    },
    [api, projectKey, connection],
  )

  useEffect(() => {
    if (!enabled || !projectKey) return
    const initial = setTimeout(() => void refresh(), 1200)
    const interval = setInterval(() => void refresh(), ACTIVITY_INTERVAL)
    return () => {
      clearTimeout(initial)
      clearInterval(interval)
    }
  }, [enabled, projectKey, refresh])

  const markRead = useCallback(
    async (ids: string[]) => {
      const current = epoch.current
      try {
        const result = await api.markNotificationsRead(ids)
        if (current === epoch.current) setState(result)
      } catch (error) {
        if (current === epoch.current) setError(errorMessage(error))
      }
    },
    [api, connection],
  )
  return { ...state, syncing, error, refresh, reload, markRead }
}
