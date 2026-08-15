/**
 * Locale dictionary for the xmemo plugin-config card, under its own namespace (we cannot add keys
 * to the harness's own 'settings.plugins' dictionary — that package's en/zh objects are private
 * closure state, per packages/client/AGENTS.md's export discipline).
 */

export const XMEMO_LOCALE_NS = 'settings.plugins.xmemo'

export type XmemoLocaleKey =
  | 'title'
  | 'description'
  | 'expand'
  | 'collapse'
  | 'apiKeyLabel'
  | 'apiKeyHint'
  | 'apiKeyConfigured'
  | 'apiKeyNotConfigured'
  | 'apiKeyReadOnlyEnv'
  | 'save'
  | 'saving'
  | 'discard'
  | 'saveFailed'
  | 'unsaved'
  | 'otherFieldsTitle'
  | 'otherFieldsReadOnlyBadge'
  | 'otherFieldsHint'
  | 'fieldModeDesc'
  | 'fieldApiBaseUrlDesc'
  | 'fieldDefaultScopeDesc'
  | 'fieldAgentIdDesc'
  | 'fieldRequestTimeoutMsDesc'
  | 'fieldLongRequestTimeoutMsDesc'

export const zh: Record<XmemoLocaleKey, string> = {
  title: 'XMemo',
  description: '混合本地与 XMemo 云端记忆——远程状态、时间线、TODO、决策与断点续传。',
  expand: '展开',
  collapse: '收起',
  apiKeyLabel: 'XMemo API Key',
  apiKeyHint: '写入后立即生效；已保存的值不会在此显示。',
  apiKeyConfigured: '已配置',
  apiKeyNotConfigured: '未配置',
  apiKeyReadOnlyEnv: '当前由启动环境变量提供，只读——在此处修改不会生效，请改动进程环境变量后重启。',
  save: '保存',
  saving: '保存中…',
  discard: '放弃修改',
  saveFailed: '保存失败，请重试。',
  unsaved: '有未保存的修改',
  otherFieldsTitle: '其他配置项',
  otherFieldsReadOnlyBadge: '只读',
  otherFieldsHint: '通过插件的 cordis.patch.yml 配置；下方为字段名、默认值与作用。',
  fieldModeDesc: '本地/云端写入策略',
  fieldApiBaseUrlDesc: 'MemoryOS API 地址',
  fieldDefaultScopeDesc: '未指定 scope 时的默认值',
  fieldAgentIdDesc: 'X-Memory-OS-Agent-ID 请求头',
  fieldRequestTimeoutMsDesc: '默认请求超时（毫秒）',
  fieldLongRequestTimeoutMsDesc: 'recall / restore 超时（毫秒）',
}

export const en: Record<XmemoLocaleKey, string> = {
  title: 'XMemo',
  description: 'Hybrid local + XMemo cloud memory — state, timeline, TODOs, decisions, restart snapshots.',
  expand: 'Expand',
  collapse: 'Collapse',
  apiKeyLabel: 'XMemo API Key',
  apiKeyHint: 'Takes effect immediately once saved; a previously stored value never shows here.',
  apiKeyConfigured: 'Configured',
  apiKeyNotConfigured: 'Not configured',
  apiKeyReadOnlyEnv: 'Currently supplied by the launch environment — read-only here; edit the process environment and restart to change it.',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  saveFailed: 'Save failed — try again.',
  unsaved: 'Unsaved changes',
  otherFieldsTitle: 'Other configuration',
  otherFieldsReadOnlyBadge: 'Read-only',
  otherFieldsHint: "Set in the plugin's cordis.patch.yml; field, default, and purpose below.",
  fieldModeDesc: 'Local/cloud write policy',
  fieldApiBaseUrlDesc: 'MemoryOS API base URL',
  fieldDefaultScopeDesc: 'Default scope when a call omits one',
  fieldAgentIdDesc: 'X-Memory-OS-Agent-ID header value',
  fieldRequestTimeoutMsDesc: 'Default request timeout (ms)',
  fieldLongRequestTimeoutMsDesc: 'recall/restore timeout (ms)',
}

/** Field identifiers and their defaults are config syntax, not prose — kept out of the locale dictionaries. */
export interface OtherFieldSpec {
  key: string
  defaultValue: string
  descriptionKey: XmemoLocaleKey
}

export const OTHER_FIELDS: OtherFieldSpec[] = [
  { key: 'mode', defaultValue: 'hybrid | local-only | cloud-only', descriptionKey: 'fieldModeDesc' },
  { key: 'apiBaseUrl', defaultValue: 'https://xmemo.dev', descriptionKey: 'fieldApiBaseUrlDesc' },
  { key: 'defaultScope', defaultValue: 'dsh', descriptionKey: 'fieldDefaultScopeDesc' },
  { key: 'agentId', defaultValue: 'dsh', descriptionKey: 'fieldAgentIdDesc' },
  { key: 'requestTimeoutMs', defaultValue: '30000', descriptionKey: 'fieldRequestTimeoutMsDesc' },
  { key: 'longRequestTimeoutMs', defaultValue: '60000', descriptionKey: 'fieldLongRequestTimeoutMsDesc' },
]
