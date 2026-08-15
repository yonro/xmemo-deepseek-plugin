/**
 * OAuth 2.1 + PKCE against MemoryOS's real production authorization server (verified live against
 * https://xmemo.dev: Dynamic Client Registration accepts a fresh loopback redirect_uri for a brand
 * new client, and /oauth/authorize accepts that client_id + PKCE + explicit `resource` and falls
 * through to /login exactly like the browser flow would). We register a new DCR client per connect
 * attempt rather than caching one — DCR exists precisely for this kind of ad hoc self-registration,
 * and skipping the cache avoids a whole extra persisted credential ref and its staleness edge cases.
 *
 * Unlike Cindy, whose *host* runs this dance generically for any plugin that declares an "OAuth
 * credential source", dsh has no such primitive (see README "Known Limitations") — this plugin runs
 * the whole flow itself: an ephemeral 127.0.0.1 HTTP listener stands in for Cindy host's loopback
 * redirect target, and the resulting token bundle is stored through the same credentials RPC already
 * used for the API key and mode (XMEMO_OAUTH), since it is the only channel genuinely open to an
 * out-of-tree plugin.
 *
 * The web GUI card cannot invoke host-side code directly (no RPC surface open to third-party plugins
 * beyond credentials.describe/set/unset — see mode.ts's header comment), so "Connect"/"Disconnect"
 * are relayed through a write-only signal credential (XMEMO_OAUTH_ACTION): the card writes a fresh
 * "connect:<nonce>" or "disconnect:<nonce>" value, and this module listens for the seam-wide
 * `credentials/updated` event (fired by every provider's set/unset — verified against
 * dsh-credentials-local's own `write()`) to react.
 */

import { randomBytes, createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { spawn } from 'node:child_process'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-credentials'
import type { PluginConfig } from './types.ts'

const OAUTH_BUNDLE_REF = 'XMEMO_OAUTH'
const OAUTH_ACTION_REF = 'XMEMO_OAUTH_ACTION'
const OAUTH_SCOPE = 'memory:read memory:write'
/** Wall-clock budget for the user to complete the browser login + consent screen. */
const CONNECT_TIMEOUT_MS = 5 * 60 * 1000
/** Refresh this far ahead of actual expiry so a slow request never races a mid-flight 401. */
const REFRESH_SKEW_MS = 60 * 1000

interface OAuthBundle {
  client_id: string
  access_token: string
  refresh_token: string
  /** ISO 8601 access-token expiry. */
  expires_at: string
  scope: string
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  scope?: string
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** PowerShell single-quoted literal (doubles embedded quotes) — mirrors deepseek-harness's own native-path-opener.ts. */
function powershellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * Best-effort cross-platform "open the user's default browser". A failure here still leaves a valid
 * authorize URL the caller could in principle surface manually, and must never take down the whole
 * host process: a spawned child's unhandled 'error' event is fatal to the entire Node process (learned
 * the hard way live-testing this — `spawn('explorer', [url])` with no error listener crashed the whole
 * dsh host on ENOENT), so every branch below attaches one. Windows goes through `powershell.exe
 * Start-Process` rather than `cmd.exe`'s `start` builtin: `cmd /c` re-tokenizes its own command line
 * with `&` as a command separator, which a query string packed with `&`-joined params would trip.
 */
function openUrlInBrowser(url: string): void {
  let child: ReturnType<typeof spawn>
  if (process.platform === 'darwin') {
    child = spawn('open', [url], { stdio: 'ignore', detached: true })
  } else if (process.platform === 'win32') {
    child = spawn('powershell.exe', ['-NoProfile', '-Command', `Start-Process ${powershellLiteral(url)}`], { stdio: 'ignore', detached: true })
  } else {
    child = spawn(process.env.BROWSER ?? 'xdg-open', [url], { stdio: 'ignore', detached: true })
  }
  child.on('error', () => {
    // best-effort only — the loopback listener stays the source of truth either way
  })
  child.unref()
}

async function registerDynamicClient(apiBaseUrl: string, redirectUri: string): Promise<string> {
  const response = await fetch(new URL('/oauth/register', apiBaseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'XMemo for DeepSeek Harness', redirect_uris: [redirectUri] }),
  })
  if (!response.ok) throw new Error(`XMemo OAuth client registration failed: HTTP ${response.status}`)
  const data = await response.json() as { client_id?: string }
  if (!data.client_id) throw new Error('XMemo OAuth client registration response is missing client_id')
  return data.client_id
}

