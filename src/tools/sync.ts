import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDeps } from '../deps.ts'
import { discardFailed, outboxSummary, syncOutboxInternal } from '../outbox.ts'
import { boundedInteger } from '../util.ts'

export function registerSyncTool(ctx: Context, deps: ToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'xmemo_sync',
    description: 'Inspect, push, or explicitly discard permanently failed XMemo outbox entries. '
      + 'Push safely replays idempotent pending writes; include_held also replays non-idempotent or '
      + 'previously uncertain writes and must be used only when the user explicitly accepts duplicate '
      + 'risk. discard_failed never removes held writes.',
    parameters: {
      action: { type: 'string', enum: ['status', 'push', 'discard_failed'], description: "Inspect queue status, push eligible writes, or explicitly remove permanently failed local entries; defaults to 'status'." },
      include_held: { type: 'boolean', description: 'Also replay held non-idempotent or uncertain writes. Defaults to false and requires explicit user intent.' },
      limit: { type: 'number', description: 'Maximum queued writes to inspect for pushing, 1-50; defaults to 10.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args) {
      const action = args.action === 'push' || args.action === 'discard_failed' ? args.action : 'status'
      const includeHeld = args.include_held === true
      const limit = boundedInteger(args.limit, 10, 1, 50)
      const mode = await deps.resolveMode()

      if (action === 'status') {
        const store = await deps.localStore.read()
        return { mode, queue: outboxSummary(store), last_updated_at: store.updated_at }
      }

      if (action === 'discard_failed') {
        const discarded = await discardFailed(deps.localStore, limit)
        return { discarded: discarded.map(e => ({ local_id: e.local_id, operation: e.operation, error: e.last_error })) }
      }

      if (mode !== 'hybrid') {
        return { note: `xmemo_sync push is a no-op in ${mode} mode.`, mode }
      }
      const result = await syncOutboxInternal({ localStore: deps.localStore, api: deps.api, mode }, { includeHeld, limit })
      const store = await deps.localStore.read()
      return { ...result, queue: outboxSummary(store) }
    },
    presentCall: args => ({ card: 'generic', title: 'Sync XMemo outbox', kind: 'other', rawInput: args }),
  }))
}
