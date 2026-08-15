/**
 * Local hybrid store: ported from xmemo-cindy-plugin's main.js:141-268 (emptyStore/validStore/
 * normalizeStore/readStore/writeStore/pruneStore/withStoreLock). Cindy's host provided `cindy.fs`
 * (root:'data') with unknown atomicity guarantees; this port uses node:fs/promises with an explicit
 * write-temp-then-rename so a crash mid-write can never leave a half-written primary file.
 *
 * No encryption at rest (same as upstream — that was entirely the Cindy host's concern, opaque to
 * the plugin). See README "Known Limitations".
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { PluginError } from './types.ts'
import type {
  DecisionEntity,
  EventEntity,
  MemoryEntity,
  OutboxEntry,
  OutboxStatus,
  RecallCacheEntry,
  SnapshotEntity,
  StateEntity,
  Store,
  TodoEntity,
} from './types.ts'

const STORE_MAX_BYTES = 12 * 1024 * 1024
const RECALL_CACHE_MAX = 64
const OUTBOX_SENT_RETENTION_MS = 24 * 60 * 60 * 1000
const OUTBOX_FAILED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const OUTBOX_FAILED_MAX = 100
const MEMORIES_MAX = 750
const STATES_MAX = 100
const EVENTS_MAX = 500
const TODOS_MAX = 250
const DECISIONS_MAX = 250
const SNAPSHOTS_MAX = 50

export function defaultDataDir(): string {
  return join(homedir(), '.xmemo')
}

export function newLocalId(prefix: string): string {
  return `${prefix}-${randomUUID()}`
}

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length
}

export function emptyStore(): Store {
  const now = new Date().toISOString()
  return {
    schema_version: 1,
    revision: 0,
    updated_at: now,
    memories: [],
    states: [],
    events: [],
    todos: [],
    decisions: [],
    snapshots: [],
    recall_cache: [],
    outbox: [],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validStore(value: unknown): value is Store {
  if (!isRecord(value)) return false
  return value.schema_version === 1 && Array.isArray(value.outbox) && Array.isArray(value.memories)
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

/** Coerce array fields and recover outbox entries an interrupted process left mid-write. */
function normalizeStore(raw: Store): Store {
  const outbox = asArray<OutboxEntry>(raw.outbox).map((entry) => {
    if (entry.status !== 'staged' && entry.status !== 'processing') return entry
    return {
      ...entry,
      status: (entry.idempotent ? 'pending' : 'held') as OutboxStatus,
      outcome: 'unknown' as const,
      last_error: entry.last_error ?? 'recovered after an interrupted write',
      updated_at: new Date().toISOString(),
    }
  })
  return {
    schema_version: 1,
    revision: typeof raw.revision === 'number' ? raw.revision : 0,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : new Date().toISOString(),
    memories: asArray<MemoryEntity>(raw.memories),
    states: asArray<StateEntity>(raw.states),
    events: asArray<EventEntity>(raw.events),
    todos: asArray<TodoEntity>(raw.todos),
    decisions: asArray<DecisionEntity>(raw.decisions),
    snapshots: asArray<SnapshotEntity>(raw.snapshots),
    recall_cache: asArray<RecallCacheEntry>(raw.recall_cache),
    outbox,
  }
}

function pruneStore(store: Store): Store {
  const now = Date.now()
  const recallCache = store.recall_cache
    .filter(entry => Date.parse(entry.max_stale_until) > now)
    .slice(-RECALL_CACHE_MAX)

  let outbox = store.outbox.filter((entry) => {
    if (entry.status === 'sent' && now - Date.parse(entry.updated_at) > OUTBOX_SENT_RETENTION_MS) return false
    if (entry.status === 'failed' && now - Date.parse(entry.updated_at) > OUTBOX_FAILED_RETENTION_MS) return false
    return true
  })
  const failed = outbox.filter(entry => entry.status === 'failed')
  if (failed.length > OUTBOX_FAILED_MAX) {
    const drop = new Set(failed.slice(0, failed.length - OUTBOX_FAILED_MAX).map(entry => entry.local_id))
    outbox = outbox.filter(entry => !drop.has(entry.local_id))
  }

  return {
    ...store,
    memories: store.memories.slice(-MEMORIES_MAX),
    states: store.states.slice(-STATES_MAX),
    events: store.events.slice(-EVENTS_MAX),
    todos: store.todos.slice(-TODOS_MAX),
    decisions: store.decisions.slice(-DECISIONS_MAX),
    snapshots: store.snapshots.slice(-SNAPSHOTS_MAX),
    recall_cache: recallCache,
    outbox,
  }
}

