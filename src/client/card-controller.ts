/**
 * Credential-only card controller, modeled on deepseek-harness's own
 * packages/client/ui-settings-plugins/src/client/web-search-card-controller.ts (readCredential /
 * writeKey shape) but without its CardForm/settings-scope half: our other config fields have no
 * exposed settings namespace to bind to (see README "Known Limitations"), so this controller
 * stages and saves exactly two fields — the XMemo API key and the memory mode — through the
 * credentials RPC, the one channel that is genuinely ungated for an out-of-tree plugin.
 *
 * The mode control mirrors xmemo-cindy-plugin's settings.js (a real `<select>` plus an explicit
 * Save button, not autosave-on-change) rather than the API key field's own UX, for one structural
 * reason: `credentials.describe` (see api-proxy.ts) only ever reports `configured`/`writable`,
 * never the stored value — by design, since this channel exists for secrets. Cindy's `/kv` store
 * has no such restriction and can echo the saved mode back on load; we cannot. So the select
 * always starts from `defaultMode` and a "customized"/"default" badge stands in for the value we
 * structurally cannot read back, exactly like the API key field's own "configured" badge never
 * reveals the secret itself.
 *
 * Local, minimal types stand in for the harness's own `IApiClient`/`SnapshotStore` (which live in
 * client packages we intentionally do not depend on, to keep this bundle's external surface small
 * and avoid another out-of-tree version-skew fight) — only the exact runtime shape this file calls
 * matters, verified against the live GUI rather than against those packages' own type exports.
 *
 * OAuth connect/disconnect follows the same "no RPC surface beyond credentials.*" constraint: this
 * card cannot invoke host-side code directly, so it relays through a write-only signal credential
 * (`oauthActionRef`, `XMEMO_OAUTH_ACTION`) that src/oauth.ts listens for via `credentials/updated`.
 * After signaling, the only way to observe progress is polling `describe(oauthBundleRef)` — the same
 * describe-only, value-never limitation the mode control already works within.
 */

export type MemoryMode = 'hybrid' | 'local-only' | 'cloud-only'

const MODE_VALUES: readonly MemoryMode[] = ['hybrid', 'local-only', 'cloud-only']

function isMemoryMode(value: string): value is MemoryMode {
  return (MODE_VALUES as readonly string[]).includes(value)
}

export interface CredentialDescriptor {
  configured: boolean
  writable: boolean
}

export interface CredentialsApi {
  describe(args: { refs: string[] }): Promise<
    { result: { ok: true; value: { credentials: Record<string, CredentialDescriptor | undefined> } } }
    | { result: { ok: false; error?: unknown } }
  >
  set(args: { ref: string; value: string }): Promise<{ result: { ok: boolean; error?: unknown } } | void>
}

export interface XmemoCardControllerRefs {
  apiKeyRef: string
  modeRef: string
  defaultMode: MemoryMode
  oauthBundleRef: string
  oauthActionRef: string
}

/** Client-side nonce so a repeated identical action (e.g. two "connect" clicks) still updates the signal ref. */
function actionNonce(): string {
  return Math.random().toString(36).slice(2)
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Poll `check` until it reports done or `timeoutMs` elapses; returns whether it completed in time. */
async function pollUntil(check: () => Promise<boolean>, intervalMs: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await check()) return true
    if (Date.now() >= deadline) return false
    await wait(intervalMs)
  }
}

/** Snapshot store shape the slot renderer binds a `use<Name>` hook from (matches the harness's own `hooks` compartment convention). */
export interface Snapshot<T> {
  getSnapshot: () => T
  subscribe: (listener: () => void) => () => void
}

class Store<T> implements Snapshot<T> {
  private value: T
  private readonly listeners = new Set<() => void>()

  constructor(initial: T) {
    this.value = initial
  }

  getSnapshot = (): T => this.value

