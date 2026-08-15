/**
 * HTTP client for the XMemo cloud API. Ported from xmemo-cindy-plugin's apiRequest/httpError
 * (main.js:99-135, 306-369), with one structural change: main.js relied on the Cindy host to inject
 * `Authorization` based on request hostname (ghost.json network.secrets[].inject); a standalone dsh
 * plugin has no such host, so this module resolves and attaches the bearer token itself (auth.ts).
 */

import type { ApiKeyResolver } from './auth.ts'
import { PluginError } from './types.ts'
import type { PluginConfig } from './types.ts'

export interface RequestSpec {
  method?: 'GET' | 'POST'
  body?: Record<string, unknown>
  timeoutMs?: number
  /** True for a mutating call: a retryable failure reports outcome 'unknown' instead of 'not_executed'. */
  write?: boolean
  signal?: AbortSignal
}

export interface ApiClient {
  request<T = unknown>(path: string, spec?: RequestSpec): Promise<T>
}

function detailFrom(data: unknown, fallback: string): string {
  if (typeof data === 'string' && data.trim()) return data.trim().slice(0, 500)
  if (typeof data !== 'object' || data === null) return fallback
  const record = data as Record<string, unknown>
  if (typeof record.detail === 'string' && record.detail.trim()) return record.detail.trim().slice(0, 500)
  // FastAPI 422 validation errors: detail is [{ loc, msg, type }, ...].
  if (Array.isArray(record.detail) && record.detail.length > 0) {
    const messages = record.detail
      .map((item) => {
        if (typeof item !== 'object' || item === null) return undefined
        const entry = item as Record<string, unknown>
        const loc = Array.isArray(entry.loc) ? entry.loc.join('.') : undefined
        const msg = typeof entry.msg === 'string' ? entry.msg : undefined
        return msg ? (loc ? `${loc}: ${msg}` : msg) : undefined
      })
      .filter((message): message is string => message !== undefined)
    if (messages.length > 0) return messages.join('; ').slice(0, 500)
  }
  if (typeof record.detail === 'object' && record.detail !== null && !Array.isArray(record.detail)) {
    const message = (record.detail as Record<string, unknown>).message
    if (typeof message === 'string') return message.slice(0, 500)
  }
  if (typeof record.message === 'string' && record.message.trim()) return record.message.trim().slice(0, 500)
  if (typeof record.raw === 'string' && record.raw.trim()) return record.raw.trim().slice(0, 500)
  return fallback
}

function httpError(status: number, data: unknown, write: boolean): PluginError {
  const detail = detailFrom(data, 'MemoryOS request failed')
  if (status === 401 || status === 403) {
    // MemoryOS returns 403 for an invalid/inactive/expired key and 401 only when no
    // credentials were sent at all (auth/api_key.py) — both map to AUTH_REQUIRED here.
    return new PluginError(
      'AUTH_REQUIRED',
      `MemoryOS authorization failed: ${detail}`,
      'not_executed',
      false,
    )
  }
  if (status === 404) return new PluginError('NOT_FOUND', detail, 'not_executed', false)
  if (status === 409) return new PluginError('CONFLICT', detail, 'not_executed', false)
  if (status === 429) return new PluginError('RATE_LIMITED', detail, 'not_executed', true)
  if (status >= 500) return new PluginError('XMEMO_SERVER_ERROR', detail, write ? 'unknown' : 'not_executed', true)
  return new PluginError(`HTTP_${status}`, detail, 'not_executed', false)
}

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { raw: text.slice(0, 500) }
  }
}

function combineSignals(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals)
  const controller = new AbortController()
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      break
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true })
  }
  return controller.signal
}

export function createApiClient(config: PluginConfig, resolveApiKey: ApiKeyResolver, instanceId: string): ApiClient {
  return {
    async request<T>(path: string, spec: RequestSpec = {}): Promise<T> {
      const write = spec.write ?? false
      const apiKey = await resolveApiKey()
      const timeoutMs = spec.timeoutMs ?? config.requestTimeoutMs
      const timeoutSignal = AbortSignal.timeout(timeoutMs)
      const signal = spec.signal ? combineSignals([timeoutSignal, spec.signal]) : timeoutSignal

      let response: Response
      try {
        response = await fetch(new URL(path, config.apiBaseUrl), {
          method: spec.method ?? (spec.body ? 'POST' : 'GET'),
          headers: {
            Accept: 'application/json',
            // X-API-Key is MemoryOS's primary auth header (auth/api_key.py); Authorization: Bearer
            // is only its fallback. Sending X-API-Key directly avoids depending on that fallback path.
            'X-API-Key': apiKey,
            'X-Memory-OS-Agent-ID': config.agentId,
            'X-Memory-OS-Agent-Instance-ID': instanceId,
            ...(spec.body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: spec.body ? JSON.stringify(spec.body) : undefined,
          signal,
        })
      } catch (error) {
        if (spec.signal?.aborted) throw error
        throw new PluginError(
          'NETWORK_ERROR',
          error instanceof Error ? error.message : 'network request to XMemo failed',
          write ? 'unknown' : 'not_executed',
          true,
        )
      }

      if (!response.ok) {
        const data = await safeJson(response)
        throw httpError(response.status, data, write)
      }
      return (await safeJson(response)) as T
    },
  }
}
