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
  | 'modeLabel'
  | 'modeHint'
  | 'modeReadOnlyEnv'
  | 'modeCustomized'
  | 'modeDefault'
  | 'modeSaved'
  | 'modeOptionHybrid'
  | 'modeOptionLocalOnly'
  | 'modeOptionCloudOnly'

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
  modeLabel: '记忆体模式',
  modeHint: '保存后立即生效。出于安全设计，这里无法回显云端已保存的具体选项——未修改前默认显示 hybrid，选择新值并保存即可覆盖。',
  modeReadOnlyEnv: '当前由启动环境变量提供，只读——在此处修改不会生效，请改动进程环境变量后重启。',
  modeCustomized: '已自定义',
  modeDefault: '默认',
  modeSaved: '记忆体模式已保存。',
  modeOptionHybrid: '混合：本地 + 云端',
  modeOptionLocalOnly: '仅本地',
  modeOptionCloudOnly: '仅云端',
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
  modeLabel: 'Memory mode',
  modeHint: "Takes effect immediately once saved. For security, the saved selection can't be read back here — this defaults to Hybrid until you choose a value and save.",
  modeReadOnlyEnv: 'Currently supplied by the launch environment — read-only here; edit the process environment and restart to change it.',
  modeCustomized: 'Customized',
  modeDefault: 'Default',
  modeSaved: 'Memory mode saved.',
  modeOptionHybrid: 'Hybrid: local + cloud',
  modeOptionLocalOnly: 'Local only',
  modeOptionCloudOnly: 'Cloud only',
}
