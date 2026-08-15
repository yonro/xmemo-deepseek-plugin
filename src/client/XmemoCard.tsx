/**
 * The xmemo plugin-config card. Unlike the harness's own Bash/WebSearch cards, this one never
 * depends on `ctx.settingsScope` (no exposed namespace to bind to — see card-controller.ts's
 * header comment), so it always renders rather than hiding behind a `state.available` gate.
 *
 * Visual tokens below are not guessed — read directly off the live GUI's computed styles for the
 * real Bash/AgentLoop/WebSearch cards (card background/border/radius, header padding/gap, title
 * and description type scale, and the chevron SVG's exact path) so this card sits visually
 * indistinguishable among them rather than merely "close." The shared `<ul>` those cards render
 * into already applies `gap: 10px` between cards, so this component must not add its own
 * margin-bottom — doing so double-spaces this card from its neighbors.
 */

import { useState } from 'react'
import type { XmemoCardFace, XmemoCardState } from './card-controller.ts'
import type { XmemoLocaleKey } from './locales.ts'

export interface XmemoCardProps extends XmemoCardFace {
  t: (key: XmemoLocaleKey) => string
  useXmemoCard: (selector: (state: XmemoCardState) => XmemoCardState) => XmemoCardState
}

/** Matches the live GUI's own tokens exactly (see module comment) — not an approximation. */
const colors = {
  card: 'rgb(53, 54, 56)',
  cardBorder: 'rgba(255, 255, 255, 0.12)',
  text: 'rgb(249, 250, 251)',
  muted: 'rgb(173, 178, 184)',
  divider: 'rgba(255, 255, 255, 0.12)',
  inputBg: 'rgba(0, 0, 0, 0.25)',
  accent: '#5b8def',
  danger: '#e5626b',
  okBorder: '#2f5c3d',
  okText: '#8fe0a8',
}

/** The exact chevron icon the live GUI's own cards use (packages/client/ui-settings-plugins). */
function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 120ms', flexShrink: 0 }}
    >
      <path
        d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z"
        fill="currentColor"
      />
    </svg>
  )
}

/**
 * Authenticated when either method is set up — the API key counts as fully "connected" too, matching
 * auth.ts's own fallback — and the badge names which one is actually in effect (OAuth wins when both
 * are present, mirroring auth.ts exactly) rather than leaving that ambiguous.
 */
function oauthBadge(state: XmemoCardState): { key: XmemoLocaleKey; color: string; border: string } {
  if (state.oauthConnected) return { key: 'oauthConnectedViaOAuth', color: colors.okText, border: colors.okBorder }
  if (state.apiKeyConfigured) return { key: 'oauthConnectedViaApiKey', color: colors.okText, border: colors.okBorder }
  return { key: 'oauthNotConnected', color: colors.muted, border: colors.cardBorder }
}

