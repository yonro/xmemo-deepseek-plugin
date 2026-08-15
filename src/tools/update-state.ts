import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDeps } from '../deps.ts'
import { writeState } from '../state-write.ts'
import { PluginError } from '../types.ts'
import { boundedInteger, optionalString } from '../util.ts'

export function registerUpdateStateTool(ctx: Context, deps: ToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'xmemo_update_state',
    description: 'Create or replace one scoped local/cloud working-state slot without a restart '
      + 'snapshot. Use after a milestone or when the next action or blocker changes. Its stable state '
      + 'key allows safe cloud replay.',
    parameters: {
      content: { type: 'string', description: 'Optional free-form state summary or handoff evidence. Up to 20000 characters.' },
      current_task: { type: 'string', description: 'Current task and verified present state. Up to 12000 characters.' },
      next_action: { type: 'string', description: 'Exact next action. Up to 8000 characters.' },
      blocked_reason: { type: 'string', description: 'Current blocker, if any. Up to 8000 characters.' },
      state_key: { type: 'string', description: 'Stable state slot; defaults to active_task.' },
      scope: { type: 'string', description: 'Stable scope; defaults to the plugin default scope.' },
      ttl_seconds: { type: 'number', description: 'State lifetime in seconds, 0-2592000; defaults to 604800. Zero means no expiry.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: `Saved state (${(value as { storage?: { cloud?: string } }).storage?.cloud ?? 'local'}).` }],
    },
    async execute(args) {
      const content = optionalString(args.content)
      const currentTask = optionalString(args.current_task)
      const nextAction = optionalString(args.next_action)
      const blockedReason = optionalString(args.blocked_reason)
      if (!content && !currentTask && !nextAction && !blockedReason) {
        throw new PluginError('INVALID_ARGUMENT', 'At least one of content, current_task, next_action, or blocked_reason is required.', 'not_executed', false)
      }
      const stateKey = optionalString(args.state_key) ?? 'active_task'
      const scope = optionalString(args.scope) ?? deps.config.defaultScope
      const ttlSeconds = boundedInteger(args.ttl_seconds, 604_800, 0, 2_592_000)
      const mode = await deps.resolveMode()

      const result = await writeState({ localStore: deps.localStore, api: deps.api, mode, timeoutMs: deps.config.requestTimeoutMs }, {
        content, currentTask, nextAction, blockedReason, stateKey, scope, ttlSeconds,
      })

      return {
        state_id: result.cloudId ?? result.localId,
        memory_id: result.cloudId,
        status: result.storage.queueStatus ?? 'synced',
        storage: result.storage,
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Update XMemo state', kind: 'other', rawInput: args }),
  }))
}
