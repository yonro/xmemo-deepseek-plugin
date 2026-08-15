/** Shared state-slot upsert used by both xmemo_update_state and the state half of xmemo_save_progress. */

import type { ApiClient } from './http.ts'
import { hybridWrite } from './outbox.ts'
import type { HybridWriteResult } from './outbox.ts'
import { newLocalId } from './store.ts'
import type { LocalStore } from './store.ts'
import type { MemoryMode, StateEntity, Store } from './types.ts'

export interface StateWriteArgs {
  content?: string
  currentTask?: string
  nextAction?: string
  blockedReason?: string
  stateKey: string
  scope: string
  ttlSeconds: number
}

export function findState(store: Store, scope: string, stateKey: string): StateEntity | undefined {
  return store.states.find(s => s.scope === scope && s.state_key === stateKey)
}

export async function writeState(
  deps: { localStore: LocalStore; api: ApiClient; mode: MemoryMode; timeoutMs: number },
  args: StateWriteArgs,
): Promise<HybridWriteResult> {
  const store = await deps.localStore.read()
  const existing = findState(store, args.scope, args.stateKey)
  const localId = existing?.local_id ?? newLocalId('state')

  return hybridWrite({ localStore: deps.localStore, api: deps.api, mode: deps.mode }, {
    operation: 'update_state',
    path: '/v1/update_state',
    idempotent: true,
    targetKind: 'state',
    localId,
    timeoutMs: deps.timeoutMs,
    body: {
      state_key: args.stateKey,
      scope: args.scope,
      content: args.content,
      current_task: args.currentTask,
      next_action: args.nextAction,
      blocked_reason: args.blockedReason,
      ttl_seconds: args.ttlSeconds,
    },
    project: (s, id, now) => {
      const entity: StateEntity = {
        local_id: id,
        cloud_id: existing?.cloud_id,
        state_key: args.stateKey,
        scope: args.scope,
        content: args.content,
        current_task: args.currentTask,
        next_action: args.nextAction,
        blocked_reason: args.blockedReason,
        ttl_seconds: args.ttlSeconds,
        expires_at: args.ttlSeconds > 0 ? new Date(Date.now() + args.ttlSeconds * 1000).toISOString() : undefined,
        created_at: existing?.created_at ?? now,
        updated_at: now,
        sync_status: 'pending',
      }
      return { ...s, states: existing ? s.states.map(state => (state.local_id === id ? entity : state)) : [...s.states, entity] }
    },
    applyCloudResult: (s, id, cloudBody, now) => {
      const record = cloudBody as Record<string, unknown> | null
      const expiresAt = record && typeof record.expires_at === 'string' ? record.expires_at : undefined
      return { ...s, states: s.states.map(state => (state.local_id === id ? { ...state, expires_at: expiresAt ?? state.expires_at, updated_at: now } : state)) }
    },
  })
}
