/**
 * INPUT: displayed current Pattern and explicit lifecycle callback.
 * OUTPUT: pause/resume and deliberate permanent retirement controls.
 * POS: Desktop domain actions; no permission approval or rollback of prior effects.
 */
import { useState } from "react";
import type { InteractionPatternView } from "@taki/shared";
import { ActionButton } from "@/windows/home/action-button.js";
import { FeedbackLine } from "@/components/ui/feedback-line.js";

export function PatternLifecycle(props: {
  pattern: InteractionPatternView;
  disabled: boolean;
  edit(): void;
  changeState(action: "pause" | "resume" | "retire"): Promise<boolean>;
}) {
  const [retiring, setRetiring] = useState(false);
  const { state } = props.pattern;
  if (state === "retired") return <p className="text-xs text-text-secondary">已停用，不再参与互动。历史内容仍可查看。</p>;
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2">
      <ActionButton disabled={props.disabled} onClick={props.edit}>修改并提案</ActionButton>
      {state === "active" && <ActionButton disabled={props.disabled} onClick={() => void props.changeState("pause")}>暂停</ActionButton>}
      {state === "paused" && <ActionButton disabled={props.disabled} onClick={() => void props.changeState("resume")}>恢复</ActionButton>}
      <ActionButton tone="danger-soft" disabled={props.disabled} onClick={() => setRetiring(true)}>停用</ActionButton>
    </div>
    {retiring && <div className="space-y-2">
      <FeedbackLine tone="warn">停用后不能恢复这条规则；修改历史会保留。仅需暂时停止时请使用暂停。</FeedbackLine>
      <div className="flex gap-2"><ActionButton onClick={() => setRetiring(false)}>取消</ActionButton>
        <ActionButton tone="danger" disabled={props.disabled} onClick={() => void props.changeState("retire")}>确认停用</ActionButton>
      </div>
    </div>}
  </div>;
}
