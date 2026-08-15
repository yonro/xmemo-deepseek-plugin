/** Persists a per-install instance id, sent as X-Memory-OS-Agent-Instance-ID (ported from main.js's getInstanceId, main.js:310-329). */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export async function loadOrCreateInstanceId(dataDir: string): Promise<string> {
  const path = join(dataDir, 'instance-id.txt')
  try {
    const existing = (await readFile(path, 'utf8')).trim()
    if (existing) return existing
  } catch {
    // No persisted id yet (or unreadable) — mint and try to persist a fresh one below.
  }
  const id = `dsh-${randomUUID()}`
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, id, 'utf8')
  } catch {
    // Best-effort: an in-memory id for this process alone is still usable.
  }
  return id
}
