import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDeps } from '../deps.ts'
import { hybridWrite } from '../outbox.ts'
import { newLocalId } from '../store.ts'
import { findState, writeState } from '../state-write.ts'
import { PluginError } from '../types.ts'
import type { SnapshotEntity, StateEntity, Store } from '../types.ts'
import { boundedInteger, optionalString, requiredString, toLosslessJson } from '../util.ts'

function buildLocalSnapshot(store: Store, scope: string, state: StateEntity | undefined): Pick<SnapshotEntity, 'state' | 'events' | 'todos' | 'decisions'> {
  return {
    state: state ?? null,
    events: store.events.filter(e => e.scope === scope).slice(-20),
    todos: store.todos.filter(t => t.scope === scope && t.status === 'open').slice(-20),
    decisions: store.decisions.filter(d => d.scope === scope && d.status === 'open').slice(-20),
  }
}

export function registerSaveProgressTool(ctx: Context, deps: ToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'xmemo_save_progress',
    description: 'Checkpoint work by saving scoped active state and a restart snapshot locally '
      + 'before cloud synchronization. Use before a handoff, interruption, restart, or explicit '
      + 'save-progress request.',
    parameters: {
      current_task: { type: 'string', required: true, description: 'What is currently being worked on and the verified present state. Up to 12000 characters.' },
      next_action: { type: 'string', description: 'The exact next action for a resumed session. Up to 8000 characters.' },
      blocked_reason: { type: 'string', description: 'Current blocker, if any. Up to 8000 characters.' },
      content: { type: 'string', description: 'Optional compact handoff notes or validation evidence. Up to 20000 characters.' },
      state_key: { type: 'string', description: 'Stable state slot; defaults to active_task. Use a project-specific key to isolate projects.' },
      scope: { type: 'string', description: 'Stable snapshot scope; defaults to the plugin default scope. Use the same value when restoring.' },
      ttl_seconds: { type: 'number', description: 'Active-state and snapshot lifetime in seconds, 0-2592000; defaults to 604800. Zero means no expiry where supported.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: `Saved progress (${(value as { state_storage?: { cloud?: string } }).state_storage?.cloud ?? 'local'}).` }],
    },
    async execute(args) {
      const currentTask = requiredString(args.current_task, 'current_task', 12_000)
      const nextAction = optionalString(args.next_action)
      const blockedReason = optionalString(args.blocked_reason)
      const content = optionalString(args.content)
      const stateKey = optionalString(args.state_key) ?? 'active_task'
      const scope = optionalString(args.scope) ?? deps.config.defaultScope
      const ttlSeconds = boundedInteger(args.ttl_seconds, 604_800, 0, 2_592_000)
      const timeoutMs = deps.config.requestTimeoutMs

      if (deps.mode === 'cloud-only') {
        const stateResult = await deps.api.request('/v1/update_state', {
          method: 'POST', timeoutMs, write: true,
          body: { state_key: stateKey, scope, content, current_task: currentTask, next_action: nextAction, blocked_reason: blockedReason, ttl_seconds: ttlSeconds },
        })
        try {
          const snapshotResult = await deps.api.request('/v1/restart/snapshot', {
            method: 'POST', timeoutMs, write: true, body: { state_key: stateKey, scope },
          })
          return { state_storage: { local: 'skipped', cloud: 'synced' }, snapshot_storage: { local: 'skipped', cloud: 'synced' }, state: stateResult, snapshot: snapshotResult }
        } catch (error) {
          throw new PluginError(
            'SNAPSHOT_FAILED_AFTER_STATE_SAVE',
            'The state save succeeded but the restart snapshot failed — do not blindly retry the whole '
              + `operation, it would re-save state that already landed. Underlying error: ${error instanceof Error ? error.message : String(error)}`,
            'partial',
            false,
          )
        }
      }

      const stateWrite = await writeState({ localStore: deps.localStore, api: deps.api, mode: deps.mode, timeoutMs }, {
        content, currentTask, nextAction, blockedReason, stateKey, scope, ttlSeconds,
      })

      const localId = newLocalId('snapshot')
      const snapshotWrite = await hybridWrite({ localStore: deps.localStore, api: deps.api, mode: deps.mode }, {
        operation: 'create_snapshot',
        path: '/v1/restart/snapshot',
        idempotent: false,
        targetKind: 'snapshot',
        localId,
        timeoutMs,
        // Never attempt the cloud snapshot until state has actually synced — it would reference
        // state the server doesn't have yet.
        skipCloud: stateWrite.storage.cloud !== 'synced',
        body: { state_key: stateKey, scope },
        project: (s, id, now) => {
          const state = findState(s, scope, stateKey)
          const entity: SnapshotEntity = { local_id: id, scope, state_key: stateKey, created_at: now, updated_at: now, sync_status: 'pending', ...buildLocalSnapshot(s, scope, state) }
          return { ...s, snapshots: [...s.snapshots, entity] }
        },
      })

      return {
        state_id: stateWrite.cloudId ?? stateWrite.localId,
        snapshot_id: snapshotWrite.cloudId ?? snapshotWrite.localId,
        state_storage: stateWrite.storage,
        snapshot_storage: snapshotWrite.storage,
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Save XMemo progress', kind: 'other', rawInput: args }),
  }))
}

