import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'
import type { ToolDeps } from '../deps.ts'
import { outboxSummary } from '../outbox.ts'
import { PluginError } from '../types.ts'

export function registerStatusTool(ctx: Context, deps: ToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'xmemo_status',
    description: 'Read local-store health, synchronization queue counts, active memory, and XMemo '
      + 'cloud authorization without changing memory.',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(_args, exec) {
      const store = await deps.localStore.read()
      const queue = outboxSummary(store)
      const local = {
        revision: store.revision,
        memories: store.memories.length,
        states: store.states.length,
        snapshots: store.snapshots.length,
        pending_writes: queue.pending,
        held_writes: queue.held,
        failed_writes: queue.failed,
      }

      if (deps.mode === 'local-only') {
        return { mode: deps.mode, local }
      }

      try {
        const cloud = await deps.api.request('/v1/auth/token/validate', { method: 'GET', timeoutMs: 15_000, signal: exec.signal })
        return { mode: deps.mode, local, cloud: { status: 'connected', ...(cloud as object) } }
      } catch (error) {
        if (deps.mode === 'cloud-only') throw error
        const message = error instanceof PluginError ? error.message : String(error)
        return { mode: deps.mode, local, cloud: { status: 'unavailable', error: message } }
      }
    },
    presentCall: () => ({ card: 'generic', title: 'XMemo status', kind: 'other' }),
  }))
}
