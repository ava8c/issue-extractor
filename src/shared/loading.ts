// A stable cache key keeps reordered selections from triggering another download.
export function issueScope(projectId: string, statuses?: string[]): string {
  return JSON.stringify([projectId, statuses ? [...new Set(statuses)].sort() : null])
}

export const PROJECT_CACHE_MAX_AGE = 5 * 60_000

// Share one limiter across callers so overlapping batches respect the same budget.
export function limitConcurrency(concurrency: number) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1)
    throw new RangeError('Concurrency must be a positive integer.')
  let active = 0
  const waiting: (() => void)[] = []
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve))
    else active++
    try {
      return await task()
    } finally {
      const next = waiting.shift()
      if (next) next()
      else active--
    }
  }
}

export async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  task: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(values.length)
  let next = 0
  let failed = false
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (!failed && next < values.length) {
        const index = next++
        try {
          results[index] = await task(values[index], index)
        } catch (error) {
          failed = true
          throw error
        }
      }
    }),
  )
  return results
}
