import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDeps } from '../deps.ts'
import { listWithCache } from '../list.ts'
import { hybridWrite } from '../outbox.ts'
import { newLocalId } from '../store.ts'
import { PluginError } from '../types.ts'
import type { DecisionEntity } from '../types.ts'
import { boundedInteger, optionalIsoTimestamp, optionalString, requiredString, toLosslessJson } from '../util.ts'

interface DecisionItem {
  id: string
  context: string
  options: string[]
  scope: string
  due_at?: string
  status: 'open' | 'resolved'
  resolution?: string
  source: 'local' | 'cloud'
}

function extractCloudDecisions(cloudBody: unknown): DecisionItem[] {
  // GET /v1/decisions responds { decisions: [...] } (memory-os routes/action_items.py).
  const record = cloudBody as Record<string, unknown> | null
  const raw = Array.isArray(record?.decisions) ? record!.decisions : []
  return (raw as Record<string, unknown>[]).map(item => ({
    id: String(item.id ?? item.memory_id ?? item.storage_id ?? ''),
    context: String(item.context ?? ''),
    options: Array.isArray(item.options) ? item.options.map(String) : [],
    scope: String(item.scope ?? ''),
    due_at: typeof item.due_at === 'string' ? item.due_at : undefined,
    status: item.item_status === 'resolved' ? 'resolved' : 'open',
    resolution: typeof item.resolution === 'string' ? item.resolution : undefined,
    source: 'cloud' as const,
  }))
}

function localDecisionItem(decision: DecisionEntity): DecisionItem {
  return {
    id: decision.cloud_id ?? decision.local_id,
    context: decision.context,
    options: decision.options,
    scope: decision.scope,
    due_at: decision.due_at,
    status: decision.status,
    resolution: decision.resolution,
    source: 'local',
  }
}

export function registerCreateDecisionTool(ctx: Context, deps: ToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'xmemo_create_decision',
    description: 'Create one pending XMemo decision with options. Use before committing to a '
      + 'non-trivial architecture, security, public behavior, or tradeoff when a decision should '
      + 'survive the conversation; this does not resolve it.',
    parameters: {
      context: { type: 'string', required: true, description: 'Decision question, constraints, and why it matters. Up to 20000 characters.' },
      options: { type: 'array', items: { type: 'string' }, description: 'Options under consideration. Up to 20 items.' },
      due_at: { type: 'string', description: 'Optional ISO 8601 decision due time.' },
      scope: { type: 'string', description: 'Stable scope; defaults to the plugin default scope.' },
      path: { type: 'string', description: "Optional logical path; defaults to 'dsh/decisions'." },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: `Created decision (${(value as { storage?: { cloud?: string } }).storage?.cloud ?? 'local'}).` }],
    },
    async execute(args) {
      const context = requiredString(args.context, 'context', 20_000)
      const options = (Array.isArray(args.options) ? args.options : [])
        .filter((option): option is string => typeof option === 'string' && option.trim().length > 0)
        .slice(0, 20)
      const dueAt = optionalIsoTimestamp(args.due_at, 'due_at')
      const scope = optionalString(args.scope) ?? deps.config.defaultScope
      const path = optionalString(args.path) ?? 'dsh/decisions'
      const localId = newLocalId('decision')
      const mode = await deps.resolveMode()

      const result = await hybridWrite({ localStore: deps.localStore, api: deps.api, mode }, {
        operation: 'create_decision',
        path: '/v1/decisions',
        idempotent: false,
        targetKind: 'decision',
        localId,
        timeoutMs: deps.config.requestTimeoutMs,
        body: { context, options, due_at: dueAt, scope, path, bucket: 'work' },
        project: (s, id, now) => {
          const entity: DecisionEntity = { local_id: id, context, options, scope, path, bucket: 'work', due_at: dueAt, status: 'open', created_at: now, updated_at: now, sync_status: 'pending' }
          return { ...s, decisions: [...s.decisions, entity] }
        },
      })

      return { decision_id: result.cloudId ?? result.localId, storage: result.storage }
    },
    presentCall: args => ({ card: 'generic', title: 'Create XMemo decision', kind: 'other', rawInput: args }),
  }))
}

