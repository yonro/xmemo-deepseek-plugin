import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDeps } from '../deps.ts'
import { hybridWrite } from '../outbox.ts'
import { redactCredentialLikeText } from '../redact.ts'
import { newLocalId } from '../store.ts'
import type { MemoryEntity } from '../types.ts'
import { optionalString, requiredString } from '../util.ts'

const MEMORY_TYPES = ['auto', 'semantic', 'episodic', 'procedural', 'working', 'identity'] as const

export function registerRememberTool(ctx: Context, deps: ToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'xmemo_remember',
    description: 'Write one durable memory locally and, in hybrid mode, synchronize it to XMemo with '
      + 'a stable semantic key. Use only for information the user wants retained; this never deletes '
      + 'an existing memory.',
    parameters: {
      content: { type: 'string', required: true, description: 'The complete fact, decision, preference, or handoff knowledge to retain. Do not include credentials. Up to 50000 characters.' },
      path: { type: 'string', description: "Optional logical path; defaults to 'dsh/memory'." },
      bucket: { type: 'string', description: "Optional XMemo bucket; defaults to 'private'." },
      scope: { type: 'string', description: 'Optional stable scope; defaults to the plugin default scope.' },
      memory_type: { type: 'string', enum: [...MEMORY_TYPES], description: "Memory classification; defaults to 'auto'." },
      semantic_key: { type: 'string', description: 'Optional stable deduplication key for an evolving fact.' },
      importance: { type: 'number', description: 'Optional importance from 0 to 1.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: `Remembered (${(value as { storage?: { cloud?: string } }).storage?.cloud ?? 'local'}).` }],
    },
    async execute(args) {
      const content = requiredString(args.content, 'content', 50_000)
      const { text: redactedContent, redactions } = redactCredentialLikeText(content)
      const path = optionalString(args.path) ?? 'dsh/memory'
      const bucket = optionalString(args.bucket) ?? 'private'
      const scope = optionalString(args.scope) ?? deps.config.defaultScope
      const memoryType = (typeof args.memory_type === 'string' && (MEMORY_TYPES as readonly string[]).includes(args.memory_type))
        ? args.memory_type
        : 'auto'
      const importance = typeof args.importance === 'number' ? Math.min(1, Math.max(0, args.importance)) : undefined
      const localId = newLocalId('memory')
      const semanticKey = optionalString(args.semantic_key) ?? `dsh-local:${localId}`

      const result = await hybridWrite({ localStore: deps.localStore, api: deps.api, mode: deps.mode }, {
        operation: 'remember',
        path: '/v1/remember',
        idempotent: true,
        targetKind: 'memory',
        localId,
        timeoutMs: deps.config.requestTimeoutMs,
        body: { content: redactedContent, path, bucket, scope, memory_type: memoryType, semantic_key: semanticKey, importance, dedupe: true },
        project: (s, id, now) => {
          const entity: MemoryEntity = {
            local_id: id,
            path,
            bucket,
            scope,
            memory_type: memoryType,
            content: redactedContent,
            semantic_key: semanticKey,
            importance,
            created_at: now,
            updated_at: now,
            sync_status: 'pending',
          }
          return { ...s, memories: [...s.memories, entity] }
        },
      })

      return { memory_id: result.cloudId ?? result.localId, semantic_key: semanticKey, redactions, storage: result.storage }
    },
    presentCall: args => ({ card: 'generic', title: 'Remember in XMemo', kind: 'other', rawInput: args }),
  }))
}
