/**
 * INPUT:  raw config.list keys (and the entries carrying them) plus an operator search query
 * OUTPUT: the key→group/Chinese-label presentation map, grouped knob views (fixed group order, Core order preserved)
 *         and the client-side search filter
 * POS:    ui/windows/home/pages/settings — client-side presentation map only (U7); Core stays the only authority and
 *         the server order inside a group is never re-sorted. Unknown keys fall back to the 高级 group; their label
 *         falls back to the raw key. Settings presents the six model connection keys through grouped profile cards.
 */
import type { ConfigEntry } from "@taki/shared";

export type ConfigGroupId = "permissions" | "model-context" | "perception-privacy" | "storage-cache" | "advanced";

export interface ConfigGroupMeta {
  id: ConfigGroupId;
  label: string;
  hint: string;
}

/** Fixed display order; groups without entries are skipped by groupConfigEntries. */
export const CONFIG_GROUPS: readonly ConfigGroupMeta[] = [
  { id: "permissions", label: "权限与审批", hint: "审批门槛、权限治理与操作员信任相关项。" },
  { id: "model-context", label: "模型与上下文", hint: "模型槽位、上下文窗口与压缩行为。" },
  { id: "perception-privacy", label: "感知与隐私", hint: "环境感知采样与隐私边界。" },
  { id: "storage-cache", label: "存储与缓存", hint: "数据目录与附件保留策略。" },
  { id: "advanced", label: "高级", hint: "服务引导、连接时序、记忆与集成等进阶项。" },
];

/** Exact key → group + Chinese primary label. Keys mirror core/config knob-registry rows. */
const EXACT_LABELS: Record<string, { group: ConfigGroupId; label: string }> = {
  TAKI_TRUST_LOOPBACK_OPERATOR: { group: "permissions", label: "回环操作员自动信任" },
  TAKI_MONITOR_MODE: { group: "advanced", label: "运行监视模式" },
  TAKI_DATA_DIR: { group: "storage-cache", label: "数据目录" },
  TAKI_ATTACHMENT_TTL_DAYS: { group: "storage-cache", label: "附件保留天数" },
  TAKI_PROVIDER_BASE_URL: { group: "model-context", label: "主模型 Base URL" },
  TAKI_PROVIDER_API_KEY: { group: "model-context", label: "主模型 API Key" },
  TAKI_PROVIDER_MODEL: { group: "model-context", label: "主模型 ID" },
  TAKI_UTILITY_BASE_URL: { group: "model-context", label: "后台模型 Base URL" },
  TAKI_UTILITY_API_KEY: { group: "model-context", label: "后台模型 API Key" },
  TAKI_UTILITY_MODEL: { group: "model-context", label: "后台模型 ID" },
  TAKI_PROVIDER_CONTEXT_TOKENS: { group: "model-context", label: "主模型上下文窗口" },
  TAKI_UTILITY_CONTEXT_TOKENS: { group: "model-context", label: "后台模型上下文窗口" },
  TAKI_CONTEXT_HISTORY_RATIO: { group: "model-context", label: "历史回放比例" },
  TAKI_PROVIDER_INCLUDE_USAGE: { group: "model-context", label: "请求用量统计" },
  TAKI_COMPACT_TRIGGER_RATIO: { group: "model-context", label: "压缩触发阈值" },
  TAKI_COMPACT_KEEP_MESSAGES: { group: "model-context", label: "压缩保留条数" },
  TAKI_MAX_STEPS: { group: "model-context", label: "工具循环步数上限" },
  TAKI_SUBAGENT_CHECKIN_STEPS: { group: "model-context", label: "子代理进度检查间隔（模型步骤）" },
  TAKI_SUBAGENT_CHECKIN_PARENT_APPROVALS: { group: "model-context", label: "子代理主助手连续放行次数" },
  TAKI_PROMPT_DIR: { group: "model-context", label: "提示卡目录" },
  TAKI_AMBIENT_SCREENSHOT: { group: "perception-privacy", label: "环境截屏采样" },
  TAKI_AMBIENT_SCREENSHOT_RETENTION: { group: "perception-privacy", label: "环境截屏保留" },
  TAKI_INITIATIVE_VIEWING_EFFECTIVE_MS: { group: "perception-privacy", label: "共看邀请前的有效观看时长（毫秒）" },
  TAKI_INITIATIVE_VIEWING_REMAINING_SECONDS: { group: "perception-privacy", label: "共看邀请所需剩余时长（秒）" },
  TAKI_INITIATIVE_VIEWING_INVITATION_TTL_MS: { group: "perception-privacy", label: "共看邀请有效期（毫秒）" },
  TAKI_WS_HOST: { group: "advanced", label: "WS 绑定地址" },
  TAKI_WS_PORT: { group: "advanced", label: "WS 端口" },
  TAKI_LOG_LEVEL: { group: "advanced", label: "日志级别" },
  TAKI_RECONNECT_BASE_MS: { group: "advanced", label: "重连基础退避" },
  TAKI_RECONNECT_CAP_MS: { group: "advanced", label: "重连退避上限" },
  TAKI_RECONNECT_STABILITY_RESET_MS: { group: "advanced", label: "重连稳定重置窗口" },
  TAKI_WS_OPEN_AUTH_TIMEOUT_MS: { group: "advanced", label: "连接与认证超时" },
  TAKI_RPC_INTERACTIVE_TIMEOUT_MS: { group: "advanced", label: "交互请求超时" },
  TAKI_RPC_LONG_TIMEOUT_MS: { group: "advanced", label: "长任务请求超时" },
  TAKI_CHAT_ACK_TIMEOUT_MS: { group: "advanced", label: "聊天确认超时" },
  TAKI_PET_COSTUME_TOTAL_TIMEOUT_MS: { group: "advanced", label: "换装总预算" },
  TAKI_RENDERER_LOAD_TIMEOUT_MS: { group: "advanced", label: "渲染器加载超时" },
  TAKI_HOME_RESULT_TIMEOUT_MS: { group: "advanced", label: "换装结果等待超时" },
};