function candidateExpired(candidate: SnapshotEntity): boolean {
  return candidate.state?.expires_at !== undefined && Date.parse(candidate.state.expires_at) < Date.now()
}

function findLocalSnapshot(store: Store, snapshotId: string | undefined, scope: string, stateKey: string): SnapshotEntity | undefined {
  const candidates = store.snapshots.filter(s => !candidateExpired(s))
  if (snapshotId) {
    return candidates.find(s => s.local_id === snapshotId || s.cloud_id === snapshotId)
  }
  return candidates
    .filter(s => s.scope === scope && s.state_key === stateKey)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0]
}

function boundList<T>(items: T[], limit = 20): T[] {
  return items.slice(0, limit)
}

export function registerRestoreProgressTool(ctx: Context, deps: ToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'xmemo_restore_progress',
    description: 'Restore a selected or latest local/cloud restart snapshot and return bounded '
      + 'state, timeline, reminders, and pending decisions. It writes restored state and a restore '
      + 'event by default; do not call as a read-only preview.',
    parameters: {
      snapshot_id: { type: 'string', description: 'Optional exact snapshot row or logical memory ID. Omit to restore the latest matching snapshot.' },
      source_session_id: { type: 'string', description: 'Optional old session ID filter. Usually omit and use stable scope/state_key instead.' },
      state_key: { type: 'string', description: 'State slot to restore; defaults to active_task.' },
      scope: { type: 'string', description: 'Snapshot scope; defaults to the plugin default scope. Must match the save scope.' },
      restore_state: { type: 'boolean', description: 'Restore active state into the current slot; defaults to true.' },
      record_restore_event: { type: 'boolean', description: 'Record the resume in the timeline; defaults to true.' },
      ttl_seconds: { type: 'number', description: 'Optional lifetime for restored active state, 0-2592000.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: `Restored progress from ${(value as { source: string }).source}.` }],
    },
    async execute(args, exec) {
      const snapshotId = optionalString(args.snapshot_id)
      const sourceSessionId = optionalString(args.source_session_id)
      const stateKey = optionalString(args.state_key) ?? 'active_task'
      const scope = optionalString(args.scope) ?? deps.config.defaultScope
      const restoreState = args.restore_state !== false
      const recordRestoreEvent = args.record_restore_event !== false
      const ttlSeconds = args.ttl_seconds === undefined ? undefined : boundedInteger(args.ttl_seconds, 604_800, 0, 2_592_000)
      const timeoutMs = deps.config.longRequestTimeoutMs
      const requestBody = {
        snapshot_id: snapshotId,
        source_session_id: sourceSessionId,
        state_key: stateKey,
        scope,
        restore_state: restoreState,
        record_restore_event: recordRestoreEvent,
        ttl_seconds: ttlSeconds,
      }

      if (deps.mode === 'cloud-only') {
        const cloudResult = await deps.api.request('/v1/restart/restore', {
          method: 'POST', timeoutMs, write: true, signal: exec.signal, body: requestBody,
        })
        return toLosslessJson({ source: 'cloud', stale: false, ...(cloudResult as object) })
      }

      const store = await deps.localStore.read()
      const localCandidate = findLocalSnapshot(store, snapshotId, scope, stateKey)

      if (deps.mode === 'local-only') {
        if (!localCandidate) throw new PluginError('NO_LOCAL_SNAPSHOT', `No local XMemo snapshot found for scope=${scope}, state_key=${stateKey}.`, 'not_executed', false)
        if (restoreState) await applyLocalCandidate(deps, localCandidate, scope, stateKey, ttlSeconds)
        return toLosslessJson({
          source: 'local', stale: true, snapshot_id: localCandidate.local_id,
          state: localCandidate.state, events: boundList(localCandidate.events), todos: boundList(localCandidate.todos), decisions: boundList(localCandidate.decisions),
        })
      }

      try {
        // MemoryOS's RestartRestoreResponse does NOT carry active_state at its root — the
        // readable state lives at snapshot.active_state (a full state row: content plus
        // current_task/next_action/blocked_reason folded into its metadata, per
        // engines/workflow.py's restore_restart_snapshot and services/data_plane.py's
        // update_state). state_update is only a write confirmation ({id, memory_id, state_key,
        // version, status, expires_at}), not the restored content.
        const cloudResult = await deps.api.request('/v1/restart/restore', {
          method: 'POST', timeoutMs, write: true, signal: exec.signal, body: requestBody,
        }) as { snapshot?: { active_state?: Record<string, unknown> } } & Record<string, unknown>
        const activeState = cloudResult.snapshot?.active_state
        if (restoreState && activeState) {
          await applyCloudActiveState(deps, activeState, scope, stateKey)
        }
        return toLosslessJson({ source: 'cloud', stale: false, ...cloudResult })
      } catch (error) {
        // Cloud unavailable or queued: fall back to the local snapshot, but never claim
        // "nothing to restore" just because the local cache happens to be empty.
        if (!localCandidate) {
          throw new PluginError(
            'NO_LOCAL_SNAPSHOT',
            `XMemo cloud restore failed and no local snapshot is cached for scope=${scope}, state_key=${stateKey}. `
              + `This does not mean no cloud snapshot exists — retry once connectivity is restored. Underlying error: ${error instanceof Error ? error.message : String(error)}`,
            'not_executed',
            false,
          )
        }
        if (restoreState) await applyLocalCandidate(deps, localCandidate, scope, stateKey, ttlSeconds)
        return toLosslessJson({
          source: 'local', stale: true, snapshot_id: localCandidate.local_id,
          state: localCandidate.state, events: boundList(localCandidate.events), todos: boundList(localCandidate.todos), decisions: boundList(localCandidate.decisions),
        })
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Restore XMemo progress', kind: 'other', rawInput: args }),
  }))
}