interface FileRead {
  /** True whenever the file exists, even if its content failed to parse — distinguishes "absent" from "corrupt". */
  exists: boolean
  value: unknown
}

async function readJsonFile(path: string): Promise<FileRead> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { exists: false, value: undefined }
    throw new PluginError('LOCAL_STORE_ERROR', `failed to read local store at ${path}: ${(error as Error).message}`)
  }
  try {
    return { exists: true, value: JSON.parse(text) }
  } catch {
    return { exists: true, value: undefined }
  }
}

async function writeJsonFileAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${randomUUID()}`
  try {
    await writeFile(tmp, content, 'utf8')
    await rename(tmp, path)
  } catch (error) {
    await unlink(tmp).catch(() => {})
    throw new PluginError('LOCAL_STORE_ERROR', `failed to write local store at ${path}: ${(error as Error).message}`)
  }
}

export class LocalStore {
  private readonly primaryPath: string
  private readonly backupPath: string
  private lock: Promise<unknown> = Promise.resolve()

  constructor(dataDir: string = defaultDataDir()) {
    this.primaryPath = join(dataDir, 'store-v1.json')
    this.backupPath = join(dataDir, 'store-v1-backup.json')
  }

  private async readUnlocked(): Promise<Store> {
    const primary = await readJsonFile(this.primaryPath)
    if (validStore(primary.value)) return normalizeStore(primary.value)

    const backup = await readJsonFile(this.backupPath)
    if (validStore(backup.value)) return normalizeStore(backup.value)

    if (primary.exists || backup.exists) {
      throw new PluginError(
        'LOCAL_STORE_CORRUPT',
        `local XMemo store at ${this.primaryPath} is unreadable and no valid backup was found; `
          + 'the corrupt files were left in place for inspection.',
      )
    }
    return emptyStore()
  }

  private async writeUnlocked(store: Store): Promise<Store> {
    const pruned = pruneStore(store)
    const next: Store = { ...pruned, revision: pruned.revision + 1, updated_at: new Date().toISOString() }
    const serialized = JSON.stringify(next)
    if (utf8Length(serialized) > STORE_MAX_BYTES) {
      throw new PluginError(
        'LOCAL_STORE_QUOTA',
        `local XMemo store would exceed its ${STORE_MAX_BYTES}-byte quota; not written. `
          + 'Use xmemo_sync to push and clear pending writes, or xmemo_forget to remove old memories.',
      )
    }

    const currentPrimary = await readJsonFile(this.primaryPath)
    if (validStore(currentPrimary.value)) {
      await writeJsonFileAtomic(this.backupPath, JSON.stringify(currentPrimary.value))
    }
    await writeJsonFileAtomic(this.primaryPath, serialized)
    return next
  }

  /** Serialize all store mutations through one in-process chain (not cross-process safe). */
  private withLock<T>(work: () => Promise<T>): Promise<T> {
    const result = this.lock.then(work, work)
    this.lock = result.catch(() => {})
    return result
  }

  read(): Promise<Store> {
    return this.withLock(() => this.readUnlocked())
  }

  mutate(mutator: (store: Store) => Store | Promise<Store>): Promise<Store> {
    return this.withLock(async () => {
      const current = await this.readUnlocked()
      const mutated = await mutator(current)
      return this.writeUnlocked(mutated)
    })
  }
}
