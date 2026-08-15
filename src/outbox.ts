/**
 * Hybrid write queue: ported from xmemo-cindy-plugin's hybridWrite/stageLocalWrite/
 * finalizeLocalWrite/syncOutboxInternal (main.js:453-586, 1403-1444).
 *
 * One divergence from upstream, noted honestly rather than silently: main.js replays a queued write
 * generically because its store is one dynamic JSON blob. This port's store is typed per entity kind
 * (memories/states/events/todos/decisions/snapshots), so a REPLAYED write (via xmemo_sync, possibly in
 * a later process) can only generically patch `cloud_id` + `sync_status` on the target entity — richer
 * field back-fill (e.g. copying `expires_at` from the update_state response) only happens on the FIRST
 * attempt, made synchronously inside the same tool call, which still has the tool's own
 * `applyCloudResult` callback available.
 */

import type { ApiClient } from './http.ts'
import type { LocalStore } from './store.ts'
import { newLocalId } from './store.ts'
import { PluginError } from './types.ts'
import type { MemoryMode, OutboxEntry, OutboxStatus, Store, SyncStatus } from './types.ts'

const AUTO_SYNC_AFTER_WRITE_LIMIT = 3
const MAX_RETRY_ATTEMPTS = 5

export interface HybridWriteSpec {
  /** Stable operation tag stored on the outbox entry (e.g. 'remember', 'create_todo'). */
  operation: string
  path: string
  method?: 'GET' | 'POST'
  body: Record<string, unknown>
  timeoutMs?: number
  /** Safe to auto-retry after a transient failure (replace/upsert semantics on the XMemo API). */
  idempotent: boolean
  targetKind: NonNullable<OutboxEntry['target_kind']>
  /** Local id to (re)use; omit to mint a fresh one for a create-style write. */
  localId?: string
  /** Insert or update the local entity optimistically, before any network attempt. */
  project: (store: Store, localId: string, now: string) => Store
  /** Patch the local entity with the full cloud response, on the FIRST successful attempt only. */
  applyCloudResult?: (store: Store, localId: string, cloudBody: unknown, now: string) => Store
  /** Another write's local_id this write depends on; its resolved cloud id substitutes into the path. */
  dependsOnLocalId?: string
  dependsOnPlaceholder?: string
  /** A 404 on replay discards the queued entry instead of leaving it permanently failed. */
  dropOnNotFound?: boolean
  /** Queue durably without attempting the network call now (e.g. a snapshot after an unsynced state write). */
  skipCloud?: boolean
}

export interface HybridWriteResult<T = unknown> {
  localId: string
  cloudId?: string
  cloudResult?: T
  storage: {
    local: 'saved' | 'skipped'
    cloud: 'synced' | 'queued' | 'skipped'
    queueStatus?: OutboxStatus
  }
}

export interface OutboxSummary {
  pending: number
  held: number
  failed: number
  sent: number
}

function findEntityCloudId(store: Store, kind: NonNullable<OutboxEntry['target_kind']>, localId: string): string | undefined {
  switch (kind) {
    case 'memory': return store.memories.find(e => e.local_id === localId)?.cloud_id
    case 'state': return store.states.find(e => e.local_id === localId)?.cloud_id
    case 'event': return store.events.find(e => e.local_id === localId)?.cloud_id
    case 'todo': return store.todos.find(e => e.local_id === localId)?.cloud_id
    case 'decision': return store.decisions.find(e => e.local_id === localId)?.cloud_id
    case 'snapshot': return store.snapshots.find(e => e.local_id === localId)?.cloud_id
  }
}

function patchEntity<T extends { local_id: string }>(items: T[], localId: string, patch: Partial<T>): T[] {
  return items.map(item => (item.local_id === localId ? { ...item, ...patch } : item))
}

