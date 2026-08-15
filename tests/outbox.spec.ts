import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import type { ApiClient, RequestSpec } from '../src/http.ts'
import { discardFailed, hybridWrite, outboxSummary, syncOutboxInternal } from '../src/outbox.ts'
import { LocalStore } from '../src/store.ts'
import { PluginError } from '../src/types.ts'
import type { MemoryEntity } from '../src/types.ts'

let dir: string

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-xmemo-outbox-'))
})

after(async () => {
  await rm(dir, { recursive: true, force: true })
})

function fakeApi(handler: (path: string, spec: RequestSpec) => unknown): ApiClient {
  return {
    async request(path, spec = {}) {
      return handler(path, spec)
    },
  }
}

function memorySpec(localId: string) {
  return {
    operation: 'remember',
    path: '/v1/remember',
    idempotent: true,
    targetKind: 'memory' as const,
    localId,
    body: { content: 'hello' },
    project: (s: import('../src/types.ts').Store, id: string, now: string) => {
      const entity: MemoryEntity = { local_id: id, path: 'dsh/memory', bucket: 'private', scope: 'dsh', memory_type: 'auto', content: 'hello', created_at: now, updated_at: now, sync_status: 'pending' }
      return { ...s, memories: [...s.memories, entity] }
    },
  }
}

test('successful hybrid write marks the entity synced with a cloud id', async () => {
  const localStore = new LocalStore(join(dir, 'success'))
  const api = fakeApi(() => ({ id: 'cloud-1' }))
  const result = await hybridWrite({ localStore, api, mode: 'hybrid' }, memorySpec('local-1'))

  assert.equal(result.cloudId, 'cloud-1')
  assert.equal(result.storage.cloud, 'synced')
  const store = await localStore.read()
  assert.equal(store.memories[0]?.cloud_id, 'cloud-1')
  assert.equal(store.memories[0]?.sync_status, 'synced')
  assert.equal(store.outbox[0]?.status, 'sent')
})

test('a retryable failure on an idempotent write queues as pending and does not throw', async () => {
  const localStore = new LocalStore(join(dir, 'pending'))
  const api = fakeApi(() => {
    throw new PluginError('NETWORK_ERROR', 'offline', 'unknown', true)
  })
  const result = await hybridWrite({ localStore, api, mode: 'hybrid' }, memorySpec('local-2'))

  assert.equal(result.storage.cloud, 'queued')
  assert.equal(result.storage.queueStatus, 'pending')
  const store = await localStore.read()
  assert.equal(store.outbox[0]?.status, 'pending')
  assert.equal(store.memories[0]?.sync_status, 'pending')
})

test('a retryable failure on a non-idempotent write queues as held and does not throw', async () => {
  const localStore = new LocalStore(join(dir, 'held'))
  const api = fakeApi(() => {
    throw new PluginError('NETWORK_ERROR', 'offline', 'unknown', true)
  })
  const spec = { ...memorySpec('local-3'), idempotent: false, operation: 'create_todo' }
  const result = await hybridWrite({ localStore, api, mode: 'hybrid' }, spec)

  assert.equal(result.storage.queueStatus, 'held')
})

test('a non-retryable failure marks the entry failed and rethrows', async () => {
  const localStore = new LocalStore(join(dir, 'failed'))
  const api = fakeApi(() => {
    throw new PluginError('AUTH_REQUIRED', 'bad key', 'not_executed', false)
  })
  await assert.rejects(() => hybridWrite({ localStore, api, mode: 'hybrid' }, memorySpec('local-4')), /bad key/)

  const store = await localStore.read()
  assert.equal(store.outbox[0]?.status, 'failed')
})

test('local-only mode stages the entity and never calls the network', async () => {
  const localStore = new LocalStore(join(dir, 'local-only'))
  let called = false
  const api = fakeApi(() => {
    called = true
    return {}
  })
  const result = await hybridWrite({ localStore, api, mode: 'local-only' }, memorySpec('local-5'))

  assert.equal(called, false)
  assert.equal(result.storage.cloud, 'skipped')
  assert.equal(result.storage.queueStatus, 'held')
  const store = await localStore.read()
  assert.equal(store.memories.length, 1)
})

test('cloud-only mode never touches the local store', async () => {
  const localStore = new LocalStore(join(dir, 'cloud-only'))
  const api = fakeApi(() => ({ id: 'cloud-9' }))
  const result = await hybridWrite({ localStore, api, mode: 'cloud-only' }, memorySpec('local-6'))

  assert.equal(result.storage.local, 'skipped')
  const store = await localStore.read()
  assert.equal(store.memories.length, 0)
})

test('syncOutboxInternal replays a pending entry to sent on success', async () => {
  const localStore = new LocalStore(join(dir, 'replay-sent'))
  let failNext = true
  const api = fakeApi(() => {
    if (failNext) {
      failNext = false
      throw new PluginError('NETWORK_ERROR', 'offline', 'unknown', true)
    }
    return { id: 'cloud-10' }
  })
  await hybridWrite({ localStore, api, mode: 'hybrid' }, memorySpec('local-7'))
  let store = await localStore.read()
  assert.equal(store.outbox[0]?.status, 'pending')

  await syncOutboxInternal({ localStore, api, mode: 'hybrid' }, { includeHeld: false, limit: 5 })
  store = await localStore.read()
  assert.equal(store.outbox[0]?.status, 'sent')
  assert.equal(store.memories[0]?.cloud_id, 'cloud-10')
})

test('an idempotent entry exhausts retries and becomes failed after 5 attempts', async () => {
  const localStore = new LocalStore(join(dir, 'exhaust'))
  const api = fakeApi(() => {
    throw new PluginError('NETWORK_ERROR', 'offline', 'unknown', true)
  })
  await hybridWrite({ localStore, api, mode: 'hybrid' }, memorySpec('local-8'))

  for (let i = 0; i < 5; i++) {
    await syncOutboxInternal({ localStore, api, mode: 'hybrid' }, { includeHeld: false, limit: 1 })
  }
  const store = await localStore.read()
  assert.equal(store.outbox[0]?.status, 'failed')
  assert.equal(outboxSummary(store).failed, 1)
})

test('discardFailed removes only failed entries, never held ones', async () => {
  const localStore = new LocalStore(join(dir, 'discard'))
  const authApi = fakeApi(() => {
    throw new PluginError('AUTH_REQUIRED', 'bad key', 'not_executed', false)
  })
  await hybridWrite({ localStore, api: authApi, mode: 'hybrid' }, memorySpec('local-9')).catch(() => {})

  const networkApi = fakeApi(() => {
    throw new PluginError('NETWORK_ERROR', 'offline', 'unknown', true)
  })
  await hybridWrite({ localStore, api: networkApi, mode: 'hybrid' }, { ...memorySpec('local-10'), idempotent: false, operation: 'create_todo' })

  let store = await localStore.read()
  assert.equal(outboxSummary(store).failed, 1)
  assert.equal(outboxSummary(store).held, 1)

  const discarded = await discardFailed(localStore, 10)
  assert.equal(discarded.length, 1)
  store = await localStore.read()
  assert.equal(outboxSummary(store).failed, 0)
  assert.equal(outboxSummary(store).held, 1)
})
