/**
 * INPUT:  canonical capability/cell keys and existing posture/override wire values
 * OUTPUT: Chinese operation labels and exact-key permission descriptions
 * POS:    shared/presentation — pure display vocabulary, separate from the authority registry and policy evaluation
 */
import type { PermissionCellState, PermissionPosture } from "./permission-level-schema.ts";

const CAPABILITY_LABELS: ReadonlyMap<string, string> = new Map([
  ["core.subagent.manage", "安排助手协作"],
  ["core.subagent.read", "查看助手工作"],
  ["core.subagent.result", "记录助手结果"],
  ["shell-open", "打开外部目标"],
  ["exec", "执行命令"],
  ["fs-write", "写入文件"],
  ["screenshot", "屏幕截图"],
  ["screenshot-ambient", "屏幕采样"],
  ["process-list", "查看进程"],
  ["clipboard-read", "读取剪贴板"],
  ["clipboard-write", "写入剪贴板"],
  ["foreground-window", "读取前台窗口"],
  ["skill.load", "读取技能资料"],
  ["mcp.tool.call", "调用 MCP 工具"],
  ["core.time.read", "读取当前时间"],
  ["core.initiative.decide", "决定主动表达"],
  ["core.initiative.pattern.manage", "管理互动习惯"],
  ["core.co-watching.manage", "查询分析或管理共看"],
  ["core.initiative.intention.plan", "安排后续跟进"],
  ["core.schedule.manage", "管理定时任务"],
  ["core.memory.search", "查询记忆"],
  ["core.memory.write", "写入记忆"],
  ["core.memory.archive", "停用记忆"],
  ["core.avatar.expression", "切换表情"],
  ["core.avatar.motion", "播放动作"],
  ["workspace.file.read", "读取工作区文件"],
]);

type PermissionCellDisplay = { label: string; description: string };