async function applyLocalCandidate(deps: ToolDeps, candidate: SnapshotEntity, scope: string, stateKey: string, ttlSeconds: number | undefined): Promise<void> {
  if (!candidate.state) return
  await deps.localStore.mutate((store) => {
    const now = new Date().toISOString()
    const existing = findState(store, scope, stateKey)
    const entity: StateEntity = {
      ...candidate.state!,
      local_id: existing?.local_id ?? newLocalId('state'),
      cloud_id: existing?.cloud_id,
      scope,
      state_key: stateKey,
      ttl_seconds: ttlSeconds ?? candidate.state!.ttl_seconds,
      updated_at: now,
      sync_status: 'held',
    }
    return { ...store, states: existing ? store.states.map(s => (s.local_id === existing.local_id ? entity : s)) : [...store.states, entity] }
  })
}

async function applyCloudActiveState(deps: ToolDeps, activeState: Record<string, unknown>, scope: string, stateKey: string): Promise<void> {
  // MemoryOS folds current_task/next_action/blocked_reason into the state row's `metadata`
  // (services/data_plane.py's update_state) rather than keeping them top-level; `content` there
  // is the server-formatted composite text, not necessarily the original free-form content.
  const metadata = typeof activeState.metadata === 'object' && activeState.metadata !== null ? activeState.metadata as Record<string, unknown> : {}
  const field = (key: string): string | undefined => {
    const direct = activeState[key]
    if (typeof direct === 'string') return direct
    const nested = metadata[key]
    return typeof nested === 'string' ? nested : undefined
  }
  await deps.localStore.mutate((store) => {
    const now = new Date().toISOString()
    const existing = findState(store, scope, stateKey)
    const entity: StateEntity = {
      local_id: existing?.local_id ?? newLocalId('state'),
      cloud_id: typeof activeState.id === 'string' ? activeState.id : (typeof activeState.memory_id === 'string' ? activeState.memory_id : existing?.cloud_id),
      state_key: stateKey,
      scope,
      content: field('content'),
      current_task: field('current_task'),
      next_action: field('next_action'),
      blocked_reason: field('blocked_reason'),
      expires_at: typeof activeState.expires_at === 'string' ? activeState.expires_at : undefined,
      created_at: existing?.created_at ?? now,
      updated_at: now,
      sync_status: 'synced',
    }
    return { ...store, states: existing ? store.states.map(s => (s.local_id === existing.local_id ? entity : s)) : [...store.states, entity] }
  })
}
