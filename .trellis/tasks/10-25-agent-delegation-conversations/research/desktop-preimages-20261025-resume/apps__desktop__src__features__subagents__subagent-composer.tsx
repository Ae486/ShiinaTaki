/**
 * INPUT: one displayed work target, local draft and fresh control availability
 * OUTPUT: deliberate send/stop/continue actions with draft preservation through failed or late results
 * POS: ui/subagents — local editor only; Core owns execution and the user-stop latch
 */
import { useRef, useState } from "react";
import type { SubagentSummary, SubagentTarget } from "@taki/shared";
import { ActionButton } from "@/windows/home/action-button.js";
import { ConversationComposer } from "@/windows/home/pages/chat/conversation-composer.js";
import type { SubagentController } from "./subagent-controller.ts";
import type { SubagentState } from "./subagent-state.ts";

interface ComposerProps {
  target: SubagentTarget;
  child: SubagentSummary;
  controller: SubagentController;
  available: boolean;
  pending: SubagentState["pending"];
}
export function SubagentComposer({ target, child, controller, available, pending }: ComposerProps) {
  const [draft, setDraft] = useState("");
  const revision = useRef(0);
  const submit = async (action: "send" | "continue") => {
    const submitted = revision.current;
    if (await controller.act(target, action, draft) && submitted === revision.current) { revision.current += 1; setDraft(""); }
  };
  const ownsActiveWork = !child.activeWorkInputId || child.activeWorkInputId === target.workInputId;
  return <section aria-label="所选子代理工作控制">
    <ConversationComposer editor={{ value: draft, onChange: (value) => { revision.current += 1; setDraft(value); },
      label: "向这项工作补充说明", placeholder: "补充要求、修正材料或提出后续问题…", maxLength: 1_000_000 }}
      submit={{ enabled: available && !!draft.trim(), run: () => void submit("send") }}
      actions={<>
      <ActionButton tone="accent" shape="pill" size="lg" disabled={!available || !draft.trim()} busy={pending === "send"} onClick={() => void submit("send")}>发送输入</ActionButton>
      <ActionButton shape="pill" size="lg" disabled={!available || !child.stopOrigin || !!child.activeRunId} busy={pending === "continue"} onClick={() => void submit("continue")}>继续此工作</ActionButton>
      <ActionButton tone="danger-soft" disabled={!available || child.stopOrigin === "user" || !ownsActiveWork} busy={pending === "stop"}
        onClick={() => void controller.act(target, "stop")}>停止此子代理</ActionButton>
      </>}
      footer={child.stopOrigin === "user"
      ? "你已停止此子代理。发送输入只会保留内容；需要点击继续才能恢复。"
      : "输入只发给所选工作。停止主对话不会停止子代理。"} />
  </section>;
}