const CELL_DISPLAYS: ReadonlyMap<string, PermissionCellDisplay> = new Map([
  ["subagent-manage", { label: "安排助手协作", description: "委派工作、发送补充说明或暂停指定助手；使用的工具仍遵循原有权限。" }],
  ["subagent-read", { label: "查看助手工作", description: "读取当前角色的助手会话、进展与保留结果。" }],
  ["subagent-result", { label: "记录助手结果", description: "记录本次工作的结果或后续处理建议；记录本身不会发送消息。" }],
  ["shell-open:url-safe", {
    label: "打开网页或邮件链接",
    description: "按 http、https 或 mailto 协议分类的链接；此分类不验证网页或邮件内容是否安全。",
  }],
  ["shell-open:local-file", {
    label: "打开普通本地文件",
    description: "按文件扩展名归为普通文件的本地路径，由系统默认应用打开；此分类不检查文件内容。",
  }],
  ["shell-open:local-exec", {
    label: "打开程序或特殊路径",
    description: "包括程序、脚本、快捷方式、UNC 网络路径及无扩展名等无法确定用途的路径。",
  }],
  ["shell-open:blocked", {
    label: "不支持或无效的打开目标",
    description: "包括不支持的链接协议、无效参数或无法安全识别的目标；放宽权限不会使无效目标变得可打开。",
  }],
  ["exec:simple-allowlisted", {
    label: "符合允许规则的单条命令",
    description: "可解析为单条命令，并满足当前设备的程序定位、文件类型和本地执行允许规则。",
  }],
  ["exec:compound", {
    label: "复合或无法解析的命令",
    description: "包含管道、命令串联、重定向，或引号等语法无法解析的命令。当前执行器不支持此类命令，放宽权限也不会使其可执行。",
  }],
  ["exec:shell-reentry", {
    label: "启动命令解释器",
    description: "通过命令解释器或脚本宿主继续执行其他命令，其实际行为还受当前设备的执行限制约束。",
  }],
  ["exec:allowlist-miss", {
    label: "其他单条命令",
    description: "未满足简单命令允许规则，也包括程序定位失败、文件类型限制或本地执行模式限制等情况。",
  }],
  ["exec:blocked", {
    label: "命中拦截规则的命令",
    description: "命中当前设备的命令拦截规则；此分类与未命中允许列表的普通命令不同。",
  }],
  ["fs-write:in-workspace", {
    label: "写入工作区文件",
    description: "在助手工作区内创建或更新文件，实际路径仍须通过工作区边界校验。",
  }],
  ["fs-write:dir-root", {
    label: "写入额外指定目录",
    description: "预留分类：向额外指定的目录写入。当前写入工具仅支持工作区，调整此项不会启用额外目录写入。",
  }],
  ["fs-write:outside-root", {
    label: "写入指定范围之外",
    description: "预留分类：向工作区及额外目录以外的位置写入。当前写入工具仅支持工作区，不支持此范围。",
  }],
  ["fs-write:skill-hook", {
    label: "写入技能或钩子目录",
    description: "预留分类：修改可能影响执行的技能或钩子内容。当前写入工具仅支持工作区，尚未单独接入此分类。",
  }],
  ["fs-write:sensitive", {
    label: "写入敏感位置",
    description: "预留分类：修改密钥、环境配置等敏感位置。当前写入工具仅支持工作区，尚未单独接入此分类。",
  }],
  ["fs-write:self-escalation", {
    label: "修改助手权限配置",
    description: "预留分类：修改用于控制助手权限的配置。当前写入工具仅支持工作区，尚未单独接入此分类。",
  }],
  ["screenshot", {
    label: "获取屏幕截图",
    description: "按工具请求获取当前屏幕图像，图像可能包含正在显示的个人信息。",
  }],
  ["screenshot-ambient", {
    label: "采样屏幕图像",
    description: "在屏幕采样流程中获取图像；仍受采样开关、隐私暂停和设备可用状态约束。",
  }],
  ["process-list", {
    label: "查看运行中的进程",
    description: "读取设备上运行进程的名称、进程号及资源占用等信息。",
  }],
  ["clipboard-read", {
    label: "读取剪贴板文本",
    description: "读取当前剪贴板中的文本，内容可能包含个人信息或凭据。",
  }],
  ["clipboard-write", {
    label: "替换剪贴板文本",
    description: "用指定文本替换当前剪贴板内容。",
  }],
  ["foreground-window", {
    label: "读取当前前台窗口",
    description: "读取当前前台窗口的标题与所属应用等信息。",
  }],
  ["skill-load", {
    label: "读取技能说明与资源",
    description: "读取已启用技能的说明或资源；技能内容提供操作步骤，不授予其他工具的权限。",
  }],
  ["mcp-tool-call", {
    label: "调用 MCP 工具",
    description: "调用指定服务器提供的具体工具；审批始终绑定实际服务器与工具，名称本身不授予权限。",
  }],
  ["get-current-time", {
    label: "读取当前时间",
    description: "读取当前时间与时区信息。",
  }],
  ["initiative-decide", {
    label: "决定主动表达",
    description: "为本次主动判断提交保持安静、表情或完整话语；实际表达仍须通过当前交付条件与权限检查。",
  }],
  ["schedule-manage", {
    label: "管理定时任务",
    description: "查看、创建、修改、暂停、恢复或删除当前角色的定时任务。",
  }],
  ["interaction-pattern-manage", {
    label: "管理互动习惯",
    description: "按当前对话请求查看或调整互动习惯；新提案仍须由你确认，不改变工具权限。",
  }],
  ["co-watching-manage", {
    label: "查询分析或管理共看",
    description: "查询已有分析、分析指定网址或预分析少量精选推荐；共看仍需明确请求，原生分析工具遵循已有权限。",
  }],
  ["intention-plan", {
    label: "安排后续跟进",
    description: "基于当前对话形成一次有明确起止窗口的后续关心计划；不保证发言，不替代你要求的定时任务。",
  }],
  ["memory-search", {
    label: "查询或分析记忆",
    description: "查询记忆，并按请求整理或分析相关内容。",
  }],
  ["memory-write", {
    label: "保存、更新或恢复记忆",
    description: "保存新记忆、更新已有内容，或恢复已失效的记忆。",
  }],
  ["memory-archive", {
    label: "归档或停用记忆",
    description: "归档或使已有记忆失效，使其退出正常使用范围。",
  }],
  ["avatar-set-expression", {
    label: "切换角色表情",
    description: "切换当前角色装扮所支持的表情。",
  }],
  ["avatar-play-motion", {
    label: "播放角色动作",
    description: "播放当前角色装扮所支持的动作。",
  }],
  ["workspace-read", {
    label: "读取工作区文件",
    description: "读取助手工作区内的文件，不包含工作区之外的路径。",
  }],
]);

export const PERMISSION_POSTURE_LABELS = Object.freeze({
  auto: "自动允许", ask: "请求审批", deny: "禁止",
} as const satisfies Readonly<Record<PermissionPosture, string>>);

export const PERMISSION_OVERRIDE_LABELS = Object.freeze({
  ordinary: "可调整", "second-confirm": "放宽需再次确认", immutable: "固定规则",
} as const satisfies Readonly<Record<PermissionCellState["overrideMode"], string>>);

export function getCapabilityLabel(capabilityId: string): string {
  return CAPABILITY_LABELS.get(capabilityId) ?? "未识别的操作";
}

export function getPermissionCellDisplay(cellKey: string): PermissionCellDisplay {
  // Return a copy so a consumer cannot change the shared vocabulary for another surface.
  return { ...(CELL_DISPLAYS.get(cellKey) ?? { label: "未识别的权限项", description: "当前版本没有这项权限的说明。" }) };
}