function callbackPage(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>XMemo</title></head>`
    + `<body style="font-family:system-ui,sans-serif;background:#111;color:#eee;display:flex;`
    + `align-items:center;justify-content:center;height:100vh;margin:0;text-align:center;padding:24px">`
    + `<p style="font-size:16px;max-width:420px">${message}</p></body></html>`
}

async function listenOnLoopback(): Promise<{ server: Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('XMemo OAuth loopback listener has no assigned port'))
        return
      }
      resolve({ server, port: address.port })
    })
  })
}

/** One PKCE + Dynamic Client Registration + loopback-listener authorization attempt. */
async function runAuthorizationFlow(apiBaseUrl: string): Promise<OAuthBundle> {
  const verifier = b64url(randomBytes(32))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  const state = b64url(randomBytes(16))
  const resource = new URL('/mcp', apiBaseUrl).toString()

  const { server, port } = await listenOnLoopback()
  try {
    const redirectUri = `http://127.0.0.1:${port}/callback`
    const clientId = await registerDynamicClient(apiBaseUrl, redirectUri)

    const authorizeUrl = new URL('/oauth/authorize', apiBaseUrl)
    authorizeUrl.searchParams.set('response_type', 'code')
    authorizeUrl.searchParams.set('client_id', clientId)
    authorizeUrl.searchParams.set('redirect_uri', redirectUri)
    authorizeUrl.searchParams.set('state', state)
    authorizeUrl.searchParams.set('code_challenge', challenge)
    authorizeUrl.searchParams.set('code_challenge_method', 'S256')
    authorizeUrl.searchParams.set('scope', OAUTH_SCOPE)
    authorizeUrl.searchParams.set('resource', resource)

    const code = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('XMemo OAuth authorization timed out')), CONNECT_TIMEOUT_MS)
      // A synchronous throw in an http.Server 'request' listener is otherwise an uncaught exception
      // that kills the whole host process (same lesson as openUrlInBrowser's spawn 'error' handler).
      server.on('request', (req, res) => {
        try {
          const url = new URL(req.url ?? '/', redirectUri)
          if (url.pathname !== '/callback') {
            res.writeHead(404).end()
            return
          }
          clearTimeout(timer)
          const error = url.searchParams.get('error')
          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html' }).end(callbackPage('XMemo 连接失败，可以关闭此页面并在 DeepSeek Harness 中重试。'))
            reject(new Error(`XMemo authorization denied: ${error}`))
            return
          }
          if (url.searchParams.get('state') !== state) {
            res.writeHead(400, { 'Content-Type': 'text/html' }).end(callbackPage('XMemo 连接校验失败，可以关闭此页面。'))
            reject(new Error('XMemo OAuth state mismatch'))
            return
          }
          const returnedCode = url.searchParams.get('code')
          if (!returnedCode) {
            res.writeHead(400, { 'Content-Type': 'text/html' }).end(callbackPage('XMemo 未返回授权码，可以关闭此页面。'))
            reject(new Error('XMemo OAuth callback is missing code'))
            return
          }
          res.writeHead(200, { 'Content-Type': 'text/html' }).end(callbackPage('XMemo 已连接，可以关闭此页面并返回 DeepSeek Harness。'))
          resolve(returnedCode)
        } catch (handlerError) {
          try { res.writeHead(500).end() } catch { /* response may already be unusable */ }
          reject(handlerError instanceof Error ? handlerError : new Error(String(handlerError)))
        }
      })
      openUrlInBrowser(authorizeUrl.toString())
    })

    const tokenResponse = await fetch(new URL('/oauth/token', apiBaseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
        resource,
      }),
    })
    if (!tokenResponse.ok) throw new Error(`XMemo OAuth token exchange failed: HTTP ${tokenResponse.status}`)
    const issued = await tokenResponse.json() as TokenResponse
    return {
      client_id: clientId,
      access_token: issued.access_token,
      refresh_token: issued.refresh_token,
      expires_at: new Date(Date.now() + issued.expires_in * 1000).toISOString(),
      scope: issued.scope ?? OAUTH_SCOPE,
    }
  } finally {
    server.close()
  }
}