function markEntitySynced(store: Store, kind: NonNullable<OutboxEntry['target_kind']>, localId: string, cloudId: string, now: string): Store {
  const patch = { cloud_id: cloudId, sync_status: 'synced' as const, updated_at: now }
  switch (kind) {
    case 'memory': return { ...store, memories: patchEntity(store.memories, localId, patch) }
    case 'state': return { ...store, states: patchEntity(store.states, localId, patch) }
    case 'event': return { ...store, events: patchEntity(store.events, localId, patch) }
    case 'todo': return { ...store, todos: patchEntity(store.todos, localId, patch) }
    case 'decision': return { ...store, decisions: patchEntity(store.decisions, localId, patch) }
    case 'snapshot': return { ...store, snapshots: patchEntity(store.snapshots, localId, patch) }
  }
}

function markEntitySyncStatus(store: Store, kind: NonNullable<OutboxEntry['target_kind']>, localId: string, syncStatus: SyncStatus, now: string): Store {
  const patch = { sync_status: syncStatus, updated_at: now }
  switch (kind) {
    case 'memory': return { ...store, memories: patchEntity(store.memories, localId, patch) }
    case 'state': return { ...store, states: patchEntity(store.states, localId, patch) }
    case 'event': return { ...store, events: patchEntity(store.events, localId, patch) }
    case 'todo': return { ...store, todos: patchEntity(store.todos, localId, patch) }
    case 'decision': return { ...store, decisions: patchEntity(store.decisions, localId, patch) }
    case 'snapshot': return { ...store, snapshots: patchEntity(store.snapshots, localId, patch) }
  }
}

function removeEntity(store: Store, kind: NonNullable<OutboxEntry['target_kind']>, localId: string): Store {
  switch (kind) {
    case 'memory': return { ...store, memories: store.memories.filter(e => e.local_id !== localId) }
    case 'state': return { ...store, states: store.states.filter(e => e.local_id !== localId) }
    case 'event': return { ...store, events: store.events.filter(e => e.local_id !== localId) }
    case 'todo': return { ...store, todos: store.todos.filter(e => e.local_id !== localId) }
    case 'decision': return { ...store, decisions: store.decisions.filter(e => e.local_id !== localId) }
    case 'snapshot': return { ...store, snapshots: store.snapshots.filter(e => e.local_id !== localId) }
  }
}

function classifyFailure(entry: OutboxEntry, error: PluginError): OutboxStatus {
  if (!error.retryable) return 'failed'
  return entry.idempotent ? 'pending' : 'held'
}

async function attemptSend(api: ApiClient, path: string, entry: OutboxEntry): Promise<{ ok: true; cloudBody: unknown } | { ok: false; error: PluginError }> {
  try {
    const cloudBody = await api.request(path, {
      method: (entry.method as 'GET' | 'POST') ?? 'POST',
      body: entry.body,
      timeoutMs: entry.timeout_ms,
      write: true,
    })
    return { ok: true, cloudBody }
  } catch (error) {
    if (error instanceof PluginError) return { ok: false, error }
    return { ok: false, error: new PluginError('UNKNOWN_ERROR', error instanceof Error ? error.message : String(error), 'unknown', false) }
  }
}

function extractCloudId(cloudBody: unknown, fallback: string): string {
  if (cloudBody && typeof cloudBody === 'object') {
    const record = cloudBody as Record<string, unknown>
    for (const key of ['id', 'memory_id', 'state_id', 'event_id', 'todo_id', 'decision_id', 'snapshot_id']) {
      const value = record[key]
      if (typeof value === 'string' && value) return value
    }
  }
  return fallback
}

/**
 * The single entry point every mutating tool funnels through. `cloud-only` calls the API directly
 * with no local persistence; `local-only` stages the entity + a `held` outbox entry and never touches
 * the network; `hybrid` stages first (durable before any network attempt), then attempts the call.
 */