  set(next: T): void {
    this.value = next
    for (const listener of this.listeners) listener()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}

export interface XmemoCardState {
  dirty: boolean
  saving: boolean
  failed: boolean
  apiKeyDraft: string
  apiKeyConfigured: boolean
  apiKeyWritable: boolean
  mode: MemoryMode
  modeConfigured: boolean
  modeWritable: boolean
  modeSaving: boolean
  modeSaved: boolean
  modeFailed: boolean
  oauthConnected: boolean
  oauthWritable: boolean
  oauthConnecting: boolean
  oauthDisconnecting: boolean
  oauthTimedOut: boolean
}

export interface XmemoCardFace {
  hooks: { xmemoCard: Snapshot<XmemoCardState> }
  editApiKey: (text: string) => void
  save: () => void
  discard: () => void
  editMode: (value: string) => void
  saveMode: () => void
  connectOAuth: () => void
  disconnectOAuth: () => void
}

/** Client-observable budget for a browser-login round trip; kept slightly above oauth.ts's own 5-minute host-side timeout. */
const CONNECT_POLL_TIMEOUT_MS = 5.5 * 60 * 1000
const CONNECT_POLL_INTERVAL_MS = 2_000
/** Disconnect never waits on a human — just a local revoke + unset round trip. */
const DISCONNECT_POLL_TIMEOUT_MS = 15_000
const DISCONNECT_POLL_INTERVAL_MS = 1_000

export class XmemoCardController {
  private readonly store: Store<XmemoCardState>
  private draft = ''
  private saving = false
  private failed = false
  private credential: CredentialDescriptor = { configured: false, writable: true }
  private mode: MemoryMode
  private modeCredential: CredentialDescriptor = { configured: false, writable: true }
  private modeSaving = false
  private modeSaved = false
  private modeFailed = false
  private oauthCredential: CredentialDescriptor = { configured: false, writable: true }
  private oauthConnecting = false
  private oauthDisconnecting = false
  private oauthTimedOut = false
  private readonly ref: string
  private readonly modeRef: string
  private readonly oauthBundleRef: string
  private readonly oauthActionRef: string

  constructor(private readonly api: CredentialsApi, refs: XmemoCardControllerRefs) {
    this.ref = refs.apiKeyRef
    this.modeRef = refs.modeRef
    this.mode = refs.defaultMode
    this.oauthBundleRef = refs.oauthBundleRef
    this.oauthActionRef = refs.oauthActionRef
    this.store = new Store(this.projection())
    void this.readCredential()
    void this.readModeCredential()
    void this.readOAuthCredential()
  }

  private projection(): XmemoCardState {
    return {
      dirty: this.draft.length > 0,
      saving: this.saving,
      failed: this.failed,
      apiKeyDraft: this.draft,
      apiKeyConfigured: this.credential.configured,
      apiKeyWritable: this.credential.writable,
      mode: this.mode,
      modeConfigured: this.modeCredential.configured,
      modeWritable: this.modeCredential.writable,
      modeSaving: this.modeSaving,
      modeSaved: this.modeSaved,
      modeFailed: this.modeFailed,
      oauthConnected: this.oauthCredential.configured,
      oauthWritable: this.oauthCredential.writable,
      oauthConnecting: this.oauthConnecting,
      oauthDisconnecting: this.oauthDisconnecting,
      oauthTimedOut: this.oauthTimedOut,
    }
  }

  private publish(): void {
    this.store.set(this.projection())
  }

  private async readCredential(): Promise<void> {
    let response: Awaited<ReturnType<CredentialsApi['describe']>>
    try {
      response = await this.api.describe({ refs: [this.ref] })
    } catch {
      // The card stays usable without this — the key control just keeps showing the last known state.
      return
    }
    if (!response.result.ok) return
    const view = response.result.value.credentials[this.ref]
    this.credential = { configured: view?.configured ?? false, writable: view?.writable ?? true }
    this.publish()
  }

  editApiKey = (text: string): void => {
    this.draft = text
    this.failed = false
    this.publish()
  }

