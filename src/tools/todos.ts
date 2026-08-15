import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDeps } from '../deps.ts'
import { listWithCache } from '../list.ts'
import { hybridWrite } from '../outbox.ts'
import { newLocalId } from '../store.ts'
import { PluginError } from '../types.ts'
import type { TodoEntity } from '../types.ts'
import { boundedInteger, optionalIsoTimestamp, optionalString, requiredString, toLosslessJson } from '../util.ts'

interface TodoItem {
  id: string
  content: string
  scope: string
  due_at?: string
  status: 'open' | 'completed'
  source: 'local' | 'cloud'
}

function extractCloudTodos(cloudBody: unknown): TodoItem[] {
  // GET /v1/reminders responds { reminders: [...] } (memory-os routes/action_items.py).
  const record = cloudBody as Record<string, unknown> | null
  const raw = Array.isArray(record?.reminders) ? record!.reminders : []
  return (raw as Record<string, unknown>[]).map(item => ({
    id: String(item.id ?? item.memory_id ?? ''),
    content: String(item.content ?? ''),
    scope: String(item.scope ?? ''),
    due_at: typeof item.due_at === 'string' ? item.due_at : undefined,
    status: item.item_status === 'completed' ? 'completed' : 'open',
    source: 'cloud' as const,
  }))
}

function localTodoItem(todo: TodoEntity): TodoItem {
  return { id: todo.cloud_id ?? todo.local_id, content: todo.content, scope: todo.scope, due_at: todo.due_at, status: todo.status, source: 'local' }
}

export function registerCreateTodoTool(ctx: Context, deps: ToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'xmemo_create_todo',
    description: 'Create one local/cloud TODO when the user asks to retain a follow-up. Offline '
      + 'creation is saved locally and held from automatic cloud replay to avoid duplicates.',
    parameters: {
      content: { type: 'string', required: true, description: 'Concrete action item or follow-up. Up to 12000 characters.' },
      due_at: { type: 'string', description: 'Optional ISO 8601 due time.' },
      scope: { type: 'string', description: 'Stable scope; defaults to the plugin default scope.' },
      path: { type: 'string', description: "Optional logical path; defaults to 'dsh/reminders'." },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: `Created TODO (${(value as { storage?: { cloud?: string } }).storage?.cloud ?? 'local'}).` }],
    },
    async execute(args) {
      const content = requiredString(args.content, 'content', 12_000)
      const dueAt = optionalIsoTimestamp(args.due_at, 'due_at')
      const scope = optionalString(args.scope) ?? deps.config.defaultScope
      const path = optionalString(args.path) ?? 'dsh/reminders'
      const localId = newLocalId('todo')

      const result = await hybridWrite({ localStore: deps.localStore, api: deps.api, mode: deps.mode }, {
        operation: 'create_todo',
        path: '/v1/reminders',
        idempotent: false,
        targetKind: 'todo',
        localId,
        timeoutMs: deps.config.requestTimeoutMs,
        body: { content, due_at: dueAt, scope, path, bucket: 'work' },
        project: (s, id, now) => {
          const entity: TodoEntity = { local_id: id, content, scope, path, bucket: 'work', due_at: dueAt, status: 'open', created_at: now, updated_at: now, sync_status: 'pending' }
          return { ...s, todos: [...s.todos, entity] }
        },
      })

      return { todo_id: result.cloudId ?? result.localId, storage: result.storage }
    },
    presentCall: args => ({ card: 'generic', title: 'Create XMemo TODO', kind: 'other', rawInput: args }),
  }))
}

