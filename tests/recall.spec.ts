import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compactCloudRecallItems, compactContextText, localMemoryItems, mergeMemoryItems } from '../src/recall.ts'
import { emptyStore } from '../src/store.ts'
import type { MemoryEntity } from '../src/types.ts'

// MemoryOS strips `content` from every /v1/recall/context item server-side (services/recall.py)
// — the readable text lives only in the response's combined top-level context_text, never per item.

test('compactCloudRecallItems keeps items that exactly match the requested bucket and scope', () => {
  const result = compactCloudRecallItems(
    [{ id: '1', bucket: 'private', scope: 'dsh' }],
    'private',
    'dsh',
  )
  assert.equal(result.violations, 0)
  assert.equal(result.suppressText, false)
  assert.equal(result.items.length, 1)
})

test('compactCloudRecallItems drops a violating item and counts it', () => {
  const result = compactCloudRecallItems(
    [
      { id: '1', bucket: 'private', scope: 'dsh' },
      { id: '2', bucket: 'shared', scope: 'dsh' }, // wrong bucket
    ],
    'private',
    'dsh',
  )
  assert.equal(result.violations, 1)
  assert.equal(result.suppressText, true)
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0]?.id, '1')
})

test('compactCloudRecallItems treats an omitted/% filter as match-anything', () => {
  const result = compactCloudRecallItems(
    [{ id: '1', bucket: 'anything', scope: 'anywhere' }],
    undefined,
    undefined,
  )
  assert.equal(result.violations, 0)
  assert.equal(result.items.length, 1)
})

test('compactContextText passes the combined text through when nothing violated', () => {
  assert.equal(compactContextText('[1] id=abc\ncontent: hello', 0), '[1] id=abc\ncontent: hello')
})

test('compactContextText blanks the combined text once any item violated — text cannot be split back apart', () => {
  assert.equal(compactContextText('[1] id=abc\ncontent: hello\n\n[2] id=leaked\ncontent: secret', 1), '')
})

function memory(content: string, overrides: Partial<MemoryEntity> = {}): MemoryEntity {
  const now = new Date().toISOString()
  return { local_id: `m-${content}`, path: 'dsh/memory', bucket: 'private', scope: 'dsh', memory_type: 'auto', content, created_at: now, updated_at: now, sync_status: 'synced', ...overrides }
}

test('localMemoryItems scores by token overlap and filters by scope', () => {
  const store = { ...emptyStore(), memories: [memory('the deploy uses blue-green rollout'), memory('unrelated lunch notes'), memory('another deploy note', { scope: 'other' })] }
  const items = localMemoryItems(store, 'deploy rollout', { scope: 'dsh', limit: 5 })
  assert.equal(items.length, 1)
  assert.match(items[0]!.content, /blue-green/)
})

test('mergeMemoryItems dedupes by id, preferring the cloud entry', () => {
  const merged = mergeMemoryItems(
    [{ id: 'shared', content: 'cloud version', source: 'cloud' }],
    [{ id: 'shared', content: 'local version', source: 'local' }, { id: 'local-only', content: 'unique local', source: 'local' }],
  )
  assert.equal(merged.length, 2)
  assert.equal(merged.find(i => i.id === 'shared')?.content, 'cloud version')
  assert.ok(merged.some(i => i.id === 'local-only'))
})
