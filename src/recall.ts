/**
 * Recall/list helpers ported from xmemo-cindy-plugin's main.js:592-718: local substring/token
 * scoring merged with cloud results, a stale-but-cached fallback when the cloud call fails, and the
 * fail-closed bucket/scope filter in compactCloudRecallItems — a real security property, ported
 * exactly: any cloud item that doesn't exactly match the requested bucket/scope is dropped, and if
 * *any* item violated, ALL opaque cloud text is suppressed (individual bad text can't be isolated
 * from a concatenated blob).
 */

import type { MemoryEntity, RecallCacheEntry, StateEntity, Store } from './types.ts'

export interface MemoryItem {
  id: string
  content: string
  bucket?: string
  scope?: string
  path?: string
  source: 'local' | 'cloud'
  score?: number
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? []
}

function scoreText(queryTokens: string[], text: string): number {
  if (queryTokens.length === 0) return 0
  const lower = text.toLowerCase()
  let score = 0
  for (const token of queryTokens) {
    if (lower.includes(token)) score += 1
  }
  return score / queryTokens.length
}

function matchesFilter(value: string | undefined, filter: string | undefined): boolean {
  return filter === undefined || filter === '' || filter === '%' || value === filter
}

/** Substring/token overlap scoring over local memories + active states, highest-scoring first. */
export function localMemoryItems(
  store: Store,
  query: string,
  options: { path?: string; bucket?: string; scope?: string; limit: number },
): MemoryItem[] {
  const queryTokens = tokenize(query)
  const items: MemoryItem[] = []

  for (const memory of store.memories) {
    if (!matchesFilter(memory.path, options.path)) continue
    if (!matchesFilter(memory.bucket, options.bucket)) continue
    if (!matchesFilter(memory.scope, options.scope)) continue
    const score = scoreText(queryTokens, memory.content)
    if (score > 0) items.push({ id: memory.cloud_id ?? memory.local_id, content: memory.content, bucket: memory.bucket, scope: memory.scope, path: memory.path, source: 'local', score })
  }

  for (const state of store.states) {
    if (!matchesFilter(state.scope, options.scope)) continue
    const content = [state.content, state.current_task, state.next_action, state.blocked_reason].filter(Boolean).join('\n')
    if (!content) continue
    const score = scoreText(queryTokens, content)
    if (score > 0) items.push({ id: state.cloud_id ?? state.local_id, content, scope: state.scope, source: 'local', score })
  }

  return items.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, options.limit)
}

/** Dedupe by id (falls back to scope:content) — cloud entries win a collision, local entries fill gaps. */
export function mergeMemoryItems(cloudItems: MemoryItem[], localItems: MemoryItem[]): MemoryItem[] {
  const seen = new Set<string>()
  const merged: MemoryItem[] = []
  const keyOf = (item: MemoryItem): string => item.id || `${item.scope ?? ''}:${item.content}`
  for (const item of cloudItems) {
    const key = keyOf(item)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(item)
  }
  for (const item of localItems) {
    const key = keyOf(item)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(item)
  }
  return merged
}

export interface CompactedRecall {
  items: MemoryItem[]
  violations: number
  /** True once any item violated — callers must suppress all opaque cloud text, not just the bad item. */
  suppressText: boolean
}

/**
 * Fail-closed cloud recall filter: does not trust the server's own bucket/scope filtering. An item
 * whose bucket/scope isn't an exact match for the request is dropped and counted as a violation.
 *
 * POST /v1/recall/context strips `content` from every item server-side (memory-os
 * services/recall.py:198-199 pops it before returning `items`) — the readable text lives only in
 * the response's top-level `context_text`, a combined block covering ALL items together. That
 * single-blob shape is why any violation must suppress `context_text` in its entirety rather than
 * per item (see {@link compactContextText}): there is no way to remove just the bad item's text
 * from an already-concatenated string.
 */
export function compactCloudRecallItems(
  rawItems: unknown[],
  requestedBucket: string | undefined,
  requestedScope: string | undefined,
): CompactedRecall {
  let violations = 0
  const items: MemoryItem[] = []
  for (const raw of rawItems) {
    if (typeof raw !== 'object' || raw === null) continue
    const record = raw as Record<string, unknown>
    const bucket = typeof record.bucket === 'string' ? record.bucket : undefined
    const scope = typeof record.scope === 'string' ? record.scope : undefined
    const requestExact = (requested: string | undefined): boolean => requested === undefined || requested === '' || requested === '%'
    const bucketOk = requestExact(requestedBucket) || bucket === requestedBucket
    const scopeOk = requestExact(requestedScope) || scope === requestedScope
    if (!bucketOk || !scopeOk) {
      violations++
      continue
    }
    items.push({
      id: typeof record.id === 'string' ? record.id : typeof record.memory_id === 'string' ? record.memory_id : '',
      content: '', // never present per-item; see the module comment above
      bucket,
      scope,
      path: typeof record.path === 'string' ? record.path : undefined,
      source: 'cloud',
    })
  }
  return { items, violations, suppressText: violations > 0 }
}

/** Fail-closed: blank the combined context_text entirely when any item violated bucket/scope. */
export function compactContextText(contextText: unknown, violations: number): string {
  if (violations > 0) return ''
  return typeof contextText === 'string' ? contextText : ''
}

export function cacheKey(kind: string, params: Record<string, unknown>): string {
  return `${kind}:${JSON.stringify(params, Object.keys(params).sort())}`
}

export function putRecallCache(store: Store, key: string, kind: string, payload: unknown, maxStaleMs: number): Store {
  const now = new Date()
  const entry: RecallCacheEntry = {
    key,
    kind,
    payload,
    cached_at: now.toISOString(),
    max_stale_until: new Date(now.getTime() + maxStaleMs).toISOString(),
  }
  const withoutOld = store.recall_cache.filter(e => e.key !== key)
  return { ...store, recall_cache: [...withoutOld, entry] }
}

export function getRecallCache(store: Store, key: string): RecallCacheEntry | undefined {
  const entry = store.recall_cache.find(e => e.key === key)
  if (!entry) return undefined
  if (Date.parse(entry.max_stale_until) < Date.now()) return undefined
  return entry
}

export type { MemoryEntity, StateEntity }
