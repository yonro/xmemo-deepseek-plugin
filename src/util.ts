/**
 * Hand-validation helpers for constraints the ParameterSchemaSpec DSL does not enforce at runtime
 * (per docs/cookbook/adding-a-tool.md: "you still hand-check ... non-empty strings, positive
 * numbers, or cross-field rules"). Ported from main.js's cleanString/optionalString/boundedInteger.
 */

import { PluginError } from './types.ts'

export function requiredString(value: unknown, field: string, maxLength?: number): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new PluginError('INVALID_ARGUMENT', `${field} must be a non-empty string.`, 'not_executed', false)
  }
  const trimmed = value.trim()
  if (maxLength !== undefined && trimmed.length > maxLength) {
    throw new PluginError('INVALID_ARGUMENT', `${field} must be at most ${maxLength} characters.`, 'not_executed', false)
  }
  return trimmed
}

export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  return Math.floor(boundedNumber(value, fallback, min, max))
}

export function optionalIsoTimestamp(value: unknown, field: string): string | undefined {
  const text = optionalString(value)
  if (!text) return undefined
  const parsed = Date.parse(text)
  if (!/^\d{4}-\d{2}-\d{2}T/.test(text) || !Number.isFinite(parsed)) {
    throw new PluginError('INVALID_ARGUMENT', `${field} must be a valid ISO 8601 timestamp.`, 'not_executed', false)
  }
  return text
}

/**
 * dsh-tools snapshots a tool's returned value as "lossless JSON" and rejects `undefined` anywhere
 * inside it (not just at the top level) — an object literal built with `field: cond ? value :
 * undefined` fails that check even though `JSON.stringify` alone would have silently dropped the
 * key. Round-tripping through JSON strips every such key before the registry ever sees it.
 */
export function toLosslessJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function queryPath(path: string, params: Record<string, unknown>): string {
  const pairs: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  }
  return pairs.length ? `${path}?${pairs.join('&')}` : path
}
