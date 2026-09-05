/**
 * INPUT:  fixed model-tool keys, trusted MCP names, or optional captured display-name sidecars
 * OUTPUT: readable tool names, bounded optional labels, and immutable own-key name snapshots
 * POS:    shared/presentation — names only; unknown routing keys are never decoded or used as display fallbacks
 */
const TOOL_NAMES: ReadonlyMap<string, string> = new Map([
  ["get_current_time", "读取当前时间"],
  ["memory_search", "搜索记忆"],
  ["memory_write", "写入记忆"],
  ["memory_archive", "归档记忆"],
  ["recall", "回忆相关内容"],
  ["reflect", "基于记忆反思"],
  ["retain", "保存新记忆"],
  ["update_memory", "更新记忆"],
  ["restore_memory", "恢复记忆"],
  ["invalidate_memory", "使记忆失效"],
  ["avatar_set_expression", "切换表情"],
  ["avatar_play_motion", "播放动作"],
  ["read_file", "读取工作区文件"],
  ["write_file", "写入工作区文件"],
  ["schedule_task", "管理定时任务"],
  ["screenshot", "屏幕截图"],
  ["process_list", "查看进程"],
  ["clipboard_read", "读取剪贴板"],
  ["clipboard_write", "写入剪贴板"],
  ["shell_open", "打开链接或文件"],
  ["exec", "执行命令"],
  ["load_skill", "读取技能说明"],
  ["read_skill_resource", "读取技能资源"],
  ["extension_discover", "查找扩展"],
  ["extension_describe", "查看扩展详情"],
  ["extension_call", "调用扩展"],
]);

export function getKnownToolDisplayName(toolKey: string): string | undefined {
  return TOOL_NAMES.get(toolKey);
}

export function formatMcpToolDisplayName(input: { serverName: string; toolName: string }): string {
  return `${input.serverName} · ${input.toolName}`;
}

/** Preserve names verbatim within 240 UTF-16 units; invalid optional labels must not block persistence. */
export function getValidToolDisplayName(value: unknown): string | undefined {
  return typeof value === "string" && value.length <= 240 && value.trim().length > 0 ? value : undefined;
}

/** Copy even non-enumerable own keys, while excluding inherited names and retaining literal routing keys. */
export function captureToolDisplayNames(
  names?: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> | undefined {
  if (names === undefined) return undefined;
  const entries: [string, string][] = [];
  for (const key of Object.getOwnPropertyNames(names)) {
    const displayName = getValidToolDisplayName(names[key]);
    if (displayName !== undefined) entries.push([key, displayName]);
  }
  // fromEntries defines __proto__ as an own data property instead of invoking Object.prototype's setter.
  return Object.freeze(Object.fromEntries(entries));
}
