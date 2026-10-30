/**
 * INPUT: finite shared settings, session, credential and retry snapshots.
 * OUTPUT: Chinese product labels and actual impact descriptions without identities.
 * POS: management view presentation only; validation and recovery remain shared.
 */
import { SETTINGS_FIELDS } from "@qqmm/management-client";
import type { ControlOperation, DirectArtifactStatus, QqControlActionReason, QqControlLoginState, QqSessionSnapshot, SecretSlot, SettingsDraft, SettingsIssue, SummaryRetryReason, SummaryRetryRequest } from "@qqmm/management-client";

export const SETTINGS_GROUPS = [
  { key: "account", title: "账号与接入" }, { key: "capture", title: "消息与保留期" },
  { key: "summary", title: "摘要" }, { key: "backend", title: "连接参数" }, { key: "advanced", title: "诊断日志" },
] as const;
export const RETENTION_HELP = "消息、摘要、工具结果和运行记录共用此期限，到期后删除。摘要和工具结果随最早来源到期。延长保留期不会恢复已删除内容。";
export function fieldHint(key: string): string | undefined {
  if (key === "storage.retentionDays") return "1–3650 天。";
  if (key === "summary.maxInputTokensPerCall") return "输入预算以 token 为单位；具体模型的实际消耗可能不同。";
  if (key === "summary.producer.apiKeyEnv") return "填写本机环境变量名，密钥本身不在此输入。";
  if (key === "connection.backend") return "仅提供已在本机准备好的接入方式。";
  if (key.endsWith("whitelist") || key === "summary.groupWhitelist") return "多个 QQ 号可用换行或逗号分隔。";
  return undefined;
}
export function issueLabel(issue: SettingsIssue): string {
  const field = SETTINGS_FIELDS.find((entry) => entry.key === issue.path);
  const label = field?.label ?? (issue.path.startsWith("summary.dimensions") ? "摘要关注事项" : "配置");
  return `${label}：${issue.code === "invalid_number" ? "请输入整数。" : "请检查填写内容和相关设置。"}`;
}
export function managementDate(time: number): string {
  return new Date(time).toLocaleString("zh-CN", { hour12: false });
}
export function settingsImpact(draft: SettingsDraft): string[] {
  const preview = draft.preview;
  if (!preview) return [];
  const { applyPlan: plan, retentionImpact: impact } = preview;
  const components: Record<string, string> = { "capture-filter": "消息范围", "message-policy": "撤回消息策略", summary: "摘要", maintenance: "保留期与清理", logging: "诊断日志", "managed-message-bridge": "消息连接", "monitor-runtime": "监控服务", "native-process-binding": "本机接入组件" };
  const lines = [plan.mode === "runtime_restart" ? "保存将重启监控运行环境，采集会短暂中断。" : plan.mode === "bridge_restart" ? "保存将重新连接消息桥，采集会短暂中断。" : "保存后直接生效。"];
  const affected = [...new Set(plan.affectedComponents.map((entry) => components[entry] ?? "相关设置"))];
  if (affected.length) lines.push(`影响：${affected.join("、")}。`);
  if (impact.previousDays !== impact.nextDays) lines.push(`保留期从 ${impact.previousDays} 天改为 ${impact.nextDays} 天；计时起点在 ${managementDate(impact.cutoffAt)} 及之前的内容已超期。`);
  if (impact.expiresEarlier) lines.push("缩短期限会删除超期内容，无法撤销。");
  return lines;
}
const LOGIN: Record<QqControlLoginState, string> = {
  unavailable: "连接状态暂不可用", not_started: "尚未启动", login_required: "需要登录 QQ", in_progress: "正在登录",
  active: "已连接", failed: "连接失败", stopped: "已停止", suspended: "QQ 发现已暂停", dormant: "等待 QQ 启动",
  stabilizing: "等待 QQ 启动稳定", probing: "正在检查 QQ 身份", target_not_found: "未找到目标 QQ", connecting: "正在连接",
  verifying: "正在验证账号",
};
export function sessionLabel(session: QqSessionSnapshot): string { return `${session.backend === "onebot" ? "OneBot" : session.backend === "direct" ? "Direct" : "PMHQ"} · ${LOGIN[session.loginState]}`; }
const ACTION_REASON: Record<QqControlActionReason, string> = {
  operation_running: "请等待当前操作结束", already_active: "已经启动", already_stopped: "已经停止", automatic_restore: "正在自动恢复",
  backend_unavailable: "接入服务尚未就绪", unsupported: "当前接入方式不支持此操作",
};
export function actionReason(reason: QqControlActionReason | null): string { return reason ? ACTION_REASON[reason] : ""; }
export function actionLabel(action: "start" | "stop" | "logout", backend: QqSessionSnapshot["backend"]): string {
  return action === "start" ? backend === "pmhq" ? "恢复发现 QQ" : "启动连接" : action === "stop" ? backend === "pmhq" ? "暂停发现 QQ" : "停止采集" : "退出 QQ 登录";
}
export function operationLabel(operation: ControlOperation): string {
  // This record can predate the current backend. Describe the recorded request
  // without reinterpreting its meaning through today's connection settings.
  const kind = { qq_start: "启动请求", qq_stop: "停止请求", qq_logout: "退出登录", config_apply: "应用配置" }[operation.kind];
  const state = { pending: "等待处理", running: "处理中", succeeded: "已完成", failed: "未完成", cancelled: "已取消" }[operation.state];
  return `${kind}：${state}`;
}
export function discoveryLines(session: QqSessionSnapshot): string[] {
  if (session.backend !== "pmhq") return [];
  const discovery = session.discovery;
  if (!discovery) return ["QQ 发现情况暂不可用。"];
  return [`发现 ${discovery.candidateCount} 个 QQ 进程，可检查 ${discovery.eligibleCandidateCount} 个，已排除其他账号 ${discovery.quarantinedMismatchCount} 个。`,
    discovery.activeTargetVerified ? "目标 QQ 身份已确认。" : "目标 QQ 尚未确认。", ...(discovery.failed ? ["QQ 发现检查失败，等待恢复。"] : [])];
}
export function artifactLines(artifact: DirectArtifactStatus | null): string[] {
  if (!artifact) return ["接入组件状态暂不可用。"];
  const admission = { missing: "未找到接入组件，请先完成本机安装。", unverified: "接入组件尚未通过检查。", verified: "接入组件检查通过。", mismatch: "接入组件与本机配置不匹配，请检查安装。", unsupported: "当前系统不支持此接入组件。" }[artifact.admission];
  return [admission, ...(artifact.processBinding === "restart_required" ? ["接入组件需要重启本机监控服务后才能使用。"] : [])];
}
export function secretLabel(slot: SecretSlot): string {
  return slot.name === "direct.authToken" ? "Direct 授权凭据" : slot.name === "pmhq.managerToken" ? "PMHQ 管理凭据" : "接入凭据";
}
export function secretStatus(slot: SecretSlot): string {
  const active = slot.configured ? "已有保存的凭据" : "尚未设置凭据";
  return `${active}${slot.candidateStatus === "validating" ? " · 正在验证新凭据" : slot.candidateStatus === "validation_unavailable" ? " · 新凭据等待验证恢复" : ""}`;
}
export const CONTROL_CONFIRMATION = {
  logout: "将停止采集并清除当前监控账号保存的登录状态。再次连接可能需要重新扫码，保留期内的历史记录仍可查询。",
  restart: "将重启本机监控服务，两个管理页面都会短暂断开。采集和摘要处理会中断，随后重新连接。",
};
const RETRY_REASON: Record<SummaryRetryReason, string> = {
  not_failed: "当前摘要无需重试。", already_requested: "已有重试请求，正在查看处理进度。", input_unavailable: "原始执行内容不可用，无法重试。",
  invalid_snapshot: "原始执行内容不完整，无法重试。", expired_source: "来源内容已过保留期，无法重试。", incompatible_capacity: "当前输入预算不足以容纳原始内容，请调整摘要配置。",
  runtime_unavailable: "等待采集服务恢复。", summary_disabled: "等待启用摘要。", conversation_busy: "等待该会话的当前摘要完成。", automatic_retry: "等待下一次自动重试。",
  interrupted: "处理曾中断，等待恢复。", attempts_exhausted: "本次请求的尝试次数已用完。", producer_timeout: "摘要服务响应超时。",
  producer_unavailable: "摘要服务暂不可用。", producer_authentication: "摘要服务授权失败，请检查密钥。", producer_rate_limited: "摘要服务暂时限流。",
  invalid_output: "摘要服务返回内容不符合要求。", generation_changed: "摘要状态已更新，请重新检查。", processing_failed: "摘要处理失败。",
};
export function retryReason(reason: SummaryRetryReason | null): string { return reason ? RETRY_REASON[reason] : ""; }
export function retryLines(request: SummaryRetryRequest): string[] {
  const state = { waiting: "等待重试", running: "正在重试", backoff: "等待自动重试", interrupted: "重试已中断", succeeded: "重试已完成", failed: "重试失败" }[request.status];
  return [`${state} · 已尝试 ${request.attemptsUsed} / ${request.attemptsLimit} 次`,
    `${request.target.conversationType === "group" ? "群聊" : "私聊"} ${request.target.conversationId} · 原始消息 ${request.target.sourceCount} 条`,
    `原始范围：${managementDate(request.target.sourceFrom)} 至 ${managementDate(request.target.sourceTo)}`,
    ...(request.reason ? [retryReason(request.reason)] : []),
    ...(request.nextAttemptAt !== null ? [`下次尝试：${managementDate(request.nextAttemptAt)}`] : [])];
}
