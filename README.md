<div align="center">
  <a href="https://xmemo.dev">
    <img src="https://cdn.jsdelivr.net/gh/yonro/xmemo-claude-plugin@main/assets/icon.png" alt="XMemo" width="112" />
  </a>

  <h1>XMemo for DeepSeek Harness</h1>

  <p><strong>Native local-first + cloud memory for <code>dsh</code>.</strong></p>
  <p>
    Hybrid local storage with an offline durable write queue, plus real OAuth 2.1
    login — reimplemented as an ordinary Cordis plugin instead of a thin MCP bridge.
  </p>

  <p>
    <a href="LICENSE"><img alt="License" src="https://img.shields.io/github/license/yonro/xmemo-deepseek-plugin?style=flat-square" /></a>
    <img alt="Plugin version" src="https://img.shields.io/badge/plugin-v0.1.0-8B5CF6?style=flat-square" />
    <a href="https://github.com/yonro/xmemo-deepseek-plugin/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/yonro/xmemo-deepseek-plugin?style=flat-square&amp;logo=github" /></a>
  </p>

  <p>
    <img alt="Native Cordis plugin" src="https://img.shields.io/badge/dsh-native%20Cordis%20plugin-06B6D4?style=flat-square" />
    <img alt="REST, not MCP" src="https://img.shields.io/badge/backend-MemoryOS%20REST-334155?style=flat-square" />
    <img alt="OAuth 2.1 + PKCE" src="https://img.shields.io/badge/auth-OAuth%202.1%20%2B%20PKCE-10B981?style=flat-square" />
    <img alt="Local + cloud memory" src="https://img.shields.io/badge/memory-local--first%20%2B%20cloud-6E56CF?style=flat-square" />
  </p>

  <p>
    <a href="#quick-start">Quick start</a> ·
    <a href="#auth">Auth</a> ·
    <a href="#config">Config</a> ·
    <a href="#web-gui-card">Web GUI card</a> ·
    <a href="#tools">Tools</a> ·
    <a href="#capabilities-and-boundaries">Capabilities</a> ·
    <a href="#known-limitations">Limitations</a>
  </p>
</div>

---

