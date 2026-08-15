import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDeps } from '../deps.ts'
import { listWithCache } from '../list.ts'
import type { EventEntity } from '../types.ts'
import { boundedInteger, optionalIsoTimestamp, optionalString, queryPath, toLosslessJson } from '../util.ts'

interface TimelineItem {
  id: string
  event_type: string
  scope: string
  content: string
  occurred_at: string
  session_id?: string
  importance: number
  confidence: number
  source: 'local' | 'cloud'
}

function extractCloudEvents(cloudBody: unknown): TimelineItem[] {
  const record = cloudBody as Record<string, unknown> | null
  const raw = Array.isArray(record?.events) ? record!.events : Array.isArray(record?.items) ? record!.items : []
  return (raw as Record<string, unknown>[]).map(item => ({
    id: String(item.id ?? item.event_id ?? ''),
    event_type: String(item.event_type ?? 'event'),
    scope: String(item.scope ?? ''),
    content: String(item.content ?? ''),
    occurred_at: String(item.occurred_at ?? ''),
    session_id: typeof item.session_id === 'string' ? item.session_id : undefined,
    importance: typeof item.importance === 'number' ? item.importance : 0.5,
    confidence: typeof item.confidence === 'number' ? item.confidence : 0.95,
    source: 'cloud' as const,
  }))
}

function localEventItem(event: EventEntity): TimelineItem {
  return {
    id: event.cloud_id ?? event.local_id,
    event_type: event.event_type,
    scope: event.scope,
    content: event.content,
    occurred_at: event.occurred_at,
    session_id: event.session_id,
    importance: event.importance,
    confidence: event.confidence,
    source: 'local',
  }
}

export function registerListTimelineTool(ctx: Context, deps: ToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'xmemo_list_timeline',
    description: 'Read recent authorized XMemo timeline events newest first without changing memory. '
      + 'Use to reconstruct recent work history or inspect milestones; use xmemo_recall for semantic '
      + 'context and xmemo_restore_progress for a restart checkpoint.',
    parameters: {
      limit: { type: 'number', description: 'Maximum events, 1-100; defaults to 20.' },
      bucket: { type: 'string', description: "Bucket filter; defaults to 'work'." },
      scope: { type: 'string', description: 'Optional exact scope filter.' },
      session_id: { type: 'string', description: 'Optional exact session filter.' },
      event_type: { type: 'string', description: 'Optional exact event type filter.' },
      since: { type: 'string', description: 'Optional ISO 8601 lower time bound.' },
      until: { type: 'string', description: 'Optional ISO 8601 upper time bound.' },
      status: { type: 'string', description: "Memory status filter; defaults to 'active'." },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: `${(value as { items: unknown[] }).items.length} timeline event(s).` }],
    },
    async execute(args, exec) {
      const limit = boundedInteger(args.limit, 20, 1, 100)
      const bucket = optionalString(args.bucket) ?? 'work'
      const scope = optionalString(args.scope)
      const sessionId = optionalString(args.session_id)
      const eventType = optionalString(args.event_type)
      const since = optionalIsoTimestamp(args.since, 'since')
      const until = optionalIsoTimestamp(args.until, 'until')
      const status = optionalString(args.status) ?? 'active'
      const mode = await deps.resolveMode()

      const result = await listWithCache<TimelineItem>({ api: deps.api, localStore: deps.localStore, mode }, {
        cacheKind: 'timeline',
        cacheParams: { bucket, scope, sessionId, eventType, since, until, status },
        cloudPath: queryPath('/v1/timeline', { limit, bucket, scope, session_id: sessionId, event_type: eventType, since, until, status }),
        timeoutMs: deps.config.requestTimeoutMs,
        signal: exec.signal,
        localItems: async () => {
          const store = await deps.localStore.read()
          return store.events
            .filter(e => (scope === undefined || e.scope === scope) && (sessionId === undefined || e.session_id === sessionId) && (eventType === undefined || e.event_type === eventType))
            .filter(e => (since === undefined || e.occurred_at >= since) && (until === undefined || e.occurred_at <= until))
            .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))
            .slice(0, limit)
            .map(localEventItem)
        },
        extractCloudItems: extractCloudEvents,
        mergeAndDedupe: (cloudItems, localItems) => {
          const seen = new Set(cloudItems.map(i => i.id))
          const merged = [...cloudItems, ...localItems.filter(i => !seen.has(i.id))]
          return merged.sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1)).slice(0, limit)
        },
      })

      return toLosslessJson(result)
    },
    presentCall: args => ({ card: 'generic', title: 'List XMemo timeline', kind: 'other', rawInput: args }),
  }))
}