export function XmemoCard(props: XmemoCardProps) {
  const [open, setOpen] = useState(false)
  const state = props.useXmemoCard(snapshot => snapshot)
  const t = props.t
  const badge = oauthBadge(state)

  return (
    <li style={{ listStyle: 'none', border: `0.666667px solid ${colors.cardBorder}`, borderRadius: 12, background: colors.card }}>
      <button
        type="button"
        onClick={() => { setOpen(!open) }}
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}设置: ${t('title')}`}
        style={{
          all: 'unset', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 12,
          width: '100%', padding: '14px 16px', cursor: 'pointer', color: colors.text, fontSize: 14,
        }}
      >
        <span style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <span style={{ color: colors.text, fontSize: 15, fontWeight: 600, lineHeight: '21px' }}>{t('title')}</span>
          <span style={{ color: colors.muted, fontSize: 13, lineHeight: '19.5px' }}>{t('description')}</span>
        </span>
        {state.dirty ? <span style={{ color: colors.accent, fontSize: 12 }}>{t('unsaved')}</span> : null}
        <Chevron open={open} />
      </button>
      {open
        ? (
          <div style={{ padding: '0 16px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ color: colors.text, fontSize: 13 }}>{t('oauthLabel')}</span>
                <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, color: colors.accent, border: `1px solid ${colors.accent}` }}>
                  {t('oauthRecommendedBadge')}
                </span>
                <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, color: badge.color, border: `1px solid ${badge.border}` }}>
                  {t(badge.key)}
                </span>
              </div>
              <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>
                {state.oauthWritable ? t('oauthHint') : t('oauthReadOnlyEnv')}
              </p>
              {state.oauthConnected && state.apiKeyConfigured
                ? <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>{t('oauthBothConfiguredNote')}</p>
                : null}
              {state.oauthConnecting ? <p style={{ color: colors.accent, fontSize: 13, margin: 0 }} role="status">{t('oauthConnecting')}</p> : null}
              {state.oauthDisconnecting ? <p style={{ color: colors.accent, fontSize: 13, margin: 0 }} role="status">{t('oauthDisconnecting')}</p> : null}
              {state.oauthTimedOut ? <p style={{ color: colors.danger, fontSize: 13, margin: 0 }} role="status">{t('oauthTimedOut')}</p> : null}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                {state.oauthConnected
                  ? (
                    <button
                      type="button"
                      disabled={state.oauthDisconnecting || state.oauthConnecting}
                      onClick={props.disconnectOAuth}
                      style={{ background: 'transparent', border: `0.666667px solid ${colors.cardBorder}`, borderRadius: 8, color: colors.text, padding: '5px 12px', fontSize: 13, cursor: 'pointer' }}
                    >
                      {t('oauthDisconnectButton')}
                    </button>
                  )
                  : (
                    <button
                      type="button"
                      disabled={state.oauthConnecting || state.oauthDisconnecting || !state.oauthWritable}
                      onClick={props.connectOAuth}
                      style={{ background: colors.accent, border: 'none', borderRadius: 8, color: '#fff', padding: '5px 12px', fontSize: 13, cursor: 'pointer' }}
                    >
                      {t('oauthConnectButton')}
                    </button>
                  )}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: `0.666667px solid ${colors.divider}`, paddingTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label htmlFor="xmemo-api-key" style={{ color: colors.text, fontSize: 13 }}>{t('apiKeyLabel')}</label>
                <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, color: state.apiKeyConfigured ? colors.okText : colors.muted, border: `1px solid ${state.apiKeyConfigured ? colors.okBorder : colors.cardBorder}` }}>
                  {t(state.apiKeyConfigured ? 'apiKeyConfigured' : 'apiKeyNotConfigured')}
                </span>
              </div>
              <input
                id="xmemo-api-key"
                type="password"
                autoComplete="off"
                value={state.apiKeyDraft}
                disabled={!state.apiKeyWritable || state.saving}
                onChange={(event) => { props.editApiKey(event.target.value) }}
                style={{
                  background: colors.inputBg, border: `0.666667px solid ${colors.cardBorder}`, borderRadius: 8,
                  color: colors.text, padding: '8px 10px', fontSize: 13,
                }}
              />
              <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>
                {state.apiKeyWritable ? t('apiKeyHint') : t('apiKeyReadOnlyEnv')}
              </p>
              {state.failed ? <p style={{ color: colors.danger, fontSize: 13, margin: 0 }} role="status">{t('saveFailed')}</p> : null}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  disabled={!state.dirty || state.saving}
                  onClick={props.discard}
                  style={{ background: 'transparent', border: `0.666667px solid ${colors.cardBorder}`, borderRadius: 8, color: colors.text, padding: '5px 12px', fontSize: 13, cursor: 'pointer' }}
                >
                  {t('discard')}
                </button>
                <button
                  type="button"
                  disabled={!state.dirty || state.saving || !state.apiKeyWritable}
                  onClick={props.save}
                  style={{ background: colors.accent, border: 'none', borderRadius: 8, color: '#fff', padding: '5px 12px', fontSize: 13, cursor: 'pointer' }}
                >
                  {t(state.saving ? 'saving' : 'save')}
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: `0.666667px solid ${colors.divider}`, paddingTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label htmlFor="xmemo-mode" style={{ color: colors.text, fontSize: 13 }}>{t('modeLabel')}</label>
                <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, color: state.modeConfigured ? colors.okText : colors.muted, border: `1px solid ${state.modeConfigured ? colors.okBorder : colors.cardBorder}` }}>
                  {t(state.modeConfigured ? 'modeCustomized' : 'modeDefault')}
                </span>
              </div>
              <select
                id="xmemo-mode"
                value={state.mode}
                disabled={!state.modeWritable || state.modeSaving}
                onChange={(event) => { props.editMode(event.target.value) }}
                style={{
                  background: colors.inputBg, border: `0.666667px solid ${colors.cardBorder}`, borderRadius: 8,
                  color: colors.text, padding: '8px 10px', fontSize: 13,
                }}
              >
                <option value="hybrid">{t('modeOptionHybrid')}</option>
                <option value="local-only">{t('modeOptionLocalOnly')}</option>
                <option value="cloud-only">{t('modeOptionCloudOnly')}</option>
              </select>
              <p style={{ color: colors.muted, fontSize: 13, margin: 0 }}>
                {state.modeWritable ? t('modeHint') : t('modeReadOnlyEnv')}
              </p>
              {state.modeFailed ? <p style={{ color: colors.danger, fontSize: 13, margin: 0 }} role="status">{t('saveFailed')}</p> : null}
              {state.modeSaved ? <p style={{ color: colors.okText, fontSize: 13, margin: 0 }} role="status">{t('modeSaved')}</p> : null}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  disabled={state.modeSaving || !state.modeWritable}
                  onClick={props.saveMode}
                  style={{ background: colors.accent, border: 'none', borderRadius: 8, color: '#fff', padding: '5px 12px', fontSize: 13, cursor: 'pointer' }}
                >
                  {t(state.modeSaving ? 'saving' : 'save')}
                </button>
              </div>
            </div>
          </div>
        )
        : null}
    </li>
  )
}
