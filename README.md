# dsh-xmemo

A native [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugin: hybrid
local + [XMemo](https://xmemo.dev) cloud memory, with offline durable write queuing, active state,
timeline, TODOs, decisions, and restart snapshots — the same tool surface as
[xmemo-cindy-plugin](https://github.com/yonro/xmemo-cindy-plugin), reimplemented as an ordinary
Cordis plugin instead of going through Cindy's host-specific plugin protocol.

Unlike [xmemo-claude-plugin](https://github.com/yonro/xmemo-claude-plugin) and
[xmemo-codex-plugin](https://github.com/yonro/xmemo-codex-plugin), which are thin wrappers around
XMemo's hosted MCP server (`https://xmemo.dev/mcp`), this plugin talks directly to the **MemoryOS**
REST API (the actual backend behind XMemo — source at `D:\repos\memory-os`, package
`memory_manager`) and keeps its own local store — the same architecture as the Cindy plugin, just
ported to Cordis/TypeScript. (dsh could also reach XMemo the MCP way, via the harness's own
`@deepseek-ai/dsh-mcp-client` bridge — this repo is the deeper, native alternative.) Endpoint paths,
request/response field names, and the auth header were verified against the MemoryOS source, not
guessed from another client.

## Install

```sh
dsh plugin --profile <name> add dsh-xmemo
# or, from a local checkout:
dsh plugin --profile <name> add ./xmemo-deepseek-plugin
```

Set an XMemo API key (see [Auth](#auth) below), then verify the row loaded:

```sh
dsh --profile <name> --dump-config   # look for "# == dsh-xmemo"
```

## Auth

v1 supports **API key auth only** (see [Known Limitations](#known-limitations) for why OAuth isn't
here yet). Set the `XMEMO_KEY` credential through dsh's own credential seam — any of:

- an environment variable: `XMEMO_KEY=... dsh --profile <name>`
- `$DSH_HOME/.credentials.yaml`: `XMEMO_KEY: ...`
- `<project>/.env` or `$DSH_HOME/.env`

Sent as the `X-API-Key` header (MemoryOS's primary auth header — `Authorization: Bearer` is only
its fallback; see `auth/api_key.py`). The credential reference name is configurable
(`apiKeyCredential` in `cordis.patch.yml`) if you'd rather not use `XMEMO_KEY`.

## Config

Set in this bundle's `cordis.patch.yml`, or override per-profile/home `cordis.patch.yml`:

| Field | Default | Meaning |
|---|---|---|
| `mode` | `hybrid` | `hybrid` (local-first + cloud sync), `local-only` (never calls MemoryOS), or `cloud-only` (no local persistence). Overridable at runtime — see [Web GUI card](#web-gui-card). |
| `apiKeyCredential` | `XMEMO_KEY` | Credential reference resolved through `ctx.credentials`. |
| `apiBaseUrl` | `https://xmemo.dev` | MemoryOS REST API base. Override for a local dev server, e.g. `http://localhost:8000`. |
| `defaultScope` | `dsh` | Default `scope` tag when a tool call omits one. |
| `agentId` | `DeepSeek Harness` | Sent as `X-Memory-OS-Agent-ID`. |
| `requestTimeoutMs` | `30000` | Default per-request timeout. |
| `longRequestTimeoutMs` | `60000` | Timeout for `xmemo_recall` and `xmemo_restore_progress`. |

`mode` is resolved per tool call (`src/mode.ts`, mirroring how `src/auth.ts` resolves the API key) rather
than read once at boot: a `hybrid`/`local-only`/`cloud-only` value stored under the `XMEMO_MODE`
credential reference wins over the `cordis.patch.yml` default, so a change saved through the web GUI's
mode selector reaches the very next tool call without a restart.

## Tools

`xmemo_status`, `xmemo_update_state`, `xmemo_record_event`, `xmemo_list_timeline`, `xmemo_remember`,
`xmemo_recall`, `xmemo_forget`, `xmemo_create_todo`, `xmemo_list_todos`, `xmemo_complete_todo`,
`xmemo_create_decision`, `xmemo_list_decisions`, `xmemo_resolve_decision`, `xmemo_save_progress`,
`xmemo_restore_progress`, `xmemo_sync` — same names, schemas, and behavior as
`xmemo-cindy-plugin`'s `ghost.json`.

Skill instructions (when to call which tool) are intentionally not part of this package — reuse
`xmemo-claude-plugin/skills/*/SKILL.md` as-is by dropping them into a project's `.agents/skills/`;
dsh's `skill-filesystem` provider discovers the same frontmatter format from that directory.

## Web GUI card

The `dsh --profile web` GUI's Settings → 插件配置 (Plugin Config) panel shows an "XMemo" card
alongside the first-party Bash/Agent-loop/Web-search cards, via a browser bundle this same package
ships (`src/client/`, built to `lib/client.js`, declared through the `dsh.client` manifest field in
`package.json` — no changes to deepseek-harness itself are needed; `dsh-client-modules` scans every
loaded plugin's `package.json` for that field, not just first-party ones).

Two controls are genuinely live, both through real `credentials.describe`/`credentials.set` calls:

- **API key** — reflects and can change the actual stored key, including correctly showing it as
  read-only when `XMEMO_KEY` is supplied by the launch environment rather than the credentials store.
- **Memory mode** — a real `<select>` (hybrid / local-only / cloud-only) with an explicit Save
  button, saved under the `XMEMO_MODE` credential reference and picked up by `src/mode.ts` on the
  very next tool call. Unlike the API key field, the select can't show which value is currently
  stored — `credentials.describe` deliberately never exposes a credential's value, only whether it's
  configured (see "Known Limitations") — so it always starts from the `hybrid` default and a
  "customized"/"default" badge stands in for the value itself, the same way the API key field's
  "configured" badge never reveals the secret.

The other five config fields (`apiBaseUrl`/`defaultScope`/`agentId`/`requestTimeoutMs`/
`longRequestTimeoutMs`) aren't shown in the card at all — their defaults are fine for the vast
majority of setups; override them via `cordis.patch.yml` (see [Config](#config)) if needed.

Build with `npm run build:client` (separate from the host build — needs its own `tsconfig.client.json`
and `scripts/build-client.mjs`, since the host and browser halves target different runtimes).

## Architecture notes

Ported from `xmemo-cindy-plugin/plugins/xmemo-memory/main.js`'s business logic:

- `src/http.ts` — request/error handling (`AUTH_REQUIRED`, `RATE_LIMITED`, `XMEMO_SERVER_ERROR`, …).
  One structural change from upstream: Cindy's host injected `Authorization` based on request
  hostname; this plugin resolves and attaches the bearer token itself (`src/auth.ts`).
- `src/store.ts` — the local JSON store (schema, prune limits, quota guard, corrupt-file → backup
  fallback, write-temp-then-rename atomicity).
- `src/outbox.ts` — the durable write queue: `staged → sent | pending | held | failed`, idempotent
  ops auto-retry (5 attempts), non-idempotent ops go straight to `held` and need an explicit
  `xmemo_sync {action: 'push', include_held: true}`, local-id → cloud-id dependency resolution for
  writes that target an entity that hasn't synced yet (e.g. completing a TODO offline).
- `src/recall.ts` — local token-overlap scoring merged with cloud recall, including the fail-closed
  bucket/scope filter (`compactCloudRecallItems`): a cloud item that doesn't exactly match the
  request is dropped, and any single violation suppresses all opaque cloud text in that response.
- `src/redact.ts` — the 7-category credential-like-text redaction, ported verbatim.

One acknowledged divergence: main.js's store is one dynamic JSON blob, so it can replay a queued
write generically. This port's store is typed per entity kind, so a **replayed** write (via
`xmemo_sync`, possibly in a later process) only generically patches `cloud_id` + `sync_status`;
richer field back-fill happens only on the first attempt, made synchronously inside the same tool
call. See the comment at the top of `src/outbox.ts`.

## Known Limitations

- **API key auth only.** OAuth PKCE (like Cindy's host-managed flow) is deferred — it needs its own
  XMemo-side `client_id` registration (Cindy's `xmemo-cindy` client_id is host-specific) and a
  loopback redirect listener; `dsh`'s own `dsh-mcp-client` bridge is API-key/static-header-only
  today too, so this matches the rest of the harness's external-auth story.
- **No encryption at rest.** Same as upstream — the Cindy host's storage encryption, if any, was
  opaque to the plugin; this port is honest that there isn't one.
- **Single in-process store lock.** Concurrent `dsh` processes writing to the same store directory
  are not coordinated; run one instance per store directory.
- **PII redaction is not implemented**, matching upstream: `xmemo-cindy-plugin`'s tool descriptions
  claim email/phone redaction, but no such code exists in `main.js` either — it's server-side or
  aspirational. This port's tool descriptions say only what the code does.
- **Replayed writes only back-fill `cloud_id`**, not richer response fields — see Architecture notes.
- **The web GUI card can only edit `apiKeyCredential` and `mode`; the other five config fields
  aren't editable from the browser at all.** The harness's generic settings-persistence pipeline
  (`ctx.settingsScope`) is gated by a hardcoded namespace allowlist in deepseek-harness's own
  `packages/host/apiproxy/src/api-proxy.ts` (`WEB_SETTINGS_NAMESPACES`) that an out-of-tree plugin
  cannot extend from its own package (the source comment there calls generalizing it "deferred
  work"). Only the ungated `credentials.*` RPC is open to third-party plugins today — the same
  channel `apiKeyCredential` already used for its API key — so `mode` piggybacks on it too (a
  `XMEMO_MODE` credential reference, resolved by `src/mode.ts`), and the remaining five fields have
  no open channel to bind to at all.
- **The mode selector can't show the currently saved value, only whether one has been saved.**
  `credentials.describe` reports `configured`/`writable` but never a credential's value — correct
  for secrets, but it means the mode select can't be pre-filled with the true stored mode the way
  Cindy's `/kv`-backed selector can. The select always starts from the `hybrid` default; saving
  always overwrites blindly, same as the API key field already does.
- **`XMEMO_MODE` appears in `$DSH_HOME/.credentials.yaml` and the Models page's credentials list
  once set from the card**, even though it isn't a secret — an accepted tradeoff of reusing the one
  channel that's actually open to an out-of-tree plugin.

## Development

```sh
npm install
npm run build         # tsc -> lib/ (host half)
npm run build:client   # tsc --emitDeclarationOnly + esbuild -> lib/client.js (browser half)
npm run typecheck
npm test               # node --test over tests/*.spec.ts
```