A native [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugin: hybrid
local + [XMemo](https://xmemo.dev) cloud memory, with offline durable write queuing, active state,
timeline, TODOs, decisions, and restart snapshots — the same tool surface as
[xmemo-cindy-plugin](https://github.com/yonro/xmemo-cindy-plugin), reimplemented as an ordinary
Cordis plugin instead of going through Cindy's host-specific plugin protocol.

This plugin talks directly to the **MemoryOS** REST API (the actual backend behind XMemo) and keeps
its own local store, rather than going through XMemo's hosted MCP server (`https://xmemo.dev/mcp`)
— dsh can also reach XMemo the MCP way via the harness's own `@deepseek-ai/dsh-mcp-client` bridge,
but this repo is the deeper, native alternative. Endpoint paths, request/response field names, and
the auth header were verified against the MemoryOS source, not guessed from another client —
including live, end-to-end verification of the OAuth flow against production `xmemo.dev`.

> [!NOTE]
> DeepSeek Harness itself is a developer preview. This plugin has been exercised locally against
> production `xmemo.dev` (unit tests, a live web GUI session, and a real OAuth registration +
> authorize round trip) but has not seen broad multi-user usage yet.

## At a glance

| | |
|---|---|
| Package | `dsh-xmemo` |
| Plugin ID | `xmemo` |
| Runtime | DeepSeek Harness (`dsh`) |
| Version | `0.1.0` |
| Bundle | Native Cordis plugin (host) + web GUI settings card (browser) |
| Backend | MemoryOS REST API — `https://xmemo.dev` |
| Authentication | OAuth 2.1 + PKCE (recommended), or a static API key (compatibility) |
| Local storage | JSON hybrid store with a durable offline write queue |
| Tool surface | 16 tools, same names/schemas as `xmemo-cindy-plugin` |
| License | MIT |

### What it adds

- **Focused recall** — local token-overlap matches merged with cloud recall, fail-closed on any
  bucket/scope mismatch.
- **Durable outcomes** — remember decisions, preferences, and facts; record timeline events; track
  TODOs and decisions.
- **Working continuity** — active task state and restart snapshots so a session can resume instead
  of replaying history.
- **Offline resilience** — every write lands locally first; safe (idempotent) writes replay to the
  cloud automatically, uncertain ones wait for explicit approval.
- **Real account login** — OAuth 2.1 + PKCE against XMemo's actual authorization server, not just a
  pasted API key.
- **Recoverable deletion** — `xmemo_forget` defaults to a soft, recoverable delete.

## Quick start

Not yet published to npm (see [Known Limitations](#known-limitations)), so install from GitHub or a
local checkout:

```sh
dsh plugin --profile <name> add github:yonro/xmemo-deepseek-plugin
# or, from a local checkout:
dsh plugin --profile <name> add ./xmemo-deepseek-plugin
```

A git install fetches source, not the built `lib/`, so pnpm blocks this package's `prepare` script
(which builds both halves — see [Development](#development)) on the first `add` and prints the exact
key to allow. Add it to the profile's `pnpm-workspace.yaml` and re-run `add`:

```yaml
allowBuilds:
  dsh-xmemo: true
```

Connect an XMemo account or set an API key (see [Auth](#auth) below), then verify the row loaded:

```sh
dsh --profile <name> --dump-config   # look for "# == dsh-xmemo"
```

## Auth

Two methods, resolved in this order on every request (`src/auth.ts`) — never both at once:

1. **OAuth 2.1 + PKCE** (recommended). Connect from the web GUI's plugin card (see
   [Web GUI card](#web-gui-card)) or trigger it programmatically by writing a
   `connect:<anything>` value to the `XMEMO_OAUTH_ACTION` credential — `src/oauth.ts` listens for
   this via the seam-wide `credentials/updated` event. Connecting: registers a fresh public OAuth
   client through MemoryOS's Dynamic Client Registration (`POST /oauth/register`, one per connect
   attempt — cheap, and avoids caching a client_id with its own staleness edge cases), opens your
   default browser to `/oauth/authorize` with a PKCE challenge, and runs a temporary
   `127.0.0.1:<ephemeral-port>` HTTP listener as the redirect target — the same loopback-native-app
   pattern MemoryOS documents for Cindy's desktop OAuth flow (verified live against production
   `xmemo.dev`: DCR accepts a brand-new client's loopback `redirect_uri`, and `/oauth/authorize`
   accepts that client_id + PKCE + explicit `resource` end to end). The resulting access/refresh
   token pair is stored under the `XMEMO_OAUTH` credential reference and refreshed automatically
   (with rotation — a used refresh token is never replayed) a minute before it expires. Disconnect
   the same way with a `disconnect:<anything>` value, which also revokes both tokens server-side.
2. **Static API key** (fallback). Set the `XMEMO_KEY` credential through dsh's own credential seam
   — any of an environment variable (`XMEMO_KEY=... dsh --profile <name>`),
   `$DSH_HOME/.credentials.yaml` (`XMEMO_KEY: ...`), or `<project>/.env` / `$DSH_HOME/.env`. Sent as
   the `X-API-Key` header (MemoryOS's primary auth header — `Authorization: Bearer` is only its
   fallback; see `auth/api_key.py`). The credential reference name is configurable
   (`apiKeyCredential` in `cordis.patch.yml`) if you'd rather not use `XMEMO_KEY`.

Unlike Cindy, whose *host* runs the OAuth dance generically for any plugin that declares an "OAuth
credential source," `dsh` has no such primitive (see [Known Limitations](#known-limitations)) — this
plugin runs the whole flow itself in `src/oauth.ts`, with no deepseek-harness changes required.

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
`xmemo-cindy-plugin`'s tool surface.

| Area | Tools |
|---|---|
| Status & sync | `xmemo_status`, `xmemo_sync` |
| Working state | `xmemo_update_state`, `xmemo_save_progress`, `xmemo_restore_progress` |
| Timeline | `xmemo_record_event`, `xmemo_list_timeline` |
| Memory lifecycle | `xmemo_remember`, `xmemo_recall`, `xmemo_forget` |
| TODOs | `xmemo_create_todo`, `xmemo_list_todos`, `xmemo_complete_todo` |
| Decisions | `xmemo_create_decision`, `xmemo_list_decisions`, `xmemo_resolve_decision` |

Skill instructions (when to call which tool) are intentionally not part of this package — reuse
`xmemo-claude-plugin/skills/*/SKILL.md` as-is by dropping them into a project's `.agents/skills/`;
dsh's `skill-filesystem` provider discovers the same frontmatter format from that directory.

## Web GUI card

The `dsh --profile web` GUI's Settings → 插件配置 (Plugin Config) panel shows an "XMemo" card
alongside the first-party Bash/Agent-loop/Web-search cards, via a browser bundle this same package
ships (`src/client/`, built to `lib/client.js`, declared through the `dsh.client` manifest field in
`package.json` — no changes to deepseek-harness itself are needed; `dsh-client-modules` scans every
loaded plugin's `package.json` for that field, not just first-party ones).

Three controls are genuinely live:

- **XMemo account login** (recommended, shown first) — Connect/Disconnect buttons driving the OAuth
  flow described in [Auth](#auth). Its status badge names whichever method is actually in effect —
  `已连接 · OAuth`/`Connected · OAuth` or `已连接 · API Key`/`Connected · API key` — mirroring
  `auth.ts`'s own "OAuth first, API key fallback" precedence exactly, and only falls back to
  `未连接`/Not connected when neither is configured, so a working API-key setup never reads as
  broken just because OAuth hasn't been connected. When both happen to be configured at once, a
  short note under the button says so and states that OAuth is the one actually being used. Since
  this card has no direct RPC into host-side code (the same `credentials.*`-only constraint below),
  the buttons relay through the write-only `XMEMO_OAUTH_ACTION` signal credential rather than
  calling anything directly, then poll `credentials.describe('XMEMO_OAUTH')` (every 2s, up to ~5.5
  minutes) to detect when the browser login completes.
- **API key** (compatibility fallback) — reflects and can change the actual stored key via real
  `credentials.describe`/`credentials.set` calls, including correctly showing it as read-only when
  `XMEMO_KEY` is supplied by the launch environment rather than the credentials store.
- **Memory mode** — a real `<select>` (hybrid / local-only / cloud-only) with an explicit Save
  button, saved under the `XMEMO_MODE` credential reference and picked up by `src/mode.ts` on the
  very next tool call. Unlike the API key field, the select can't show which value is currently
  stored — `credentials.describe` deliberately never exposes a credential's value, only whether it's
  configured (see [Known Limitations](#known-limitations)) — so it always starts from the `hybrid`
  default and a "customized"/"default" badge stands in for the value itself, the same way the API
  key field's "configured" badge never reveals the secret.

The other five config fields (`apiBaseUrl`/`defaultScope`/`agentId`/`requestTimeoutMs`/
`longRequestTimeoutMs`) aren't shown in the card at all — their defaults are fine for the vast
majority of setups; override them via `cordis.patch.yml` (see [Config](#config)) if needed.

Build with `npm run build:client` (separate from the host build — needs its own `tsconfig.client.json`
and `scripts/build-client.mjs`, since the host and browser halves target different runtimes).

## Architecture notes

Ported from `xmemo-cindy-plugin/plugins/xmemo-memory/main.js`'s business logic:

- `src/http.ts` — request/error handling (`AUTH_REQUIRED`, `RATE_LIMITED`, `XMEMO_SERVER_ERROR`, …).
  One structural change from upstream: Cindy's host injected `Authorization` based on request
  hostname; this plugin resolves and attaches the auth header itself (`src/auth.ts`, `src/oauth.ts`).
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
- `src/oauth.ts` — the whole OAuth 2.1 + PKCE client: Dynamic Client Registration, an ephemeral
  loopback HTTP listener as the redirect target, token exchange/refresh with rotation, and revoke.

One acknowledged divergence: main.js's store is one dynamic JSON blob, so it can replay a queued
write generically. This port's store is typed per entity kind, so a **replayed** write (via
`xmemo_sync`, possibly in a later process) only generically patches `cloud_id` + `sync_status`;
richer field back-fill happens only on the first attempt, made synchronously inside the same tool
call. See the comment at the top of `src/outbox.ts`.

## Capabilities and boundaries

| Capability | Included | Boundary |
|---|:---:|---|
| Local-first hybrid memory | Yes | Local store is not encrypted at rest |
| OAuth 2.1 + PKCE login | Yes | Needs a desktop session to open a browser in; headless `dsh` falls back to the API key |
| Static API key auth | Yes | Compatibility fallback only — never sent alongside a connected OAuth session |
| Durable offline write queue | Yes | Non-idempotent writes wait in `held` for explicit replay approval |
| Recoverable deletion | Yes | `xmemo_forget` is soft delete by default |
| Web GUI settings card | Yes | Only OAuth login, the API key, and memory mode are editable from the browser — the other five config fields need `cordis.patch.yml` |
| Recall and search | Yes | Limited to memory visible to the authenticated account, and fail-closed on any bucket/scope mismatch |
| Cross-agent continuity | Yes | Other agents/clients need their own authorized XMemo connection |
| PII redaction | No | Only credential-like text is redacted, matching `xmemo-cindy-plugin` upstream |
| MCP transport | No | Talks to MemoryOS REST directly; dsh's own `dsh-mcp-client` bridge is a separate, untouched path |
| Bundled skill instructions | No | Reuse `xmemo-claude-plugin/skills/*/SKILL.md` instead — see [Tools](#tools) |
| Encryption at rest | No | Same as upstream — honest that there isn't one, see [Known Limitations](#known-limitations) |

## Known Limitations

- **Not published to npm yet.** `dsh plugin add dsh-xmemo` doesn't work today; install from GitHub
  or a local checkout instead — see [Quick start](#quick-start). Also not yet tagged with the
  `dsh-plugin` GitHub topic, the harness's only discovery mechanism ("Contribute to the ecosystem"
  in [`CONTRIBUTING.md`](https://github.com/deepseek-ai/deepseek-harness/blob/main/CONTRIBUTING.md))
  — DeepSeek Harness has no central plugin marketplace or submission process by design.
- **OAuth connect needs a desktop with a browser.** The flow opens a system browser and waits on a
  loopback listener for its redirect; a headless `dsh` instance (no desktop session to open a
  browser in) can't complete it — use the static API key there instead.
- **`XMEMO_OAUTH` and `XMEMO_OAUTH_ACTION` appear in `$DSH_HOME/.credentials.yaml` and the Models
  page's credentials list**, alongside `XMEMO_MODE` — an accepted tradeoff of reusing the one
  channel that's actually open to an out-of-tree plugin (see the web GUI card limitation below).
  `XMEMO_OAUTH` holds the access/refresh token pair as an opaque JSON blob; `XMEMO_OAUTH_ACTION` is
  a transient write-only signal, never holding anything meaningful at rest; `XMEMO_MODE` isn't a
  secret at all.
- **A fresh OAuth client is registered on every connect attempt** rather than cached — Dynamic
  Client Registration exists precisely for this kind of ad hoc self-registration, and skipping the
  cache avoids persisting a fourth credential ref with its own staleness edge cases. Each registered
  client is a self-verifying signed token MemoryOS never has to store server-side, so this has no
  accumulating cost.
- **No encryption at rest.** Same as upstream — the Cindy host's storage encryption, if any, was
  opaque to the plugin; this port is honest that there isn't one.
- **Single in-process store lock.** Concurrent `dsh` processes writing to the same store directory
  are not coordinated; run one instance per store directory.
- **PII redaction is not implemented**, matching upstream: `xmemo-cindy-plugin`'s tool descriptions
  claim email/phone redaction, but no such code exists in `main.js` either — it's server-side or
  aspirational. This port's tool descriptions say only what the code does.
- **Replayed writes only back-fill `cloud_id`**, not richer response fields — see Architecture notes.
- **The web GUI card can only edit OAuth login, `apiKeyCredential`, and `mode`; the other five
  config fields aren't editable from the browser at all.** The harness's generic
  settings-persistence pipeline (`ctx.settingsScope`) is gated by a hardcoded namespace allowlist in
  deepseek-harness's own `packages/host/apiproxy/src/api-proxy.ts` (`WEB_SETTINGS_NAMESPACES`) that
  an out-of-tree plugin cannot extend from its own package (the source comment there calls
  generalizing it "deferred work"). Only the ungated `credentials.*` RPC is open to third-party
  plugins today — the same channel `apiKeyCredential` already used for its API key — so `mode` and
  OAuth both piggyback on it too (`XMEMO_MODE`, `XMEMO_OAUTH`/`XMEMO_OAUTH_ACTION`), and the
  remaining five config fields have no open channel to bind to at all.
- **The mode selector can't show the currently saved value, only whether one has been saved.**
  `credentials.describe` reports `configured`/`writable` but never a credential's value — correct
  for secrets, but it means the mode select can't be pre-filled with the true stored mode the way
  Cindy's `/kv`-backed selector can. The select always starts from the `hybrid` default; saving
  always overwrites blindly, same as the API key field already does.

## Security and privacy

- **Credentials never reach plugin memory as browser-readable state.** The web GUI card only ever
  sees `configured`/`writable` booleans (`credentials.describe`) — it can change the API key, OAuth
  tokens, and mode, but never read their values back.
- **OAuth tokens are stored, not logged.** The access/refresh token pair lives under the `XMEMO_OAUTH`
  credential reference; refresh tokens rotate on every use, and a reused (already-consumed) refresh
  token is rejected server-side rather than silently accepted.
- **Obvious credential-like text is redacted before memory and timeline writes** (`src/redact.ts`,
  7 categories, ported verbatim from upstream) — a safeguard, not a substitute for keeping secrets
  out of prompts.
- **Local memory is private but not encrypted by this plugin** — protect the device and do not store
  secrets in memory content.
- **Deletion is recoverable by default.** `xmemo_forget` soft-deletes unless a caller explicitly
  requests a hard, permanent delete.
- **This repository contains no production credentials, tokens, or private memory** — only
  credential *reference names* (e.g. `XMEMO_KEY`), never values.

Canonical service policies: [Privacy policy](https://xmemo.dev/legal/privacy) ·
[Terms of service](https://xmemo.dev/legal/tos) · [Support](https://xmemo.dev/support)

## Development

```sh
npm install
npm run build         # tsc -> lib/ (host half)
npm run build:client   # tsc --emitDeclarationOnly + esbuild -> lib/client.js (browser half)
npm run typecheck
npm test               # node --test over tests/*.spec.ts
```

## Agent-readable metadata

| Field | Value |
|---|---|
| Package | `dsh-xmemo` |
| Plugin ID | `xmemo` |
| Runtime | DeepSeek Harness (`dsh`) |
| Version | `0.1.0` |
| Role | Native Cordis plugin + web GUI settings card |
| Service | `https://xmemo.dev` |
| Backend | MemoryOS REST API (not MCP) |
| Authentication | OAuth 2.1 + PKCE (recommended), or static API key via `XMEMO_KEY` |
| OAuth scopes | `memory:read memory:write` |
| Tool profile | 16 tools, same names/schemas as `xmemo-cindy-plugin` |
| Local storage | Yes — JSON hybrid store with a durable outbox, not encrypted |
| Repository | `https://github.com/yonro/xmemo-deepseek-plugin` |
| License | MIT |

## Links

- Product: https://xmemo.dev
- Account & API keys: https://xmemo.dev/me#api-keys
- Documentation: https://xmemo.dev/product/docs
- Support: https://xmemo.dev/support
- DeepSeek Harness: https://github.com/deepseek-ai/deepseek-harness
- Sibling plugins: [Cindy](https://github.com/yonro/xmemo-cindy-plugin) ·
  [Claude](https://github.com/yonro/xmemo-claude-plugin) ·
  [Codex](https://github.com/yonro/xmemo-codex-plugin) ·
  [Hermes Agent](https://github.com/yonro/hermes-xmemo-plugin) ·
  [OpenClaw](https://github.com/yonro/xmemo-openclaw-memory)

## License

[MIT](LICENSE) © 2026 Yonro
