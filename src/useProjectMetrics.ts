import { useEffect, useState } from 'react'
import type { AtlasAPI } from './shared/types'
import type { ProjectMetricSnapshot } from './shared/metrics'
import { errorMessage } from './shared/errors'

export function useProjectMetrics(
  api: AtlasAPI,
  projectKey: string,
  connection: object | null,
  lastCheckedAt: number | null,
  syncing: boolean,
) {
  const [snapshots, setSnapshots] = useState<ProjectMetricSnapshot[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    setSnapshots([])
    setError('')
  }, [api, connection])
  useEffect(() => {
    let active = true
    if (!projectKey || !connection) return
    Promise.resolve()
      .then(() => {
        if (typeof api.projectMetrics !== 'function')
          throw new Error('Riavvia l’app per caricare le metriche progetto.')
        return api.projectMetrics(projectKey.split('|'))
      })
      .then((result) => {
        if (active) {
          setSnapshots(result)
          setError('')
        }
      })
      .catch((error) => {
        if (active) setError(errorMessage(error))
      })
    return () => {
      active = false
    }
  }, [api, projectKey, connection, lastCheckedAt, syncing])
  return { snapshots, error }
}
