import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { emptyStore, LocalStore, newLocalId } from '../src/store.ts'
import type { MemoryEntity, OutboxEntry } from '../src/types.ts'

let dir: string

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-xmemo-store-'))
})

after(async () => {
  await rm(dir, { recursive: true, force: true })
})

function memory(localId: string, content: string): MemoryEntity {
  const now = new Date().toISOString()
  return { local_id: localId, path: 'dsh/memory', bucket: 'private', scope: 'dsh', memory_type: 'auto', content, created_at: now, updated_at: now, sync_status: 'pending' }
}

test('reads an empty store when no file exists yet', async () => {
  const store = new LocalStore(join(dir, 'fresh'))
  const state = await store.read()
  assert.equal(state.schema_version, 1)
  assert.equal(state.memories.length, 0)
  assert.equal(state.outbox.length, 0)
})

test('mutate persists across a new LocalStore instance over the same directory', async () => {
  const target = join(dir, 'persist')
  const first = new LocalStore(target)
  await first.mutate(s => ({ ...s, memories: [...s.memories, memory('m1', 'hello')] }))

  const second = new LocalStore(target)
  const state = await second.read()
  assert.equal(state.memories.length, 1)
  assert.equal(state.memories[0]?.content, 'hello')
  assert.equal(state.revision, 1)
})

test('a crash-interrupted outbox entry recovers to pending when idempotent', async () => {
  const target = join(dir, 'recover-pending')
  await mkdir(target, { recursive: true })
  const stuck: OutboxEntry = {
    local_id: 'o1', operation: 'remember', path: '/v1/remember', method: 'POST', body: {},
    timeout_ms: 1000, idempotent: true, status: 'processing', outcome: 'unknown', retry_count: 0,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }
  await writeFile(join(target, 'store-v1.json'), JSON.stringify({ ...emptyStore(), outbox: [stuck] }), 'utf8')

  const recovered = await new LocalStore(target).read()
  assert.equal(recovered.outbox[0]?.status, 'pending')
})

test('a crash-interrupted outbox entry recovers to held when not idempotent', async () => {
  const target = join(dir, 'recover-held')
  await mkdir(target, { recursive: true })
  const stuck: OutboxEntry = {
    local_id: 'o1', operation: 'create_todo', path: '/v1/reminders', method: 'POST', body: {},
    timeout_ms: 1000, idempotent: false, status: 'staged', outcome: 'not_executed', retry_count: 0,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }
  await writeFile(join(target, 'store-v1.json'), JSON.stringify({ ...emptyStore(), outbox: [stuck] }), 'utf8')

  const recovered = await new LocalStore(target).read()
  assert.equal(recovered.outbox[0]?.status, 'held')
  assert.equal(recovered.outbox[0]?.outcome, 'unknown')
})

test('falls back to the backup file when the primary is corrupt', async () => {
  const target = join(dir, 'backup-fallback')
  const store = new LocalStore(target)
  await store.mutate(s => ({ ...s, memories: [...s.memories, memory('m1', 'first write')] }))
  // A second write promotes the first write's content to the backup file.
  await store.mutate(s => ({ ...s, memories: [...s.memories, memory('m2', 'second write')] }))

  await writeFile(join(target, 'store-v1.json'), '{ not valid json', 'utf8')

  const recovered = await store.read()
  assert.equal(recovered.memories.length, 1)
  assert.equal(recovered.memories[0]?.content, 'first write')
})

test('throws LOCAL_STORE_CORRUPT when both primary and backup are unreadable', async () => {
  const target = join(dir, 'both-corrupt')
  await mkdir(target, { recursive: true })
  await writeFile(join(target, 'store-v1.json'), '{ nope', 'utf8')
  await writeFile(join(target, 'store-v1-backup.json'), '{ also nope', 'utf8')

  const store = new LocalStore(target)
  await assert.rejects(() => store.read(), (error: unknown) => (error as { code?: string }).code === 'LOCAL_STORE_CORRUPT')
})

test('serializes concurrent mutations without losing writes', async () => {
  const target = join(dir, 'concurrent')
  const store = new LocalStore(target)
  await Promise.all(Array.from({ length: 10 }, (_, i) => store.mutate(s => ({ ...s, memories: [...s.memories, memory(`m${i}`, `write ${i}`)] }))))

  const state = await store.read()
  assert.equal(state.memories.length, 10)
  assert.equal(state.revision, 10)
})

test('newLocalId produces distinct prefixed ids', () => {
  const a = newLocalId('memory')
  const b = newLocalId('memory')
  assert.notEqual(a, b)
  assert.ok(a.startsWith('memory-'))
})
