import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AtlasAPI, Settings } from './shared/types'
import { githubConnection } from './shared/github-connection'

export function useGitHubConnection(source: AtlasAPI, settings: Settings | null) {
  const [offline, setOffline] = useState(false)
  const [checking, setChecking] = useState(false)
  const connection = useMemo(
    () => (settings?.hasToken ? githubConnection(source, settings, setOffline) : null),
    [source, settings],
  )
  const check = useCallback(async () => {
    if (!connection) return true
    setChecking(true)
    try {
      return await connection.check()
    } finally {
      setChecking(false)
    }
  }, [connection])
  useEffect(() => {
    setOffline(false)
    setChecking(false)
    if (!connection) return
    connection.activate()
    // Probe even when all cached lists are fresh, and resume automatically after VPN reconnection.
    void check().catch(() => {})
    const timer = setInterval(() => void check().catch(() => {}), 30_000)
    return () => {
      clearInterval(timer)
      connection.dispose()
    }
  }, [connection, check])
  return { api: connection?.api ?? source, offline, checking, check }
}
