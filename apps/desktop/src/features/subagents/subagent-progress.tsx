/**
 * INPUT: Core cumulative child usage, captured work interval and exact pending check-in
 * OUTPUT: factual token totals, incomplete/unknown labels and check-in decision authority
 * POS: ui/subagents — pure presentation; counts and required actor remain Core-owned
 */
import type { SubagentSummary } from "@taki/shared";

export function subagentUsageLabel(child: SubagentSummary): string {
  const usage = child.tokenUsage;
  if (!usage) return "累计 token 用量未知";
  if (usage.modelEffects === 0) return "尚无模型调用";
  if (usage.complete && usage.totalTokens !== null) return `累计 ${usage.totalTokens.toLocaleString()} token`;
  return usage.knownTotalTokens === null ? "累计 token 用量未知（统计不完整）"
    : `已知累计 ${usage.knownTotalTokens.toLocaleString()} token（统计不完整）`;
}

export function SubagentProgress({ child, workId }: { child: SubagentSummary; workId: string }) {
  const progress = child.progress?.workInputId === workId ? child.progress : null;
  const request = child.pendingRequest;
  const checkIn = request?.state === "open" && request.workInputId === workId && request.reason === "check_in" ? request.checkIn : null;
  const usage = child.tokenUsage;
  return <div className="space-y-1 text-xs text-text-secondary">
    <p>{subagentUsageLabel(child)}{usage && usage.modelEffects > 0 && <>
      {` · 输入 ${usage.inputTokens === null ? "未知" : usage.inputTokens.toLocaleString()} / 输出 ${usage.outputTokens === null ? "未知" : usage.outputTokens.toLocaleString()}`}
      {usage.inflightEffects > 0 && ` · ${usage.inflightEffects} 次调用尚未结算`}
      {usage.missingUsageEffects > 0 && ` · ${usage.missingUsageEffects} 次调用缺少完整用量`}
    </>}</p>
    {progress && <>
      <p>{progress.tracking === "post_upgrade" ? "升级后已记录" : "已完成"} {progress.completedSteps} 个模型步骤 · 本轮检查间隔 {progress.completedSteps - progress.intervalStartSteps}/{progress.intervalSteps}
        {` · 主助手连续放行 ${progress.consecutiveParentApprovals}/${progress.parentApprovalLimit}`}</p>
      {progress.tracking === "post_upgrade" && <p>步骤从升级后的明确继续开始统计，更早的步骤数未知。</p>}
      <p>配置变更在新工作或下一个检查间隔生效；当前间隔与待决定权限保持原值。</p>
    </>}
    {checkIn && <p role="status" className="font-medium text-text-body">已暂停等待进度检查。
      {checkIn.requiredActor === "user" ? "此检查点必须由你明确继续或调整方向，主助手无法代为放行。"
        : child.stopOrigin === "user" ? "检查点允许主助手处理，但你的停止需要由你明确继续。" : "主助手或你可明确继续；补充方向后继续会恢复同一工作。"}
      {child.stopOrigin === "user" && "你的停止仍然生效，只有你的继续操作可以解除。"}</p>}
  </div>;
}
