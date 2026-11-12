/**
 * INPUT: closed Shared pre-admission policy outcomes and source categories.
 * OUTPUT: semantic Chinese Monitor explanations without internal occurrence bindings.
 * POS: Desktop same-Monitor presentation; counts are producer facts, never inferred from displayed Runs.
 */
import type { InitiativeWakeEvaluation, InitiativeWakeReason } from "@taki/shared";

export const WAKE_REASON_LABELS: Record<InitiativeWakeReason, string> = {
  disabled: "主动互动已关闭", "wake-disabled": "定时与事件检查均已关闭", "no-target": "没有可用互动对象", "no-pattern": "没有生效规则", "no-signal": "没有有效互动机会",
  "missing-source": "所需来源不可用", "stale-source": "信息已过期", "privacy-paused": "感知已暂停", "quiet-hours": "处于安静时段",
  "absence-unknown": "在场信息不足", "conditions-unmet": "尚未满足条件", duplicate: "该次机会已处理", chance: "本次机会未抽中",
  "pattern-cooldown": "规则仍在间隔期", "model-cadence": "尚未到考虑互动的间隔", "model-budget": "考虑互动次数已达上限",
  "backoff-spacing": "互动退避间隔尚未结束", "backoff-daily": "退避期间的当日判断额度已用完",
  "utterance-budget": "主动说话次数已达上限", "utterance-gap": "距上次主动说话过近", busy: "当前对话正忙碌", expired: "已过有效期",
  "stale-policy": "规则或策略已经变化", "context-unavailable": "所需上下文不可用", admitted: "已进入共同运行流程",
  "dispatch-refused": "运行未被受理", "source-error": "读取来源失败",
};
export const WAKE_SOURCE_LABELS: Record<InitiativeWakeEvaluation["source"], string> = {
  none: "策略检查", clock: "时间窗口", activity: "活动变化", presence: "用户返回", completion: "工作完成", intention: "一次性跟进", media: "观看邀请",
};
