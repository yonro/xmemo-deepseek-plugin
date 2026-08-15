import assert from 'node:assert/strict'
import { test } from 'node:test'
import { redactCredentialLikeText } from '../src/redact.ts'

test('redacts URL userinfo secrets', () => {
  const { text, redactions } = redactCredentialLikeText('clone https://alice:hunter2@example.com/repo.git')
  assert.equal(text, 'clone https://alice:[REDACTED_SECRET]@example.com/repo.git')
  assert.deepEqual(redactions, ['url_userinfo_secret'])
})

test('redacts labeled secrets', () => {
  const { text, redactions } = redactCredentialLikeText('password: supersecret123')
  assert.equal(text, 'password: [REDACTED_SECRET]')
  assert.deepEqual(redactions, ['labeled_secret'])
})

test('redacts AWS access key ids', () => {
  const { text, redactions } = redactCredentialLikeText('key is AKIAABCDEFGHIJKLMNOP')
  assert.equal(text, 'key is [REDACTED_AWS_ACCESS_KEY_ID]')
  assert.deepEqual(redactions, ['aws_access_key_id'])
})

test('redacts common API key prefixes', () => {
  // No "label:"/"label=" prefix here on purpose — that would hit the labeled_secret
  // pattern first and consume the whole value before the api_key pattern ever runs.
  const { text, redactions } = redactCredentialLikeText('found this in the log: ghp_1234567890abcdef1234')
  assert.match(text, /\[REDACTED_API_KEY]/)
  assert.deepEqual(redactions, ['api_key'])
})

test('redacts Google API keys', () => {
  const { text, redactions } = redactCredentialLikeText('AIzaSyA1234567890abcdefghijklmnopqrstuv')
  assert.equal(text, '[REDACTED_GOOGLE_API_KEY]')
  assert.deepEqual(redactions, ['google_api_key'])
})

test('redacts JWTs', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
  const { text, redactions } = redactCredentialLikeText(`Authorization: ${jwt}`)
  assert.match(text, /\[REDACTED_JWT]/)
  assert.deepEqual(redactions, ['jwt'])
})

test('redacts bearer tokens', () => {
  const { text, redactions } = redactCredentialLikeText('Bearer abcdefghijklmnopqrstuvwxyz123456')
  assert.equal(text, 'Bearer [REDACTED_BEARER_TOKEN]')
  assert.deepEqual(redactions, ['bearer_token'])
})

test('leaves ordinary text untouched', () => {
  const { text, redactions } = redactCredentialLikeText('The build finished successfully at noon.')
  assert.equal(text, 'The build finished successfully at noon.')
  assert.deepEqual(redactions, [])
})

test('handles non-string input without throwing', () => {
  const { text, redactions } = redactCredentialLikeText(undefined)
  assert.equal(text, '')
  assert.deepEqual(redactions, [])
})