export async function hybridWrite(
  deps: { localStore: LocalStore; api: ApiClient; mode: MemoryMode },
  spec: HybridWriteSpec,
): Promise<HybridWriteResult> {
  const { localStore, api, mode } = deps

  if (mode === 'cloud-only') {
    const cloudBody = await api.request(spec.path, { method: spec.method ?? 'POST', body: spec.body, timeoutMs: spec.timeoutMs, write: true })
    return {
      localId: spec.localId ?? newLocalId(spec.operation),
      cloudId: extractCloudId(cloudBody, ''),
      cloudResult: cloudBody,
      storage: { local: 'skipped', cloud: 'synced' },
    }
  }

  const localId = spec.localId ?? newLocalId(spec.operation)
  let outboxLocalId = ''

  const staged = await localStore.mutate((store) => {
    const now = new Date().toISOString()
    let next = spec.project(store, localId, now)

    // A dependency is always the same entity kind as this write (e.g. complete_todo
    // depends on the create_todo that made the todo it targets).
    const dependencyCloudId = spec.dependsOnLocalId
      ? findEntityCloudId(next, spec.targetKind, spec.dependsOnLocalId)
      : undefined
    const held = mode === 'local-only'
      || spec.skipCloud === true
      || (spec.dependsOnLocalId !== undefined && dependencyCloudId === undefined)

    const entry: OutboxEntry = {
      local_id: newLocalId('outbox'),
      operation: spec.operation,
      path: dependencyCloudId && spec.dependsOnPlaceholder
        ? spec.path.replace(spec.dependsOnPlaceholder, dependencyCloudId)
        : spec.path,
      method: spec.method ?? 'POST',
      body: spec.body,
      timeout_ms: spec.timeoutMs ?? 30_000,
      idempotent: spec.idempotent,
      status: held ? 'held' : 'staged',
      outcome: 'not_executed',
      retry_count: 0,
      created_at: now,
      updated_at: now,
      target_local_id: localId,
      target_kind: spec.targetKind,
      depends_on_local_id: spec.dependsOnLocalId,
      depends_on_placeholder: spec.dependsOnPlaceholder,
      drop_on_not_found: spec.dropOnNotFound,
      skip_cloud: spec.skipCloud,
      last_error: mode === 'local-only'
        ? 'local-only mode: never sent to the cloud'
        : spec.dependsOnLocalId !== undefined && dependencyCloudId === undefined
          ? 'held: dependency has not synced yet'
          : undefined,
    }
    outboxLocalId = entry.local_id
    next = { ...next, outbox: [...next.outbox, entry] }
    return next
  })

  const stagedEntry = staged.outbox.find(e => e.local_id === outboxLocalId)!
  if (stagedEntry.status === 'held') {
    return { localId, storage: { local: 'saved', cloud: 'skipped', queueStatus: 'held' } }
  }

  const attempt = await attemptSend(api, stagedEntry.path, stagedEntry)

  if (attempt.ok) {
    const cloudId = extractCloudId(attempt.cloudBody, localId)
    await localStore.mutate((store) => {
      const now = new Date().toISOString()
      let next = markEntitySynced(store, spec.targetKind, localId, cloudId, now)
      if (spec.applyCloudResult) next = spec.applyCloudResult(next, localId, attempt.cloudBody, now)
      next = { ...next, outbox: patchEntity(next.outbox, outboxLocalId, { status: 'sent', outcome: 'executed', updated_at: now }) }
      return next
    })
    void syncOutboxInternal(deps, { includeHeld: false, limit: AUTO_SYNC_AFTER_WRITE_LIMIT }).catch(() => {})
    return { localId, cloudId, cloudResult: attempt.cloudBody, storage: { local: 'saved', cloud: 'synced' } }
  }

  const nextStatus = classifyFailure(stagedEntry, attempt.error)
  await localStore.mutate((store) => {
    const now = new Date().toISOString()
    const outcome = nextStatus === 'failed' ? attempt.error.outcome : 'unknown'
    return {
      ...store,
      outbox: patchEntity(store.outbox, outboxLocalId, {
        status: nextStatus,
        outcome,
        last_error: attempt.error.message,
        updated_at: now,
      }),
    }
  })

  if (nextStatus === 'failed') throw attempt.error

  return { localId, storage: { local: 'saved', cloud: 'queued', queueStatus: nextStatus } }
}

export function outboxSummary(store: Store): OutboxSummary {
  const tally: OutboxSummary = { pending: 0, held: 0, failed: 0, sent: 0 }
  for (const entry of store.outbox) {
    if (entry.status === 'pending') tally.pending++
    else if (entry.status === 'held') tally.held++
    else if (entry.status === 'failed') tally.failed++
    else if (entry.status === 'sent') tally.sent++
  }
  return tally
}

