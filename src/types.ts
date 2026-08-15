/**
 * Shared types for the local hybrid store, the outbox write queue, and plugin errors.
 * Field shapes mirror xmemo-cindy-plugin's main.js store so behavior ports 1:1.
 */

export type MemoryMode = 'hybrid' | 'local-only' | 'cloud-only'

/** Uniform error shape thrown by http.ts / store.ts / outbox.ts and caught at the tool boundary. */
export class PluginError extends Error {
  code: string
  outcome: 'executed' | 'not_executed' | 'unknown' | 'partial'
  retryable: boolean

  constructor(code: string, message: string, outcome: PluginError['outcome'] = 'not_executed', retryable = false) {
    super(message)
    this.name = 'PluginError'
    this.code = code
    this.outcome = outcome
    this.retryable = retryable
  }
}

export type SyncStatus = 'synced' | 'pending' | 'held' | 'failed' | 'local-only'

export interface MemoryEntity {
  local_id: string
  cloud_id?: string
  path: string
  bucket: string
  scope: string
  memory_type: string
  content: string
  semantic_key?: string
  importance?: number
  created_at: string
  updated_at: string
  sync_status: SyncStatus
}

export interface StateEntity {
  local_id: string
  cloud_id?: string
  state_key: string
  scope: string
  content?: string
  current_task?: string
  next_action?: string
  blocked_reason?: string
  ttl_seconds?: number
  expires_at?: string
  created_at: string
  updated_at: string
  sync_status: SyncStatus
}

export interface EventEntity {
  local_id: string
  cloud_id?: string
  event_type: string
  scope: string
  path: string
  content: string
  occurred_at: string
  session_id?: string
  importance: number
  confidence: number
  created_at: string
  updated_at: string
  sync_status: SyncStatus
}

export interface TodoEntity {
  local_id: string
  cloud_id?: string
  content: string
  scope: string
  path: string
  bucket: string
  due_at?: string
  status: 'open' | 'completed'
  created_at: string
  updated_at: string
  sync_status: SyncStatus
}

export interface DecisionEntity {
  local_id: string
  cloud_id?: string
  context: string
  options: string[]
  scope: string
  path: string
  bucket: string
  due_at?: string
  status: 'open' | 'resolved'
  resolution?: string
  created_at: string
  updated_at: string
  sync_status: SyncStatus
}

export interface SnapshotEntity {
  local_id: string
  cloud_id?: string
  scope: string
  state_key: string
  state: StateEntity | null
  events: EventEntity[]
  todos: TodoEntity[]
  decisions: DecisionEntity[]
  created_at: string
  updated_at: string
  sync_status: SyncStatus
}

export interface RecallCacheEntry {
  key: string
  kind: string
  payload: unknown
  cached_at: string
  max_stale_until: string
}

export type OutboxStatus = 'staged' | 'processing' | 'sent' | 'pending' | 'held' | 'failed'

export interface OutboxEntry {
  local_id: string
  operation: string
  path: string
  method: string
  body: Record<string, unknown>
  timeout_ms: number
  idempotent: boolean
  status: OutboxStatus
  outcome: PluginError['outcome']
  retry_count: number
  created_at: string
  updated_at: string
  /** The local entity this write projected into the store (kind + local_id), for cloud-id back-fill on success. */
  target_local_id?: string
  target_kind?: 'memory' | 'state' | 'event' | 'todo' | 'decision' | 'snapshot'
  /** Another outbox entry's local_id this write depends on (its cloud_id must exist before replay). */
  depends_on_local_id?: string
  /** URL path segment to substitute with the resolved dependency's cloud_id. */
  depends_on_placeholder?: string
  drop_on_not_found?: boolean
  skip_cloud?: boolean
  last_error?: string
}

export interface Store {
  schema_version: 1
  revision: number
  updated_at: string
  memories: MemoryEntity[]
  states: StateEntity[]
  events: EventEntity[]
  todos: TodoEntity[]
  decisions: DecisionEntity[]
  snapshots: SnapshotEntity[]
  recall_cache: RecallCacheEntry[]
  outbox: OutboxEntry[]
}

export interface PluginConfig {
  mode: MemoryMode
  apiKeyCredential: string
  apiBaseUrl: string
  defaultScope: string
  agentId: string
  requestTimeoutMs: number
  longRequestTimeoutMs: number
}
