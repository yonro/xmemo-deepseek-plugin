/**
 * Browser half of dsh-xmemo: a plugin-config card in the web GUI's Settings > 插件配置 panel. Pure
 * addition alongside the existing host half (../index.ts) — no host-side changes were needed,
 * since this card intentionally never touches `ctx.settingsScope` (see card-controller.ts).
 *
 * Local, minimal ambient types stand in for `@deepseek-ai/dsh-client-ui-slots` /
 * `@deepseek-ai/dsh-client-connection`, which this bundle intentionally does not depend on (kept
 * external surface small; the real runtime contract was verified by reading
 * deepseek-harness's packages/client/modules/src/client/{system,manifest}.ts directly, not by
 * type-checking against those packages).
 * @module dsh-xmemo/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CredentialsApi, MemoryMode } from './card-controller.ts'
import { XmemoCardController } from './card-controller.ts'
import { en, XMEMO_LOCALE_NS, zh } from './locales.ts'
import { XmemoCard } from './XmemoCard.tsx'

/** Credential reference this card manages; matches src/config.ts's apiKeyCredential default. */
const DEFAULT_API_KEY_REF = 'XMEMO_KEY'
/** Credential reference the mode selector saves to; matches src/mode.ts's `credentialRef('XMEMO_MODE')`. */
const DEFAULT_MODE_REF = 'XMEMO_MODE'
/** Matches src/config.ts's `mode` schema default — the value the select shows until a save overrides it. */
const DEFAULT_MODE: MemoryMode = 'hybrid'

interface SlotRegistration {
  name: string
  id: string
  order?: number
  locale?: string
  inject: () => unknown
}

interface SlotsService {
  register: (registration: SlotRegistration, component: unknown) => () => void
  inject: (name: string, factory: () => (() => void)) => () => void
}

interface LocaleService {
  register: (ns: string, dictionaries: Record<string, Record<string, string>>) => void
}

interface ConnectionService {
  api: { credentials: CredentialsApi }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: SlotsService
    locale: LocaleService
    connection: ConnectionService
  }
}

export const name = 'xmemo-client'
export const inject = ['slots', 'locale', 'connection']

export function apply(ctx: Context): void {
  ctx.locale.register(XMEMO_LOCALE_NS, { zh, en })
  const controller = new XmemoCardController(ctx.connection.api.credentials, DEFAULT_API_KEY_REF, DEFAULT_MODE_REF, DEFAULT_MODE)
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register(
    { name: 'settings.plugin.item', id: 'xmemo', order: 100, locale: XMEMO_LOCALE_NS, inject: () => controller.inject() },
    XmemoCard,
  ))
}
