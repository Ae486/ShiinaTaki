/**
 * INPUT:  stable English observability wire values
 * OUTPUT: centralized Simplified Chinese presentation labels for Monitor consumers
 * POS:    shared/presentation — protocol identifiers stay English; visible semantic labels resolve here
 */
import type { RunMonitorSummary, TrajectoryInspector } from "./observability-schema.ts";
const OBSERVABILITY_LABELS = {
  primary: "用户发起",
  scheduled: "定时任务",
  heartbeat: "心跳",
  flush: "后台维护",
  subagent: "子代理",
  webhook: "外部触发",
  class_a: "A 类交付",
  class_b: "B 类交付",
  internal: "内部运行",
  chat: "对话",
  "scheduled-task": "定时任务",
  running: "运行中",
  received: "已接收",
  processing: "处理中",
  queued: "排队中",
  prepared: "已准备",
  intent_committed: "意图已提交",
  effect_running: "执行中",
  settling: "结算中",
  waiting: "等待中",
  recovering: "恢复中",
  retrying: "正在重试",
  streaming: "输出中",
  captured: "已捕获",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  cancel_requested: "请求取消",
  skipped: "已跳过",
  deadline_exceeded: "超过截止时间",
  outcome_unknown: "结果未知",
  reconciliation_required: "需要人工核对",
  terminal: "已结算",
  settled: "已记录",
  allowed: "已允许",
  denied: "已拒绝",
  approval_required: "需要审批",
  pending: "待处理",
  approved: "已批准",
  expired: "已过期",
  operator_unavailable: "操作员不可用",
  notification_failed: "通知失败",
  operator_disconnected: "操作员已断开",
  invalidated: "已失效",
  lifecycle: "生命周期",
  effect: "执行效果",
  usage: "用量",
  model: "模型请求",
  tool: "工具",
  context: "上下文",
  governance: "治理与审批",
  recovery: "重试与恢复",
  trigger: "触发",
  run: "运行",
  attempt: "尝试",
  delivery: "交付",
  system: "系统",
  current: "当前",
  shadowed: "已被替代",
  "log-only": "仅记录",
  reported: "上游报告",
  estimated: "估算",
  unknown: "未知",
  character: "角色",
  memory: "记忆",
  extensions: "扩展",
  allow: "允许",
  deny: "拒绝",
  ask: "询问审批",
  accepted: "校验通过",
  validation_failed: "校验失败",
  validation: "参数校验",
  execution: "执行错误",
  stale: "状态已过期",
  stop: "正常停止",
  length: "达到长度限制",
  "content-filter": "内容过滤",
  "tool-calls": "等待工具",
  error: "模型错误",
  other: "其他",
  text: "文本输出",
  reasoning: "推理输出",
  "openai-compatible": "OpenAI 兼容接口",
  "taki-provider.chat": "OpenAI 兼容接口",
  "run.admitted": "运行已接纳",
  "attempt.prepared": "尝试已准备",
  "run.started": "运行开始",
  "attempt.started": "尝试开始",
  "attempt.settled": "尝试结束",
  "run.cancel_requested": "已请求取消",
  "run.deadline_exceeded": "运行超时",
  "run.budget_exceeded": "预算已用尽",
  "run.settled": "运行结束",
  "recovery.classified": "恢复分类",
  "effect.intent_committed": "执行意图已提交",
  "effect.waiting": "执行等待审批",
  "effect.settled": "执行已结算",
  "usage.settled": "模型用量",
  "model.request.started": "模型请求开始",
  "model.stream.first": "首次有效输出",
  "model.response.settled": "模型响应结束",
  "tool.call.started": "工具调用",
  "tool.result.settled": "工具结果",
  "context.snapshot": "上下文快照",
  "governance.evaluated": "治理评估",
  "approval.requested": "审批请求",
  "approval.decided": "审批结果",
  "run.retry": "运行重试",
  resumable_preparation: "可恢复准备",
  waiting_for_authority: "等待权限恢复",
  safe_replay: "可安全重放",
} as const satisfies Readonly<Record<string, string>>;

export function observabilityLabel(value: string): string {
  return OBSERVABILITY_LABELS[value as keyof typeof OBSERVABILITY_LABELS] ?? value;
}

export function observabilityLabels(values: readonly string[]): string[] {
  return values.map(observabilityLabel);
}

export function observabilityUsageDetails(
  usage: Omit<RunMonitorSummary["usage"], "quality"> & { quality?: string },
): TrajectoryInspector["detail"] {
  const fields: TrajectoryInspector["detail"] = usage.quality ? [{ label: "用量质量", value: observabilityLabel(usage.quality) }] : [];
  const counts = [
    ["输入令牌", usage.inputTokens], ["非缓存输入", usage.inputTokenDetails?.noCacheTokens],
    ["缓存读取", usage.inputTokenDetails?.cacheReadTokens], ["缓存写入", usage.inputTokenDetails?.cacheWriteTokens],
    ["输出令牌", usage.outputTokens], ["文本输出", usage.outputTokenDetails?.textTokens],
    ["推理令牌", usage.outputTokenDetails?.reasoningTokens], ["总令牌", usage.totalTokens],
  ] as const;
  for (const [label, value] of counts) if (value !== undefined) fields.push({ label, value: String(value) });
  if (usage.inputTokenDetails?.cacheReadTokens === undefined && usage.inputTokenDetails?.cacheWriteTokens === undefined) {
    fields.push({ label: "缓存信息", value: "缓存信息未提供" });
  }
  return fields;
}