  save = (): void => {
    if (this.draft.length === 0 || this.saving || !this.credential.writable) return
    this.saving = true
    this.failed = false
    this.publish()
    void (async () => {
      try {
        await this.api.set({ ref: this.ref, value: this.draft })
        this.draft = ''
      } catch {
        this.failed = true
      }
      this.saving = false
      await this.readCredential()
      this.publish()
    })()
  }

  discard = (): void => {
    this.draft = ''
    this.failed = false
    this.publish()
  }

  private async readModeCredential(): Promise<void> {
    let response: Awaited<ReturnType<CredentialsApi['describe']>>
    try {
      response = await this.api.describe({ refs: [this.modeRef] })
    } catch {
      return
    }
    if (!response.result.ok) return
    const view = response.result.value.credentials[this.modeRef]
    this.modeCredential = { configured: view?.configured ?? false, writable: view?.writable ?? true }
    this.publish()
  }

  editMode = (value: string): void => {
    if (!isMemoryMode(value)) return
    this.mode = value
    this.modeSaved = false
    this.modeFailed = false
    this.publish()
  }

  saveMode = (): void => {
    if (this.modeSaving || !this.modeCredential.writable) return
    this.modeSaving = true
    this.modeFailed = false
    this.modeSaved = false
    this.publish()
    void (async () => {
      try {
        await this.api.set({ ref: this.modeRef, value: this.mode })
        this.modeSaved = true
      } catch {
        this.modeFailed = true
      }
      this.modeSaving = false
      await this.readModeCredential()
      this.publish()
    })()
  }

  private async readOAuthCredential(): Promise<void> {
    let response: Awaited<ReturnType<CredentialsApi['describe']>>
    try {
      response = await this.api.describe({ refs: [this.oauthBundleRef] })
    } catch {
      return
    }
    if (!response.result.ok) return
    const view = response.result.value.credentials[this.oauthBundleRef]
    this.oauthCredential = { configured: view?.configured ?? false, writable: view?.writable ?? true }
    this.publish()
  }

  connectOAuth = (): void => {
    if (this.oauthConnecting || this.oauthDisconnecting) return
    this.oauthConnecting = true
    this.oauthTimedOut = false
    this.publish()
    void (async () => {
      try {
        await this.api.set({ ref: this.oauthActionRef, value: `connect:${actionNonce()}` })
      } catch {
        this.oauthConnecting = false
        this.publish()
        return
      }
      const completed = await pollUntil(
        async () => {
          await this.readOAuthCredential()
          return this.oauthCredential.configured
        },
        CONNECT_POLL_INTERVAL_MS,
        CONNECT_POLL_TIMEOUT_MS,
      )
      this.oauthConnecting = false
      this.oauthTimedOut = !completed
      this.publish()
    })()
  }

  disconnectOAuth = (): void => {
    if (this.oauthConnecting || this.oauthDisconnecting || !this.oauthCredential.configured) return
    this.oauthDisconnecting = true
    this.publish()
    void (async () => {
      try {
        await this.api.set({ ref: this.oauthActionRef, value: `disconnect:${actionNonce()}` })
      } catch {
        this.oauthDisconnecting = false
        this.publish()
        return
      }
      await pollUntil(
        async () => {
          await this.readOAuthCredential()
          return !this.oauthCredential.configured
        },
        DISCONNECT_POLL_INTERVAL_MS,
        DISCONNECT_POLL_TIMEOUT_MS,
      )
      this.oauthDisconnecting = false
      this.publish()
    })()
  }

  inject(): XmemoCardFace {
    return {
      hooks: { xmemoCard: this.store },
      editApiKey: this.editApiKey,
      save: this.save,
      discard: this.discard,
      editMode: this.editMode,
      saveMode: this.saveMode,
      connectOAuth: this.connectOAuth,
      disconnectOAuth: this.disconnectOAuth,
    }
  }
}
