/**
 * Shared "local + cloud merge with stale-cache fallback" pattern used by xmemo_list_timeline,
 * xmemo_list_todos, and xmemo_list_decisions (main.js's identical shape across all three).
 */

import type { ApiClient } from './http.ts'
import { cacheKey, getRecallCache, putRecallCache } from './recall.ts'
import type { LocalStore } from './store.ts'
import type { MemoryMode } from './types.ts'

export interface ListResult<T> {
  source: 'local' | 'hybrid' | 'hybrid_cache'
  stale: boolean
  items: T[]
}

const RECALL_CACHE_TTL_MS = 15 * 60 * 1000

export async function listWithCache<T>(
  deps: { api: ApiClient; localStore: LocalStore; mode: MemoryMode },
  opts: {
    cacheKind: string
    cacheParams: Record<string, unknown>
    cloudPath: string
    timeoutMs: number
    localItems: () => Promise<T[]>
    extractCloudItems: (cloudBody: unknown) => T[]
    mergeAndDedupe: (cloudItems: T[], localItems: T[]) => T[]
    signal?: AbortSignal
  },
): Promise<ListResult<T>> {
  if (deps.mode === 'local-only') {
    return { source: 'local', stale: false, items: await opts.localItems() }
  }

  const key = cacheKey(opts.cacheKind, opts.cacheParams)

  try {
    const cloudBody = await deps.api.request(opts.cloudPath, { method: 'GET', timeoutMs: opts.timeoutMs, signal: opts.signal })
    await deps.localStore.mutate(store => putRecallCache(store, key, opts.cacheKind, cloudBody, RECALL_CACHE_TTL_MS))
    const cloudItems = opts.extractCloudItems(cloudBody)
    if (deps.mode === 'cloud-only') return { source: 'hybrid', stale: false, items: cloudItems }
    const merged = opts.mergeAndDedupe(cloudItems, await opts.localItems())
    return { source: 'hybrid', stale: false, items: merged }
  } catch (error) {
    if (deps.mode === 'cloud-only') throw error
    const store = await deps.localStore.read()
    const cached = getRecallCache(store, key)
    const localItems = await opts.localItems()
    if (!cached) return { source: 'local', stale: false, items: localItems }
    const cloudItems = opts.extractCloudItems(cached.payload)
    return { source: 'hybrid_cache', stale: true, items: opts.mergeAndDedupe(cloudItems, localItems) }
  }
}