/**
 * Exchange a refresh token for a new access token. Refresh tokens rotate on every use (reuse of an
 * already-used one revokes the whole token family — see docs/execution's OAuth handoff), so the
 * caller must persist the newly returned refresh_token immediately and never retry with the old one.
 */
async function refreshBundle(apiBaseUrl: string, bundle: OAuthBundle): Promise<OAuthBundle> {
  const resource = new URL('/mcp', apiBaseUrl).toString()
  const response = await fetch(new URL('/oauth/token', apiBaseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: bundle.refresh_token,
      client_id: bundle.client_id,
      resource,
    }),
  })
  if (!response.ok) throw new Error(`XMemo OAuth token refresh failed: HTTP ${response.status}`)
  const issued = await response.json() as TokenResponse
  return {
    client_id: bundle.client_id,
    access_token: issued.access_token,
    refresh_token: issued.refresh_token,
    expires_at: new Date(Date.now() + issued.expires_in * 1000).toISOString(),
    scope: issued.scope ?? bundle.scope,
  }
}

async function revokeBundle(apiBaseUrl: string, bundle: OAuthBundle): Promise<void> {
  const body = new URLSearchParams({ token: bundle.refresh_token, client_id: bundle.client_id })
  try {
    await fetch(new URL('/oauth/revoke', apiBaseUrl), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
  } catch {
    // Disconnect proceeds locally regardless — an unreachable server must not strand the user
    // signed in from the plugin's point of view.
  }
}

export interface OAuthManager {
  /** A currently-valid Bearer access token, refreshing first if needed; undefined when not connected. */
  resolveAccessToken(): Promise<string | undefined>
}

export function createOAuthManager(ctx: Context, config: PluginConfig): OAuthManager {
  const bundleRef = credentialRef(OAUTH_BUNDLE_REF)
  const actionRef = credentialRef(OAUTH_ACTION_REF)
  let refreshInFlight: Promise<OAuthBundle> | undefined

  async function readBundle(): Promise<OAuthBundle | undefined> {
    const resolved = await ctx.credentials.resolve(bundleRef)
    if (!resolved?.value) return undefined
    try {
      return JSON.parse(resolved.value) as OAuthBundle
    } catch {
      return undefined
    }
  }

  async function connect(): Promise<void> {
    try {
      const bundle = await runAuthorizationFlow(config.apiBaseUrl)
      await ctx.credentials.set(bundleRef, JSON.stringify(bundle))
    } catch (error) {
      ctx.logger?.warn?.('xmemo: OAuth connect failed: %s', error instanceof Error ? error.message : String(error))
    }
  }

  async function disconnect(): Promise<void> {
    const bundle = await readBundle()
    if (bundle) await revokeBundle(config.apiBaseUrl, bundle)
    await ctx.credentials.unset(bundleRef).catch(() => {})
  }

  ctx.on('credentials/updated', (ref) => {
    if (ref !== actionRef) return
    void (async () => {
      const resolved = await ctx.credentials.resolve(actionRef).catch(() => undefined)
      const action = resolved?.value ?? ''
      if (action.startsWith('connect:')) await connect()
      else if (action.startsWith('disconnect:')) await disconnect()
    })()
  })

  return {
    async resolveAccessToken(): Promise<string | undefined> {
      const bundle = await readBundle()
      if (!bundle) return undefined
      const expiresAt = Date.parse(bundle.expires_at)
      if (Number.isFinite(expiresAt) && expiresAt - Date.now() > REFRESH_SKEW_MS) {
        return bundle.access_token
      }
      // Single-flight: concurrent calls near expiry must share one refresh, since a used refresh
      // token cannot be replayed without revoking the whole token family.
      refreshInFlight ??= refreshBundle(config.apiBaseUrl, bundle)
        .then(async (next) => {
          await ctx.credentials.set(bundleRef, JSON.stringify(next))
          return next
        })
        .catch(async (error: unknown) => {
          await ctx.credentials.unset(bundleRef).catch(() => {})
          throw error
        })
        .finally(() => { refreshInFlight = undefined })
      try {
        const refreshed = await refreshInFlight
        return refreshed.access_token
      } catch {
        return undefined
      }
    },
  }
}
