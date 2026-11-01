/**
 * INPUT: exact displayed target, retained controller draft and authoritative child state
 * OUTPUT: familiar Chat send/stop/continue controls with explicit stale-draft reconciliation
 * POS: ui/subagents — user intent only; Continue is one authoritative RPC, never send then resume
 */
import type { SubagentSummary, SubagentTarget } from "@taki/shared";
import { ActionButton } from "@/windows/home/action-button.js";
import { ConversationComposer } from "@/windows/home/pages/chat/conversation-composer.js";
import type { SubagentController } from "./subagent-controller.ts";
import type { SubagentState } from "./subagent-state.ts";

interface ComposerProps {
  target: SubagentTarget; child: SubagentSummary; controller: SubagentController;
  available: boolean; pending: SubagentState["pending"];
}

export function SubagentComposer({ target, child, controller, available, pending }: ComposerProps) {
  const draft = controller.draft(target);
  const currentDraft = controller.draftReady(target);
  const stopped = child.stopOrigin !== null;
  const request = child.pendingRequest;
  const checkIn = request?.state === "open" && request.workInputId === target.workInputId && request.reason === "check_in" ? request.checkIn : null;
  const continues = stopped || checkIn !== null;
  const action = continues ? "continue" : "send";
  const ownsWork = !child.activeWorkInputId || child.activeWorkInputId === target.workInputId;
  const enabled = available && currentDraft && (stopped ? !child.activeRunId : checkIn !== null || !!draft.text.trim());
  const label = continues ? draft.text.trim() ? checkIn ? "调整并继续" : "发送并继续" : "继续此工作" : "发送输入";
  const submit = () => void controller.submitDraft(target, action);
  return <section aria-label="所选子代理工作控制" className="shrink-0">
    {!currentDraft && <div role="status" className="px-4 py-2 text-xs text-text-secondary">
      {draft.uncertain ? "上次提交结果尚未确认。请核对会话中是否已接收；不会自动重发。" : "工作状态已变化，草稿仍绑定原目标。请核对后使用当前目标。"}
      <ActionButton tone="ghost" disabled={!available} onClick={() => controller.confirmDraft(target)}>
        {draft.uncertain ? "已核对，允许重新提交" : "使用当前目标"}
      </ActionButton>
    </div>}
    <ConversationComposer editor={{ value: draft.text, onChange: (value) => controller.editDraft(target, value),
      label: "向这项工作补充说明", placeholder: "补充要求、修正材料或提出后续问题…", maxLength: 1_000_000 }}
      submit={{ enabled, run: submit }} actions={<>
        <ActionButton tone="accent" shape="pill" size="lg" disabled={!enabled} busy={pending === action} onClick={submit}>{label}</ActionButton>
        <ActionButton tone="danger-soft" disabled={!available || child.stopOrigin === "user" || !ownsWork}
          busy={pending === "stop"} onClick={() => void controller.act(target, "stop")}>停止此子代理</ActionButton>
      </>} footer={stopped
        ? child.activeRunId ? "正在停止，执行结束后可明确继续。草稿已保留。" : "需要点击继续才能恢复；有草稿时，发送并继续会一次提交。"
        : checkIn ? checkIn.requiredActor === "user" ? "只有你能放行此检查点。点击继续，或补充调整后一次提交并继续。"
          : "点击继续恢复同一工作；补充调整后可一次提交并继续。主对话中的普通聊天不会重置无人值守次数。"
          : child.state === "needs_input" ? "补充内容将回复当前待回答的问题。" : "运行中也可发送补充输入；接收不代表当前模型步骤已读到。"} />
  </section>;
}
