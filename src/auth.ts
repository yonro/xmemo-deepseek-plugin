/**
 * Resolves the header to send on every XMemo request, preferring a connected OAuth session
 * (src/oauth.ts) over the static API key when both are present — matching the "single active auth
 * source" guidance from MemoryOS's own Cindy OAuth handoff doc, so a request never carries both an
 * `Authorization: Bearer` and an `X-API-Key` header at once. Mirrors
 * packages/web/web-search-deepseek's own credentialRef + ctx.credentials.resolve() pattern for the
 * API-key fallback path.
 */

import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-credentials'
import type { OAuthManager } from './oauth.ts'
import { PluginError } from './types.ts'
import type { PluginConfig } from './types.ts'

export interface ResolvedAuth {
  header: 'Authorization' | 'X-API-Key'
  value: string
}

export type AuthResolver = () => Promise<ResolvedAuth>

export function createAuthResolver(ctx: Context, config: PluginConfig, oauth: OAuthManager): AuthResolver {
  const ref = credentialRef(config.apiKeyCredential)
  return async () => {
    const accessToken = await oauth.resolveAccessToken()
    if (accessToken) return { header: 'Authorization', value: `Bearer ${accessToken}` }

    const resolved = await ctx.credentials.resolve(ref)
    if (resolved?.value) return { header: 'X-API-Key', value: resolved.value }

    throw new PluginError(
      'AUTH_REQUIRED',
      'XMemo is not connected. Connect an XMemo account from the web GUI\'s plugin card, or set the '
        + `${config.apiKeyCredential} credential (environment variable, or $DSH_HOME/.credentials.yaml) `
        + 'to an API key from https://xmemo.dev/me#api-keys.',
      'not_executed',
      false,
    )
  }
}
