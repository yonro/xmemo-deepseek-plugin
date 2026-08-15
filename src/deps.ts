import type { ApiClient } from './http.ts'
import type { LocalStore } from './store.ts'
import type { MemoryMode, PluginConfig } from './types.ts'

/** Shared runtime dependencies every tool module needs to register its handler. */
export interface ToolDeps {
  api: ApiClient
  localStore: LocalStore
  mode: MemoryMode
  config: PluginConfig
}