export function registerListDecisionsTool(ctx: Context, deps: ToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'xmemo_list_decisions',
    description: 'List authorized pending or resolved XMemo decisions without changing them. Use '
      + 'before resuming a project, before making a related choice, or when the user asks what '
      + 'remains undecided.',
    parameters: {
      limit: { type: 'number', description: 'Maximum items, 1-100; defaults to 20.' },
      bucket: { type: 'string', description: "Bucket filter; defaults to 'work'." },
      scope: { type: 'string', description: 'Optional exact scope filter.' },
      item_status: { type: 'string', enum: ['open', 'resolved', 'all'], description: "Status filter; defaults to 'open'." },
      due_before: { type: 'string', description: 'Optional ISO 8601 upper due-time bound.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: `${(value as { items: unknown[] }).items.length} decision(s).` }],
    },
    async execute(args, exec) {
      const limit = boundedInteger(args.limit, 20, 1, 100)
      const bucket = optionalString(args.bucket) ?? 'work'
      const scope = optionalString(args.scope)
      const itemStatus = args.item_status === 'resolved' || args.item_status === 'all' ? args.item_status : 'open'
      const dueBefore = optionalIsoTimestamp(args.due_before, 'due_before')
      const mode = await deps.resolveMode()

      const result = await listWithCache<DecisionItem>({ api: deps.api, localStore: deps.localStore, mode }, {
        cacheKind: 'decisions',
        cacheParams: { bucket, scope, itemStatus, dueBefore },
        cloudPath: `/v1/decisions?bucket=${encodeURIComponent(bucket)}${scope ? `&scope=${encodeURIComponent(scope)}` : ''}&item_status=${itemStatus === 'all' ? '%25' : itemStatus}${dueBefore ? `&due_before=${encodeURIComponent(dueBefore)}` : ''}&limit=${limit}`,
        timeoutMs: deps.config.requestTimeoutMs,
        signal: exec.signal,
        localItems: async () => {
          const store = await deps.localStore.read()
          return store.decisions
            .filter(d => (scope === undefined || d.scope === scope) && (itemStatus === 'all' || d.status === itemStatus))
            .filter(d => dueBefore === undefined || (d.due_at !== undefined && d.due_at <= dueBefore))
            .slice(0, limit)
            .map(localDecisionItem)
        },
        extractCloudItems: extractCloudDecisions,
        mergeAndDedupe: (cloudItems, localItems) => {
          const seen = new Set(cloudItems.map(i => i.id))
          return [...cloudItems, ...localItems.filter(i => !seen.has(i.id))].slice(0, limit)
        },
      })

      return toLosslessJson(result)
    },
    presentCall: args => ({ card: 'generic', title: 'List XMemo decisions', kind: 'other', rawInput: args }),
  }))
}

export function registerResolveDecisionTool(ctx: Context, deps: ToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'xmemo_resolve_decision',
    description: 'Resolve one exact pending XMemo decision with the selected outcome and rationale. '
      + 'Use only after the decision is actually made; obtain decision_id from xmemo_list_decisions. '
      + 'This versions the decision and is not retried automatically.',
    parameters: {
      decision_id: { type: 'string', required: true, description: 'Exact pending decision ID returned by xmemo_list_decisions.' },
      resolution: { type: 'string', required: true, description: 'Selected outcome and concise rationale. Up to 12000 characters.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: `Resolved decision (${(value as { storage?: { cloud?: string } }).storage?.cloud ?? 'local'}).` }],
    },
    async execute(args, exec) {
      const decisionId = requiredString(args.decision_id, 'decision_id')
      const resolution = requiredString(args.resolution, 'resolution', 12_000)

      const mode = await deps.resolveMode()
      const store = await deps.localStore.read()
      const existing = store.decisions.find(d => d.local_id === decisionId || d.cloud_id === decisionId)

      if (!existing) {
        if (mode === 'local-only') throw new PluginError('NOT_FOUND', `No local decision found matching ${decisionId}.`, 'not_executed', false)
        const cloudResult = await deps.api.request(`/v1/decisions/${encodeURIComponent(decisionId)}/resolve`, {
          method: 'POST', timeoutMs: deps.config.requestTimeoutMs, write: true, signal: exec.signal, body: { resolution },
        })
        return { decision_id: decisionId, storage: { local: 'skipped', cloud: 'synced' }, cloud_result: cloudResult }
      }

      const now = new Date().toISOString()
      const result = await hybridWrite({ localStore: deps.localStore, api: deps.api, mode }, {
        operation: 'resolve_decision',
        path: '/v1/decisions/{decision_id}/resolve',
        idempotent: false,
        targetKind: 'decision',
        localId: existing.local_id,
        dependsOnLocalId: existing.local_id,
        dependsOnPlaceholder: '{decision_id}',
        dropOnNotFound: true,
        timeoutMs: deps.config.requestTimeoutMs,
        body: { resolution },
        project: s => ({ ...s, decisions: s.decisions.map(d => (d.local_id === existing.local_id ? { ...d, status: 'resolved', resolution, updated_at: now } : d)) }),
      })

      return { decision_id: result.cloudId ?? decisionId, storage: result.storage }
    },
    presentCall: args => ({ card: 'generic', title: 'Resolve XMemo decision', kind: 'other', rawInput: args }),
  }))
}
