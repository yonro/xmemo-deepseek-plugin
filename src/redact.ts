/**
 * Ported verbatim from xmemo-cindy-plugin/plugins/xmemo-memory/main.js (redactCredentialLikeText,
 * main.js:37-73). Only credential-like text is redacted here — the upstream ghost.json tool
 * descriptions also claim PII (email/phone) redaction, but no such code exists in main.js, so it is
 * NOT reproduced here either; see README "Known Limitations".
 */

export interface RedactionResult {
  text: string
  redactions: string[]
}

export function redactCredentialLikeText(value: unknown): RedactionResult {
  let text = String(value ?? '')
  const redactions: string[] = []

  function replace(pattern: RegExp, type: string, replacement: string | ((...args: string[]) => string)): void {
    let changed = false
    text = text.replace(pattern, (...args: string[]) => {
      changed = true
      return typeof replacement === 'function' ? replacement(...args) : replacement
    })
    if (changed && !redactions.includes(type)) redactions.push(type)
  }

  replace(
    /\b([a-z][a-z0-9+.-]*:\/\/)([^:@/\s]+):([^@/\s]+)@/gi,
    'url_userinfo_secret',
    (_match: string, prefix: string, username: string) => `${prefix}${username}:[REDACTED_SECRET]@`,
  )
  replace(
    /\b(password|passwd|pwd|secret|token|api[_-]?key)(\s*[:=]\s*)(?:"[^"]{6,}"|'[^']{6,}'|[^\s,;]{6,})/gi,
    'labeled_secret',
    (_match: string, label: string, separator: string) => `${label}${separator}[REDACTED_SECRET]`,
  )
  replace(/\bAKIA[A-Z0-9]{12,20}\b/g, 'aws_access_key_id', '[REDACTED_AWS_ACCESS_KEY_ID]')
  replace(
    /\b(?:sk[-_](?:live[-_]|test[-_]|proj[-_])?|ghp_|gho_|xoxb[-_]|xoxp[-_]|mos_|key[-_])[A-Za-z0-9_-]{12,}\b/g,
    'api_key',
    '[REDACTED_API_KEY]',
  )
  replace(/\bAIza[A-Za-z0-9_-]{24,40}(?![A-Za-z0-9_-])/g, 'google_api_key', '[REDACTED_GOOGLE_API_KEY]')
  replace(/\beyJ[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{2,}\b/g, 'jwt', '[REDACTED_JWT]')
  replace(
    /\bBearer(\s+)(?=[A-Za-z0-9._~+/-]{12,}={0,2}(?![A-Za-z0-9._~+/=-]))(?=[A-Za-z0-9._~+/-]*[0-9._~+/-])[A-Za-z0-9._~+/-]{12,}={0,2}/gi,
    'bearer_token',
    (_match: string, separator: string) => `Bearer${separator}[REDACTED_BEARER_TOKEN]`,
  )

  return { text, redactions }
}
