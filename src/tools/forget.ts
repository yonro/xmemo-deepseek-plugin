import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDeps } from '../deps.ts'
import { PluginError } from '../types.ts'
import type { Store } from '../types.ts'
import { optionalString, requiredString } from '../util.ts'

function removeMemoryByReference(store: Store, reference: string): { store: Store; removed: boolean } {
  const match = store.memories.find(m => m.local_id === reference || m.cloud_id === reference)
  if (!match) return { store, removed: false }
  return {
    removed: true,
    store: {
      ...store,
      memories: store.memories.filter(m => m.local_id !== match.local_id),
      outbox: store.outbox.filter(e => e.target_local_id !== match.local_id),
      recall_cache: [],
    },
  }
}

export function registerForgetTool(ctx: Context, deps: ToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'xmemo_forget',
    description: 'Remove one exact memory reference. Defaults to a recoverable soft deletion. '
      + 'Permanent hard deletion requires an explicit hard mode plus confirm_hard_delete=true after '
      + 'the user confirms; it is never retried automatically.',
    parameters: {
      memory_id: { type: 'string', required: true, description: 'Exact memory ID or vector ID returned by xmemo_recall or xmemo_remember. Never infer an ID from content.' },
      mode: { type: 'string', enum: ['soft', 'hard'], description: "'soft' is recoverable and the default. 'hard' is permanent and requires explicit confirmation." },
      confirm_hard_delete: { type: 'boolean', description: 'Must be true only after the user explicitly confirms permanent deletion of this exact memory.' },
      reason: { type: 'string', description: 'Optional concise deletion reason for the audit trail. Up to 1000 characters.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: `Forgot memory (${(value as { mode: string }).mode}).` }],
    },
    async execute(args, exec) {
      const memoryId = requiredString(args.memory_id, 'memory_id')
      const mode = args.mode === 'hard' ? 'hard' : 'soft'
      if (mode === 'hard' && args.confirm_hard_delete !== true) {
        throw new PluginError('CONFIRMATION_REQUIRED', 'Hard deletion requires confirm_hard_delete=true after the user explicitly confirms.', 'not_executed', false)
      }
      const reason = optionalString(args.reason)
      const memoryMode = await deps.resolveMode()

      if (memoryMode === 'local-only') {
        let removed = false
        await deps.localStore.mutate((store) => {
          const outcome = removeMemoryByReference(store, memoryId)
          removed = outcome.removed
          return outcome.store
        })
        if (!removed) throw new PluginError('NOT_FOUND', `No local memory found matching ${memoryId}.`, 'not_executed', false)
        return { memory_id: memoryId, mode, local: true, cloud: false }
      }

      await deps.api.request(`/v1/memories/${encodeURIComponent(memoryId)}/forget`, {
        method: 'POST',
        timeoutMs: deps.config.requestTimeoutMs,
        write: true,
        signal: exec.signal,
        body: { mode: mode === 'hard' ? 'hard_delete' : 'soft_delete', reason },
      })

      if (memoryMode !== 'cloud-only') {
        await deps.localStore.mutate(store => removeMemoryByReference(store, memoryId).store)
      }

      return { memory_id: memoryId, mode, local: memoryMode !== 'cloud-only', cloud: true }
    },
    presentCall: args => ({ card: 'generic', title: 'Forget XMemo memory', kind: 'other', rawInput: args }),
  }))
}
