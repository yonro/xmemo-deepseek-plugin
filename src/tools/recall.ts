import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDeps } from '../deps.ts'
import { cacheKey, compactCloudRecallItems, compactContextText, getRecallCache, localMemoryItems, mergeMemoryItems, putRecallCache } from '../recall.ts'
import type { MemoryItem } from '../recall.ts'
import { boundedInteger, optionalString, requiredString, toLosslessJson } from '../util.ts'

const RECALL_CACHE_TTL_MS = 15 * 60 * 1000

export function registerRecallTool(ctx: Context, deps: ToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'xmemo_recall',
    description: 'Read a bounded context pack by merging local matches with XMemo cloud recall. '
      + 'The readable cloud text comes back as one combined context_text block (not per item); if '
      + 'any cloud item violates an exact requested bucket or scope, the plugin omits violating '
      + 'items and blanks context_text entirely, then falls back to marked local/cached results '
      + 'when offline.',
    parameters: {
      query: { type: 'string', required: true, description: 'What context to retrieve. Up to 4000 characters.' },
      path: { type: 'string', description: "Optional path filter; defaults to '%'." },
      bucket: { type: 'string', description: "Optional bucket filter; defaults to '%'." },
      scope: { type: 'string', description: 'Optional exact scope filter; omit to search all authorized scopes.' },
      max_items: { type: 'number', description: 'Maximum returned memories, 1-20; defaults to 8.' },
      max_tokens: { type: 'number', description: 'Approximate context budget, 128-4000; defaults to 1200.' },
      prefer_working: { type: 'boolean', description: 'Prefer active working state when relevant; defaults to true.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: `${(value as { items: unknown[] }).items.length} recalled item(s).` }],
    },
    async execute(args, exec) {
      const query = requiredString(args.query, 'query', 4_000)
      const path = optionalString(args.path)
      const bucket = optionalString(args.bucket)
      const scope = optionalString(args.scope)
      const maxItems = boundedInteger(args.max_items, 8, 1, 20)
      const maxTokens = boundedInteger(args.max_tokens, 1200, 128, 4000)
      const preferWorking = args.prefer_working !== false
      const mode = await deps.resolveMode()

      const store = await deps.localStore.read()
      const localItems = localMemoryItems(store, query, { path, bucket, scope, limit: maxItems })

      if (mode === 'local-only') {
        return toLosslessJson({ source: 'local', stale: false, violations: 0, context_text: '', items: localItems.slice(0, maxItems) })
      }

      const key = cacheKey('recall', { query, path, bucket, scope, maxItems, maxTokens })
      try {
        const cloudBody = await deps.api.request('/v1/recall/context', {
          method: 'POST',
          timeoutMs: deps.config.longRequestTimeoutMs,
          signal: exec.signal,
          body: { query, path, bucket, scope, max_items: maxItems, max_tokens: maxTokens, prefer_working: preferWorking },
        }) as { items?: unknown[]; context_text?: string }
        await deps.localStore.mutate(s => putRecallCache(s, key, 'recall', cloudBody, RECALL_CACHE_TTL_MS))
        const compacted = compactCloudRecallItems(cloudBody.items ?? [], bucket, scope)
        const contextText = compactContextText(cloudBody.context_text, compacted.violations)
        if (mode === 'cloud-only') {
          return toLosslessJson({ source: 'hybrid', stale: false, violations: compacted.violations, context_text: contextText, items: compacted.items.slice(0, maxItems) })
        }
        const merged = mergeMemoryItems(compacted.items, localItems)
        return toLosslessJson({ source: 'hybrid', stale: false, violations: compacted.violations, context_text: contextText, items: merged.slice(0, maxItems) })
      } catch (error) {
        if (mode === 'cloud-only') throw error
        const cached = getRecallCache(store, key)
        if (!cached) return toLosslessJson({ source: 'local', stale: false, violations: 0, context_text: '', items: localItems.slice(0, maxItems) })
        const cachedBody = cached.payload as { items?: unknown[]; context_text?: string }
        const compacted = compactCloudRecallItems(cachedBody.items ?? [], bucket, scope)
        const contextText = compactContextText(cachedBody.context_text, compacted.violations)
        const merged: MemoryItem[] = mergeMemoryItems(compacted.items, localItems)
        return toLosslessJson({ source: 'hybrid_cache', stale: true, violations: compacted.violations, context_text: contextText, items: merged.slice(0, maxItems) })
      }
    },
    presentCall: args => ({ card: 'generic', title: 'Recall from XMemo', kind: 'search', rawInput: args }),
  }))
}
