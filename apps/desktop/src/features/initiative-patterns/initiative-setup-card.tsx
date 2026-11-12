/**
 * INPUT: actual setup projection and explicit operator lifecycle/navigation actions.
 * OUTPUT: Skill setup, example proposal and global policy controls with retained failures.
 * POS: Desktop management setup; same-name/user-disabled packages are never automatically changed.
 */
import { PageCard } from "@/windows/home/page-card.js";
import { ActionButton } from "@/windows/home/action-button.js";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { InitiativePolicyView } from "./initiative-policy-view.tsx";
import type { useInitiativeSetup } from "./use-initiative-setup.ts";

const SKILL_LABELS = { missing: "尚未安装", ready: "已就绪", disabled: "已停用", conflict: "存在同名内容", unavailable: "暂不可用" };

export function InitiativeSetupCard({ setup }: { setup: ReturnType<typeof useInitiativeSetup> }) {
  const data = setup.state.data;
  const enabled = data?.settings.find((entry) => entry.key === "TAKI_INITIATIVE_ENABLED");
  return <PageCard title="主动互动设置" action={<ActionButton busy={setup.state.loading} onClick={() => void setup.controller.refresh()}>刷新设置</ActionButton>}>
    <div className="space-y-3">
      {setup.state.error && <FeedbackLine tone="danger">{setup.state.error}</FeedbackLine>}
      {setup.state.feedback && <FeedbackLine tone={setup.state.feedback.tone}>{setup.state.feedback.message}</FeedbackLine>}
      <InitiativePolicyView setup={data} />
      {data && <>
        <div className="flex flex-wrap gap-2">
          <ActionButton disabled={!setup.available || !enabled || enabled.envLocked || enabled.apply !== "live"} onClick={() => void setup.controller.setEnabled(enabled?.value !== true)}>{enabled?.value === true ? "关闭主动互动" : "开启主动互动"}</ActionButton>
          <ActionButton onClick={setup.openSettings}>调整全局设置</ActionButton>
        </div>
        {enabled?.envLocked && <p className="text-xs text-text-secondary">主动互动开关由环境配置固定。</p>}
        <p className="text-xs text-text-secondary">活动来源：{data.sources.activityAvailable ? "可用" : "不可用"} · 在场信息：{data.sources.presence === "present" ? "用户在场" : "未知"}</p>
        <div className="flex flex-wrap items-center gap-2"><span className="text-sm">对话创作技能：{SKILL_LABELS[data.skill.state]}</span>
          {data.skill.state === "missing" && <ActionButton disabled={!setup.available} onClick={() => void setup.controller.install()}>导入创作技能</ActionButton>}
          <ActionButton onClick={setup.openSkills}>管理 Skills</ActionButton>
        </div>
        {(data.skill.state === "disabled" || data.skill.state === "conflict") && <p className="text-xs text-text-secondary">已保留现有包和启用状态。请在 Skills 页面明确检查或更改。</p>}
        {data.seeds.map((seed) => <div key={seed.seedId} className="space-y-2 rounded-lg border border-border p-3">
          <h3 className="text-sm font-medium">{seed.title}</h3><p className="text-xs text-text-secondary">{seed.description}</p>
          <ActionButton disabled={!setup.available || seed.existingPatternId !== null} onClick={() => void setup.controller.proposeSeed(seed.seedId)}>{seed.existingPatternId ? "示例已在规则列表中" : "生成示例提案"}</ActionButton>
        </div>)}
      </>}
    </div>
  </PageCard>;
}
