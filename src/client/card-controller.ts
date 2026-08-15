/**
 * Credential-only card controller, modeled on deepseek-harness's own
 * packages/client/ui-settings-plugins/src/client/web-search-card-controller.ts (readCredential /
 * writeKey shape) but without its CardForm/settings-scope half: our other six config fields have
 * no exposed settings namespace to bind to (see README "Known Limitations"), so this controller
 * stages and saves exactly one field, the XMemo API key, through the credentials RPC — the one
 * channel that is genuinely ungated for an out-of-tree plugin.
 *
 * Local, minimal types stand in for the harness's own `IApiClient`/`SnapshotStore` (which live in
 * client packages we intentionally do not depend on, to keep this bundle's external surface small
 * and avoid another out-of-tree version-skew fight) — only the exact runtime shape this file calls
 * matters, verified against the live GUI rather than against those packages' own type exports.
 */

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
}

export interface XmemoCardFace {
  hooks: { xmemoCard: Snapshot<XmemoCardState> }
  editApiKey: (text: string) => void
  save: () => void
  discard: () => void
}

export class XmemoCardController {
  private readonly store: Store<XmemoCardState>
  private draft = ''
  private saving = false
  private failed = false
  private credential: CredentialDescriptor = { configured: false, writable: true }

  constructor(private readonly api: CredentialsApi, private readonly ref: string) {
    this.store = new Store(this.projection())
    void this.readCredential()
  }

  private projection(): XmemoCardState {
    return {
      dirty: this.draft.length > 0,
      saving: this.saving,
      failed: this.failed,
      apiKeyDraft: this.draft,
      apiKeyConfigured: this.credential.configured,
      apiKeyWritable: this.credential.writable,
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

  inject(): XmemoCardFace {
    return {
      hooks: { xmemoCard: this.store },
      editApiKey: this.editApiKey,
      save: this.save,
      discard: this.discard,
    }
  }
}