/** Key-prefix → group for knob families (exact rows win; the label falls back to the raw key). */
const PREFIX_GROUPS: Record<string, ConfigGroupId> = {
  "TAKI_MEMORY_": "advanced",
  "TAKI_HINDSIGHT_": "advanced",
};

export function configGroupOf(key: string): ConfigGroupMeta {
  const exact = EXACT_LABELS[key];
  if (exact) return groupMeta(exact.group);
  const prefix = Object.keys(PREFIX_GROUPS)
    .filter((candidate) => key.startsWith(candidate))
    .sort((a, b) => b.length - a.length)[0];
  if (prefix === undefined) return groupMeta("advanced");
  return groupMeta(PREFIX_GROUPS[prefix] ?? "advanced");
}

/** The Chinese primary label for a knob; null = unknown key (the row keeps the raw key as its primary text). */
export function configLabelOf(key: string): string | null {
  return EXACT_LABELS[key]?.label ?? null;
}

export function configHintOf(key: string): string | null {
  if (key === "TAKI_SUBAGENT_CHECKIN_STEPS" || key === "TAKI_SUBAGENT_CHECKIN_PARENT_APPROVALS") {
    return "保存后在新工作或下一个进度检查间隔采用；不会改变当前间隔，也不会降低已经要求由你决定的检查点权限。";
  }
  return null;
}

function groupMeta(id: ConfigGroupId): ConfigGroupMeta {
  return CONFIG_GROUPS.find((group) => group.id === id) ?? CONFIG_GROUPS[CONFIG_GROUPS.length - 1]!;
}

export interface ConfigGroupView {
  group: ConfigGroupMeta;
  entries: ConfigEntry[];
}

/** Fixed group order, Core's within-group entry order preserved, empty groups skipped. */
export function groupConfigEntries(entries: ConfigEntry[]): ConfigGroupView[] {
  return CONFIG_GROUPS
    .map((group) => ({ group, entries: entries.filter((entry) => configGroupOf(entry.key).id === group.id) }))
    .filter((view) => view.entries.length > 0);
}

/** Client-side search over key, mapped Chinese label and description; empty query = everything. */
export function filterConfigEntries(entries: ConfigEntry[], query: string): ConfigEntry[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return entries;
  return entries.filter((entry) => {
    const label = configLabelOf(entry.key) ?? "";
    return entry.key.toLowerCase().includes(needle)
      || label.toLowerCase().includes(needle)
      || entry.description.toLowerCase().includes(needle);
  });
}
