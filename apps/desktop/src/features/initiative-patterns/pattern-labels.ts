/**
 * INPUT: closed Shared Pattern definitions, lifecycle and refusal values.
 * OUTPUT: semantic Chinese labels and condition descriptions with explicit units.
 * POS: Desktop Pattern presentation; opaque bindings are deliberately not rendered.
 */
import type { InteractionPatternCondition, InteractionPatternContextSelector, InteractionPatternOrigin, InteractionPatternRefusalReason, InteractionPatternState } from "@taki/shared";

export const PATTERN_STATES: Record<InteractionPatternState, string> = {
  proposed: "待确认", active: "生效中", paused: "已暂停", retired: "已停用",
};
export const CONTEXT_LABELS: Record<InteractionPatternContextSelector, string> = {
  memory_global: "共同记忆", memory_character: "角色记忆", accepted_activity: "已允许的活动信息",
  accepted_screen: "已允许的屏幕信息", presence: "在场信息",
};
export const OUTCOME_LABELS = { silent: "保持安静", express: "表情或动作", speak: "主动说话" };
export const CONDITION_LABELS: Record<InteractionPatternCondition["kind"], string> = {
  local_time_window: "本地时间窗口", application_in_set: "使用指定应用", activity_dwell_at_least: "持续活动时长",
  known_idle_state: "已知空闲状态", presence_present: "用户在场", intention_due: "一次性跟进到期", completion_of: "指定工作完成",
};
export const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const ORIGIN_LABELS: Record<InteractionPatternOrigin["kind"], string> = {
  user: "由你在管理页面创建", agent: "根据当前对话提出", seed: "随应用提供、需要你确认的示例", rollback: "从已确认的历史内容复制，等待重新确认",
};
export function describeOrigin(origin: InteractionPatternOrigin): string { return ORIGIN_LABELS[origin.kind]; }
export const PATTERN_REFUSALS: Record<InteractionPatternRefusalReason, string> = {
  invalid_request: "提案参数无效，请检查条件、时间与有效期。", not_found: "这条互动规则已不存在，请刷新列表。",
  conflict: "内容已被其他操作更新。你的草稿与正在阅读的提案已保留，请查看最新内容后重新决定。",
  invalid_state: "当前状态不允许此操作，请查看最新状态。", source_unavailable: "所需信息来源尚不可用，请调整条件或先设置来源。",
  source_stale: "所选工作或信息已过期，请重新选择。", forbidden: "当前连接不能执行此操作。",
  expired: "提案有效期已结束，请修改有效期后重新提案。", limit_reached: "已达到互动规则数量限制。",
  command_conflict: "该次提交无法复用，请核对当前状态后重新操作。",
};

export function describeCondition(condition: InteractionPatternCondition): string {
  switch (condition.kind) {
    case "local_time_window": return `${condition.daysOfWeek.map((day) => WEEKDAYS[day - 1]).join("、")} ${condition.start}–${condition.end}（用户时区${condition.end < condition.start ? "，跨午夜" : ""}）`;
    case "application_in_set": return `正在使用：${condition.applications.join("、")}`;
    case "activity_dwell_at_least": return `活动持续至少 ${condition.minutes} 分钟`;
    case "known_idle_state": return condition.state === "active" ? "有可靠的非空闲活动信息" : "有可靠的空闲信息";
    case "presence_present": return "有可靠的用户在场信息";
    case "intention_due": return "一次性跟进处于有效时间窗口";
    case "completion_of": return `工作完成：${condition.label}`;
  }
}

export function readablePatternDate(value: string | null, fallback: string): string {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : fallback;
}
