/**
 * INPUT: Core child/run/completion/publication facts and command failures
 * OUTPUT: readable status and recovery wording without inferring model receipt or speech
 * POS: ui/subagents — presentation vocabulary only
 */
import { JSONRPCErrorException } from "json-rpc-2.0";
import type { SubagentSummary, SubagentResultView } from "@taki/shared";

export const CHILD_STATE: Record<SubagentSummary["state"], string> = {
  idle: "本轮工作已结束", queued: "等待执行", running: "正在处理", blocked_user: "已由你停止，等待你继续",
  blocked_parent: "主助手已暂停", deferred: "暂缓执行", needs_input: "等待补充输入",
};
export const RUN_STATE: Record<string, string> = {
  queued: "等待执行", running: "正在处理", waiting: "等待工具或审批", recovering: "正在恢复",
  cancel_requested: "正在停止", completed: "已完成", failed: "失败", cancelled: "已取消",
  skipped: "已跳过", deadline_exceeded: "已超时", outcome_unknown: "结果未知",
};
export const COMPLETION_STATE = {
  not_requested: "仅记录结果，未请求主助手处理", pending: "等待主助手处理", deferred: "主助手处理暂缓",
  admitted: "已接入主助手处理", withheld: "已保留结果，暂不交给主助手",
};
export const COMPLETION_REASON = { foreground_busy: "主对话忙碌", source_unavailable: "来源暂不可用",
  authority_unavailable: "执行条件暂不可用", superseded: "后续修正已替代此结果", source_retired: "来源已结束", expired: "工作已过期" };
export const PARENT_DECISION = { internal_result: "内部结论", no_action: "无需后续动作", reply: "建议回复",
  unstructured: "未确认结构的输出", none: "没有结论" };
const DELIVERY = { staged: "等待投递", held: "投递暂缓", dispatch_committed: "已开始投递，尚未确认送达",
  sent: "已送达", unknown: "送达结果未知", no_target: "没有可用接收端", expired: "投递已过期", suppressed: "未投递" };
const PUBLICATION = { internal_only: "仅供内部处理", no_action: "无需发布", pending: "等待发布决定", deferred: "发布暂缓",
  refused: "未获发布许可", recorded: "发布记录已保存" };

export function deliveryLabel(view: SubagentResultView): string {
  if (view.deliveryState) return DELIVERY[view.deliveryState];
  const publication = view.result.publication;
  return publication ? `${PUBLICATION[publication.state]} · 尚无送达确认` : "尚无发布或送达记录";
}
export function commandFailure(cause: unknown): string {
  if (cause instanceof JSONRPCErrorException && typeof cause.data === "object" && cause.data !== null) {
    const data: Record<string, unknown> = cause.data;
    const detail = typeof data.details === "object" && data.details !== null ? data.details : data;
    const reason = "reason" in detail ? detail.reason : null;
    if (typeof reason === "string" && /CONFLICT|MISMATCH/.test(reason)) return "目标工作或控制状态已变化。请刷新核对后再操作；草稿已保留。";
    if (reason === "SUBAGENT_CONTINUE_REQUIRES_RECONCILIATION") return "此工作需要先由运行时核对执行结果，目前无法继续。已保留上下文。";
  }
  return "未能确认操作结果。请刷新核对后再操作；草稿已保留，不会自动重新提交。";
}

export function commandOutcomeUnknown(cause: unknown): boolean {
  if (!(cause instanceof JSONRPCErrorException) || !cause.data || typeof cause.data !== "object") return true;
  const data: Record<string, unknown> = cause.data;
  const detail = typeof data.details === "object" && data.details !== null ? data.details : data;
  const reason = "reason" in detail ? detail.reason : null;
  return typeof reason !== "string" || !/CONFLICT|MISMATCH|RECONCILIATION|FORBIDDEN|NOT_FOUND|INVALID|STOPPED/.test(reason);
}

export function privateViewUnavailable(cause: unknown): boolean {
  if (!(cause instanceof JSONRPCErrorException) || typeof cause.data !== "object" || cause.data === null) return false;
  const data: Record<string, unknown> = cause.data;
  return data.code === "FORBIDDEN" || data.reason === "SUBAGENT_NOT_FOUND" || data.reason === "SUBAGENT_CHARACTER_MISMATCH";
}
