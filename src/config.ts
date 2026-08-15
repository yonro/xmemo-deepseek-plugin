/** Schemastery config for the dsh-xmemo plugin row (packages/mcp/mcp-client's z.const union pattern). */

import z from '@deepseek-ai/schemastery'
import type { PluginConfig } from './types.ts'

export type Config = PluginConfig

export const Config: z<PluginConfig> = z.object({
  /**
   * `hybrid` writes locally first (durable outbox) and syncs to XMemo cloud; `local-only` never
   * calls the cloud; `cloud-only` skips local persistence and calls XMemo directly.
   */
  mode: z.union([z.const('hybrid'), z.const('local-only'), z.const('cloud-only')]).default('hybrid'),
  /** Credential reference (env var / $DSH_HOME/.credentials.yaml key) holding the MemoryOS API key. */
  apiKeyCredential: z.string().default('XMEMO_KEY'),
  /** MemoryOS API base URL. Defaults to the production XMemo deployment. */
  apiBaseUrl: z.string().default('https://xmemo.dev'),
  /** Default `scope` tag applied when a tool call omits one. */
  defaultScope: z.string().default('dsh'),
  /** Sent as the `X-Memory-OS-Agent-ID` header on every cloud request. */
  agentId: z.string().default('dsh'),
  /** Default per-request timeout in milliseconds. */
  requestTimeoutMs: z.number().step(1).min(1).default(30_000),
  /** Timeout for slower calls (recall, restore) in milliseconds. */
  longRequestTimeoutMs: z.number().step(1).min(1).default(60_000),
}) as unknown as z<PluginConfig>