export interface SyncOptions {
  includeHeld: boolean
  limit: number
}

export interface SyncResult {
  attempted: number
  sent: string[]
  stillQueued: string[]
  failed: string[]
}

/** Replays queued entries oldest-first, stopping at the first retryable failure (avoid hammering a downed/rate-limited endpoint). */
export async function syncOutboxInternal(
  deps: { localStore: LocalStore; api: ApiClient; mode: MemoryMode },
  options: SyncOptions,
): Promise<SyncResult> {
  const { localStore, api, mode } = deps
  const result: SyncResult = { attempted: 0, sent: [], stillQueued: [], failed: [] }
  if (mode === 'local-only' || mode === 'cloud-only') return result

  for (let i = 0; i < options.limit; i++) {
    const store = await localStore.read()
    const statuses: OutboxStatus[] = options.includeHeld ? ['pending', 'held'] : ['pending']
    const candidates = store.outbox
      .filter(e => statuses.includes(e.status))
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
    const entry = candidates[0]
    if (!entry) break

    result.attempted++

    let path = entry.path
    if (entry.depends_on_local_id) {
      const depCloudId = findEntityCloudId(store, entry.target_kind!, entry.depends_on_local_id)
      if (!depCloudId) {
        await localStore.mutate(s => ({
          ...s,
          outbox: patchEntity(s.outbox, entry.local_id, { status: 'held', last_error: 'dependency has not synced yet' }),
        }))
        result.stillQueued.push(entry.local_id)
        continue
      }
      if (entry.depends_on_placeholder) path = path.replace(entry.depends_on_placeholder, depCloudId)
    }

    await localStore.mutate(s => ({ ...s, outbox: patchEntity(s.outbox, entry.local_id, { status: 'processing' }) }))
    const attempt = await attemptSend(api, path, entry)

    if (attempt.ok) {
      const cloudId = extractCloudId(attempt.cloudBody, entry.target_local_id ?? entry.local_id)
      const now = new Date().toISOString()
      await localStore.mutate((s) => {
        let next = entry.target_kind && entry.target_local_id
          ? markEntitySynced(s, entry.target_kind, entry.target_local_id, cloudId, now)
          : s
        next = { ...next, outbox: patchEntity(next.outbox, entry.local_id, { status: 'sent', outcome: 'executed', updated_at: now }) }
        return next
      })
      result.sent.push(entry.local_id)
      continue
    }

    if (attempt.error.code === 'NOT_FOUND' && entry.drop_on_not_found) {
      await localStore.mutate(s => ({ ...s, outbox: s.outbox.filter(e => e.local_id !== entry.local_id) }))
      continue
    }

    const retryCount = entry.retry_count + 1
    const exhausted = entry.idempotent && retryCount >= MAX_RETRY_ATTEMPTS
    const nextStatus: OutboxStatus = !attempt.error.retryable || exhausted
      ? 'failed'
      : entry.idempotent ? 'pending' : 'held'
    await localStore.mutate(s => ({
      ...s,
      outbox: patchEntity(s.outbox, entry.local_id, {
        status: nextStatus,
        retry_count: retryCount,
        last_error: attempt.error.message,
        updated_at: new Date().toISOString(),
      }),
    }))
    if (nextStatus === 'failed') result.failed.push(entry.local_id)
    else result.stillQueued.push(entry.local_id)
    // Stop at the first retryable failure so a downed/rate-limited endpoint isn't hammered.
    break
  }

  return result
}

export async function discardFailed(localStore: LocalStore, limit: number): Promise<OutboxEntry[]> {
  const discarded: OutboxEntry[] = []
  await localStore.mutate((store) => {
    const failed = store.outbox.filter(e => e.status === 'failed').slice(0, limit)
    discarded.push(...failed)
    const drop = new Set(failed.map(e => e.local_id))
    return { ...store, outbox: store.outbox.filter(e => !drop.has(e.local_id)) }
  })
  return discarded
}

export { markEntitySyncStatus, removeEntity, findEntityCloudId }
