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
  | 'oauthLabel'
  | 'oauthRecommendedBadge'
  | 'oauthConnectedViaOAuth'
  | 'oauthConnectedViaApiKey'
  | 'oauthNotConnected'
  | 'oauthHint'
  | 'oauthBothConfiguredNote'
  | 'oauthConnectButton'
  | 'oauthDisconnectButton'
  | 'oauthConnecting'
  | 'oauthDisconnecting'
  | 'oauthTimedOut'
  | 'oauthReadOnlyEnv'
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
  oauthLabel: 'XMemo 账号登录',
  oauthRecommendedBadge: '推荐',
  oauthConnectedViaOAuth: '已连接 · OAuth',
  oauthConnectedViaApiKey: '已连接 · API Key',
  oauthNotConnected: '未连接',
  oauthHint: '点击后会打开浏览器完成 XMemo 登录；连接后将优先使用此账号，无需再配置下方 API Key。',
  oauthBothConfiguredNote: 'OAuth 与 API Key 均已配置，当前优先使用 OAuth 登录。',
  oauthConnectButton: '连接 XMemo 账号',
  oauthDisconnectButton: '断开连接',
  oauthConnecting: '已打开浏览器，请在其中完成登录……',
  oauthDisconnecting: '正在断开连接……',
  oauthTimedOut: '连接超时，可以重试。',
  oauthReadOnlyEnv: '当前由启动环境变量提供，只读——在此处修改不会生效。',
  apiKeyLabel: 'API Key（兼容）',
  apiKeyHint: '写入后立即生效；已保存的值不会在此显示。未连接 OAuth 账号时用作后备认证方式。',
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
  oauthLabel: 'XMemo account login',
  oauthRecommendedBadge: 'Recommended',
  oauthConnectedViaOAuth: 'Connected · OAuth',
  oauthConnectedViaApiKey: 'Connected · API key',
  oauthNotConnected: 'Not connected',
  oauthHint: 'Opens a browser to sign in to XMemo. Once connected, this account is used automatically '
    + '— no need to set the API key below.',
  oauthBothConfiguredNote: 'Both OAuth and an API key are set up — OAuth takes priority right now.',
  oauthConnectButton: 'Connect XMemo account',
  oauthDisconnectButton: 'Disconnect',
  oauthConnecting: 'Browser opened — finish signing in there…',
  oauthDisconnecting: 'Disconnecting…',
  oauthTimedOut: 'Connection timed out — you can retry.',
  oauthReadOnlyEnv: 'Currently supplied by the launch environment — read-only here.',
  apiKeyLabel: 'API Key (compatibility)',
  apiKeyHint: 'Takes effect immediately once saved; a previously stored value never shows here. Used as a fallback when no OAuth account is connected.',
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