export function registerListTodosTool(ctx: Context, deps: ToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'xmemo_list_todos',
    description: 'List authorized XMemo TODOs/reminders without changing them. Use before resuming '
      + 'work or when the user asks what is open, completed, or due.',
    parameters: {
      limit: { type: 'number', description: 'Maximum items, 1-100; defaults to 20.' },
      bucket: { type: 'string', description: "Bucket filter; defaults to 'work'." },
      scope: { type: 'string', description: 'Optional exact scope filter.' },
      item_status: { type: 'string', enum: ['open', 'completed', 'all'], description: "Status filter; defaults to 'open'." },
      due_before: { type: 'string', description: 'Optional ISO 8601 upper due-time bound.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: `${(value as { items: unknown[] }).items.length} TODO(s).` }],
    },
    async execute(args, exec) {
      const limit = boundedInteger(args.limit, 20, 1, 100)
      const bucket = optionalString(args.bucket) ?? 'work'
      const scope = optionalString(args.scope)
      const itemStatus = args.item_status === 'completed' || args.item_status === 'all' ? args.item_status : 'open'
      const dueBefore = optionalIsoTimestamp(args.due_before, 'due_before')

      const result = await listWithCache<TodoItem>({ api: deps.api, localStore: deps.localStore, mode: deps.mode }, {
        cacheKind: 'todos',
        cacheParams: { bucket, scope, itemStatus, dueBefore },
        cloudPath: `/v1/reminders?bucket=${encodeURIComponent(bucket)}${scope ? `&scope=${encodeURIComponent(scope)}` : ''}&item_status=${itemStatus === 'all' ? '%25' : itemStatus}${dueBefore ? `&due_before=${encodeURIComponent(dueBefore)}` : ''}&limit=${limit}`,
        timeoutMs: deps.config.requestTimeoutMs,
        signal: exec.signal,
        localItems: async () => {
          const store = await deps.localStore.read()
          return store.todos
            .filter(t => (scope === undefined || t.scope === scope) && (itemStatus === 'all' || t.status === itemStatus))
            .filter(t => dueBefore === undefined || (t.due_at !== undefined && t.due_at <= dueBefore))
            .slice(0, limit)
            .map(localTodoItem)
        },
        extractCloudItems: extractCloudTodos,
        mergeAndDedupe: (cloudItems, localItems) => {
          const seen = new Set(cloudItems.map(i => i.id))
          return [...cloudItems, ...localItems.filter(i => !seen.has(i.id))].slice(0, limit)
        },
      })

      return toLosslessJson(result)
    },
    presentCall: args => ({ card: 'generic', title: 'List XMemo TODOs', kind: 'other', rawInput: args }),
  }))
}

export function registerCompleteTodoTool(ctx: Context, deps: ToolDeps): void {
  ctx.tools.register(defineTool({
    name: 'xmemo_complete_todo',
    description: 'Mark one exact XMemo TODO/reminder completed. Use only after the user or completed '
      + 'work clearly identifies the item; obtain todo_id from xmemo_list_todos. This versions the '
      + 'item and is not retried automatically.',
    parameters: {
      todo_id: { type: 'string', required: true, description: 'Exact TODO/reminder ID returned by xmemo_list_todos.' },
      note: { type: 'string', description: 'Optional completion evidence or note. Up to 8000 characters.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: `Completed TODO (${(value as { storage?: { cloud?: string } }).storage?.cloud ?? 'local'}).` }],
    },
    async execute(args, exec) {
      const todoId = requiredString(args.todo_id, 'todo_id')
      const note = optionalString(args.note)

      const store = await deps.localStore.read()
      const existing = store.todos.find(t => t.local_id === todoId || t.cloud_id === todoId)

      if (!existing) {
        if (deps.mode === 'local-only') throw new PluginError('NOT_FOUND', `No local TODO found matching ${todoId}.`, 'not_executed', false)
        const cloudResult = await deps.api.request(`/v1/reminders/${encodeURIComponent(todoId)}/complete`, {
          method: 'POST', timeoutMs: deps.config.requestTimeoutMs, write: true, signal: exec.signal, body: { note },
        })
        return { todo_id: todoId, storage: { local: 'skipped', cloud: 'synced' }, cloud_result: cloudResult }
      }

      const now = new Date().toISOString()
      const result = await hybridWrite({ localStore: deps.localStore, api: deps.api, mode: deps.mode }, {
        operation: 'complete_todo',
        path: `/v1/reminders/{todo_id}/complete`,
        idempotent: false,
        targetKind: 'todo',
        localId: existing.local_id,
        dependsOnLocalId: existing.local_id,
        dependsOnPlaceholder: '{todo_id}',
        dropOnNotFound: true,
        timeoutMs: deps.config.requestTimeoutMs,
        body: { note },
        project: s => ({ ...s, todos: s.todos.map(t => (t.local_id === existing.local_id ? { ...t, status: 'completed', updated_at: now } : t)) }),
      })

      return { todo_id: result.cloudId ?? todoId, storage: result.storage }
    },
    presentCall: args => ({ card: 'generic', title: 'Complete XMemo TODO', kind: 'other', rawInput: args }),
  }))
}
