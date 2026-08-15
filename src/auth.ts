/**
 * API-key auth only for v1 (see README "Known Limitations" for the deferred OAuth PKCE path).
 * Mirrors packages/web/web-search-deepseek's own credentialRef + ctx.credentials.resolve() pattern.
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-credentials'
import { PluginError } from './types.ts'
import type { PluginConfig } from './types.ts'

export type ApiKeyResolver = () => Promise<string>

export function createApiKeyResolver(ctx: Context, config: PluginConfig): ApiKeyResolver {
  const ref = credentialRef(config.apiKeyCredential)
  return async () => {
    const resolved = await ctx.credentials.resolve(ref)
    if (!resolved?.value) {
      throw new PluginError(
        'AUTH_REQUIRED',
        `XMemo API key not configured. Set the ${config.apiKeyCredential} credential `
          + '(environment variable, or $DSH_HOME/.credentials.yaml) to an API key from '
          + 'https://xmemo.dev/me#api-keys.',
        'not_executed',
        false,
      )
    }
    return resolved.value
  }
}
