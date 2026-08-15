/**
 * Native DeepSeek Harness (dsh) plugin for XMemo: hybrid local + cloud memory, ported from
 * xmemo-cindy-plugin. See README for architecture notes and known limitations (API-key-only auth,
 * no encryption at rest, single in-process store lock).
 * @module dsh-xmemo
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-tools'
import { createApiKeyResolver } from './auth.ts'
import type { Config } from './config.ts'
import { createApiClient } from './http.ts'
import { loadOrCreateInstanceId } from './identity.ts'
import { createModeResolver } from './mode.ts'
import { defaultDataDir, LocalStore } from './store.ts'
import { registerCreateDecisionTool, registerListDecisionsTool, registerResolveDecisionTool } from './tools/decisions.ts'
import { registerForgetTool } from './tools/forget.ts'
import { registerListTimelineTool } from './tools/list-timeline.ts'
import { registerRecallTool } from './tools/recall.ts'
import { registerRecordEventTool } from './tools/record-event.ts'
import { registerRememberTool } from './tools/remember.ts'
import { registerSaveProgressTool, registerRestoreProgressTool } from './tools/progress.ts'
import { registerStatusTool } from './tools/status.ts'
import { registerSyncTool } from './tools/sync.ts'
import { registerCompleteTodoTool, registerCreateTodoTool, registerListTodosTool } from './tools/todos.ts'
import { registerUpdateStateTool } from './tools/update-state.ts'
import type { ToolDeps } from './deps.ts'

export { Config } from './config.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'xmemo'

/** Services required by this plugin: the tool registry and the credential-reference seam. */
export const inject = ['tools', 'credentials']

/**
 * Resolve the instance id and wire the local store, HTTP client, and every xmemo_* tool onto
 * `ctx.tools`. Remains `async`: Cordis treats a plain async function's returned Promise as startup
 * work to await before activation completes (see packages/mcp/mcp-client's apply for the same shape).
 * @param ctx - plugin context carrying `ctx.tools` and `ctx.credentials`.
 * @param config - resolved plugin configuration (mode, credential reference, base URL, defaults).
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const dataDir = defaultDataDir()
  const localStore = new LocalStore(dataDir)
  const instanceId = await loadOrCreateInstanceId(dataDir)
  const resolveApiKey = createApiKeyResolver(ctx, config)
  const api = createApiClient(config, resolveApiKey, instanceId)
  const resolveMode = createModeResolver(ctx, config)

  const deps: ToolDeps = { api, localStore, resolveMode, config }

  registerStatusTool(ctx, deps)
  registerUpdateStateTool(ctx, deps)
  registerRecordEventTool(ctx, deps)
  registerListTimelineTool(ctx, deps)
  registerRememberTool(ctx, deps)
  registerRecallTool(ctx, deps)
  registerForgetTool(ctx, deps)
  registerCreateTodoTool(ctx, deps)
  registerListTodosTool(ctx, deps)
  registerCompleteTodoTool(ctx, deps)
  registerCreateDecisionTool(ctx, deps)
  registerListDecisionsTool(ctx, deps)
  registerResolveDecisionTool(ctx, deps)
  registerSaveProgressTool(ctx, deps)
  registerRestoreProgressTool(ctx, deps)
  registerSyncTool(ctx, deps)
}
