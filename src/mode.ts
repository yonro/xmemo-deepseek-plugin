/**
 * Runtime-overridable memory mode: like the API key, the effective mode is resolved through
 * `ctx.credentials` (a `XMEMO_MODE` reference holding one of the three mode literals) so the web
 * GUI's plugin card can offer a real, saved selector for it — the same channel `auth.ts` uses for
 * the API key, since it is the only persistence path genuinely open to an out-of-tree plugin (see
 * README "Known Limitations"). Falls back to the composed `config.mode` when unset or invalid.
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { MemoryMode, PluginConfig } from './types.ts'

const MODE_VALUES: readonly MemoryMode[] = ['hybrid', 'local-only', 'cloud-only']

function isMemoryMode(value: string): value is MemoryMode {
  return (MODE_VALUES as readonly string[]).includes(value)
}

export type ModeResolver = () => Promise<MemoryMode>

export function createModeResolver(ctx: Context, config: PluginConfig): ModeResolver {
  const ref = credentialRef('XMEMO_MODE')
  return async () => {
    const resolved = await ctx.credentials.resolve(ref).catch(() => undefined)
    if (resolved?.value !== undefined && isMemoryMode(resolved.value)) return resolved.value
    return config.mode
  }
}
