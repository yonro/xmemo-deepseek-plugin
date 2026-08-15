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
  | 'otherFieldsHint'
  | 'fieldMode'
  | 'fieldApiBaseUrl'
  | 'fieldDefaultScope'
  | 'fieldAgentId'
  | 'fieldRequestTimeoutMs'
  | 'fieldLongRequestTimeoutMs'

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
  otherFieldsTitle: '其他配置项（只读）',
  otherFieldsHint: '以下字段通过插件的 cordis.patch.yml 配置，当前面板不支持在线修改；括号内为默认值。',
  fieldMode: 'mode（hybrid｜local-only｜cloud-only）：本地/云端写入策略',
  fieldApiBaseUrl: 'apiBaseUrl（https://xmemo.dev）：MemoryOS API 地址',
  fieldDefaultScope: 'defaultScope（dsh）：未指定 scope 时的默认值',
  fieldAgentId: 'agentId（dsh）：X-Memory-OS-Agent-ID 请求头',
  fieldRequestTimeoutMs: 'requestTimeoutMs（30000）：默认请求超时（毫秒）',
  fieldLongRequestTimeoutMs: 'longRequestTimeoutMs（60000）：recall/restore 超时（毫秒）',
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
  otherFieldsTitle: 'Other configuration (read-only)',
  otherFieldsHint: "These fields are set in the plugin's cordis.patch.yml; this panel does not edit them live. Defaults shown in parentheses.",
  fieldMode: 'mode (hybrid | local-only | cloud-only): local/cloud write policy',
  fieldApiBaseUrl: 'apiBaseUrl (https://xmemo.dev): MemoryOS API base URL',
  fieldDefaultScope: 'defaultScope (dsh): default scope when a call omits one',
  fieldAgentId: 'agentId (dsh): X-Memory-OS-Agent-ID header value',
  fieldRequestTimeoutMs: 'requestTimeoutMs (30000): default request timeout (ms)',
  fieldLongRequestTimeoutMs: 'longRequestTimeoutMs (60000): recall/restore timeout (ms)',
}
