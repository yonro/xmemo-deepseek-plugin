/**
 * The xmemo plugin-config card. Unlike the harness's own Bash/WebSearch cards, this one never
 * depends on `ctx.settingsScope` (no exposed namespace to bind to — see card-controller.ts's
 * header comment), so it always renders rather than hiding behind a `state.available` gate.
 */

import { useState } from 'react'
import type { XmemoCardFace, XmemoCardState } from './card-controller.ts'
import type { XmemoLocaleKey } from './locales.ts'

export interface XmemoCardProps extends XmemoCardFace {
  t: (key: XmemoLocaleKey) => string
  useXmemoCard: (selector: (state: XmemoCardState) => XmemoCardState) => XmemoCardState
}

const OTHER_FIELD_KEYS: XmemoLocaleKey[] = [
  'fieldMode',
  'fieldApiBaseUrl',
  'fieldDefaultScope',
  'fieldAgentId',
  'fieldRequestTimeoutMs',
  'fieldLongRequestTimeoutMs',
]

const colors = {
  card: '#1c1c1e',
  border: '#333336',
  text: '#e6e6e6',
  muted: '#9a9a9e',
  accent: '#5b8def',
  danger: '#e5626b',
  input: '#0f0f10',
}

export function XmemoCard(props: XmemoCardProps) {
  const [open, setOpen] = useState(false)
  const state = props.useXmemoCard(snapshot => snapshot)
  const t = props.t

  return (
    <li style={{ listStyle: 'none', border: `1px solid ${colors.border}`, borderRadius: 8, marginBottom: 8, background: colors.card }}>
      <button
        type="button"
        onClick={() => { setOpen(!open) }}
        aria-expanded={open}
        aria-label={`${t(open ? 'collapse' : 'expand')}: ${t('title')}`}
        style={{
          all: 'unset', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 8,
          width: '100%', padding: '10px 12px', cursor: 'pointer',
        }}
      >
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
          <span style={{ color: colors.text, fontWeight: 600 }}>{t('title')}</span>
          <span style={{ color: colors.muted, fontSize: 12 }}>{t('description')}</span>
        </span>
        {state.dirty ? <span style={{ color: colors.accent, fontSize: 12 }}>{t('unsaved')}</span> : null}
        <span style={{ color: colors.muted, transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 120ms' }}>▾</span>
      </button>
      {open
        ? (
          <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label htmlFor="xmemo-api-key" style={{ color: colors.text, fontSize: 13 }}>{t('apiKeyLabel')}</label>
                <span style={{ fontSize: 11, padding: '1px 6px', borderRadius: 4, color: state.apiKeyConfigured ? '#8fe0a8' : colors.muted, border: `1px solid ${state.apiKeyConfigured ? '#2f5c3d' : colors.border}` }}>
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
                  background: colors.input, border: `1px solid ${colors.border}`, borderRadius: 6,
                  color: colors.text, padding: '6px 8px', fontSize: 13,
                }}
              />
              <p style={{ color: colors.muted, fontSize: 12, margin: 0 }}>
                {state.apiKeyWritable ? t('apiKeyHint') : t('apiKeyReadOnlyEnv')}
              </p>
              {state.failed ? <p style={{ color: colors.danger, fontSize: 12, margin: 0 }} role="status">{t('saveFailed')}</p> : null}
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  disabled={!state.dirty || state.saving}
                  onClick={props.discard}
                  style={{ background: 'transparent', border: `1px solid ${colors.border}`, borderRadius: 6, color: colors.text, padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}
                >
                  {t('discard')}
                </button>
                <button
                  type="button"
                  disabled={!state.dirty || state.saving || !state.apiKeyWritable}
                  onClick={props.save}
                  style={{ background: colors.accent, border: 'none', borderRadius: 6, color: '#fff', padding: '4px 10px', fontSize: 12, cursor: 'pointer' }}
                >
                  {t(state.saving ? 'saving' : 'save')}
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, borderTop: `1px solid ${colors.border}`, paddingTop: 12 }}>
              <span style={{ color: colors.text, fontSize: 13, fontWeight: 600 }}>{t('otherFieldsTitle')}</span>
              <p style={{ color: colors.muted, fontSize: 12, margin: 0 }}>{t('otherFieldsHint')}</p>
              <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {OTHER_FIELD_KEYS.map(key => (
                  <li key={key} style={{ color: colors.muted, fontSize: 12 }}>{t(key)}</li>
                ))}
              </ul>
            </div>
          </div>
        )
        : null}
    </li>
  )
}
