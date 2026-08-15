import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type { ToolDeps } from '../deps.ts'
import { hybridWrite } from '../outbox.ts'
import { redactCredentialLikeText } from '../redact.ts'
import { newLocalId } from '../store.ts'
import type { EventEntity } from '../types.ts'
import { boundedNumber, optionalIsoTimestamp, optionalString, requiredString } from '../util.ts'

export function registerRecordEventTool(ctx: Context, deps: ToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'xmemo_record_event',
    description: 'Append one durable timeline event to XMemo. Use for milestones, releases, '
      + 'handoffs, incidents, validation results, or other history that should remain ordered; this '
      + 'does not replace active state. Obvious credential-like values are redacted locally, but '
      + 'callers must still avoid secrets.',
    parameters: {
      content: { type: 'string', required: true, description: 'Event summary with enough context to understand it later. Do not include credentials; obvious credential-like values are redacted before storage. Up to 20000 characters.' },
      event_type: { type: 'string', description: 'Stable event category such as milestone, release, handoff, incident, or validation; defaults to event.' },
      occurred_at: { type: 'string', description: 'Optional ISO 8601 event time; omit to use server time.' },
      session_id: { type: 'string', description: 'Optional session ID when no harness session is available.' },
      scope: { type: 'string', description: 'Stable scope; defaults to the plugin default scope.' },
      importance: { type: 'number', description: 'Optional importance from 0 to 1; defaults to 0.5.' },
      confidence: { type: 'number', description: 'Optional confidence from 0 to 1; defaults to 0.95.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: `Recorded event (${(value as { storage?: { cloud?: string } }).storage?.cloud ?? 'local'}).` }],
    },
    async execute(args, exec) {
      const content = requiredString(args.content, 'content', 20_000)
      const { text: redactedContent, redactions } = redactCredentialLikeText(content)
      const eventType = optionalString(args.event_type) ?? 'event'
      const occurredAt = optionalIsoTimestamp(args.occurred_at, 'occurred_at') ?? new Date().toISOString()
      const sessionId = exec.agent?.session.id ?? optionalString(args.session_id)
      const scope = optionalString(args.scope) ?? deps.config.defaultScope
      const importance = boundedNumber(args.importance, 0.5, 0, 1)
      const confidence = boundedNumber(args.confidence, 0.95, 0, 1)
      const localId = newLocalId('event')

      const result = await hybridWrite({ localStore: deps.localStore, api: deps.api, mode: deps.mode }, {
        operation: 'record_event',
        path: '/v1/timeline/events',
        idempotent: false,
        targetKind: 'event',
        localId,
        timeoutMs: deps.config.requestTimeoutMs,
        body: {
          content: redactedContent,
          event_type: eventType,
          occurred_at: occurredAt,
          session_id: sessionId,
          scope,
          path: 'dsh/timeline',
          importance,
          confidence,
          metadata: redactions.length ? { client_redactions: redactions } : undefined,
        },
        project: (s, id, now) => {
          const entity: EventEntity = {
            local_id: id,
            event_type: eventType,
            scope,
            path: 'dsh/timeline',
            content: redactedContent,
            occurred_at: occurredAt,
            session_id: sessionId,
            importance,
            confidence,
            created_at: now,
            updated_at: now,
            sync_status: 'pending',
          }
          return { ...s, events: [...s.events, entity] }
        },
      })

      return { event_id: result.cloudId ?? result.localId, redactions, storage: result.storage }
    },
    presentCall: args => ({ card: 'generic', title: 'Record XMemo event', kind: 'other', rawInput: args }),
  }))
}
