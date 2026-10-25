import { useEffect, useState } from 'react'
import type { AtlasAPI } from './shared/types'
import type { EstimateState } from './shared/estimates'
import { errorMessage } from './shared/errors'

export function useEstimates(api: AtlasAPI, projectKey: string, connection: object | null) {
  const [state, setState] = useState<EstimateState | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    let sequence = 0
    setState(null)
    setError('')
    const reload = async () => {
      const current = ++sequence
      try {
        const value = await api.estimates(projectKey ? projectKey.split('|') : [])
        if (active && sequence === current) {
          setState(value)
          setError('')
        }
      } catch (e) {
        if (active && sequence === current) setError(errorMessage(e))
      }
    }
    if (projectKey) void reload()
    const unsubscribe = api.onEstimates?.(() => void reload())
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [api, projectKey, connection])
  return { state, error }
}
