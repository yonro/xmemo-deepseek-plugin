import type { ApiClient } from './http.ts'
import type { ModeResolver } from './mode.ts'
import type { LocalStore } from './store.ts'
import type { PluginConfig } from './types.ts'

/**
 * Shared runtime dependencies every tool module needs to register its handler. `resolveMode` is
 * async and re-checked per call (mirrors `ctx.credentials`' own "resolve per operation" contract)
 * so a mode change saved through the web GUI card takes effect on the very next tool call, not
 * just at boot — call it once at the top of each tool's `execute()` and use the resolved value
 * for that call, matching auth.ts's `ApiKeyResolver`.
 */
export interface ToolDeps {
  api: ApiClient
  localStore: LocalStore
  resolveMode: ModeResolver
  config: PluginConfig
}
