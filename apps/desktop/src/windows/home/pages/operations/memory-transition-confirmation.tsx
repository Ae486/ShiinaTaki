/**
 * INPUT: a disposable explicit preview plus the transition hook's confirm/dismiss actions.
 * OUTPUT: one healthy confirmation or separately selected emergency confirmation with keyboard focus recovery.
 * POS: ui/operations — inline confirmation; rendering never submits and Escape only dismisses this preview.
 */
import { useEffect, useId, useRef } from "react";
import type { MemoryEmergencyTransitionPreview } from "@taki/shared";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { ActionButton } from "../../action-button.tsx";
import { MEMORY_OPERATION_KIND_LABEL } from "./memory-authority-state.ts";
import { MemoryTransitionDisclosure } from "./memory-transition-disclosure.tsx";
import type { MemoryTransitionsView } from "./use-memory-transitions.ts";
type Props = { view: MemoryTransitionsView; locked: boolean };
const BLOCKER: Record<MemoryEmergencyTransitionPreview["blocking"][number], string> = {
  "source-unavailable": "当前记忆来源不可用，请检查本地证据。",
  "scope-unmapped": "有 Bank 尚未建立映射，无法接管。",
  "incomplete-replica": "本地副本或记忆策略证据不完整，无法接管。",
  "inventory-unreadable": "无法读取完整的本地证据清单。",
};

export function MemoryTransitionConfirmation({ view, locked }: Props) {
  const root = useRef<HTMLDivElement>(null); const title = useId();
  const { preview } = view; const emergency = preview?.kind === "transition.emergency-local";
  useEffect(() => {
    const opener = document.activeElement;
    root.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => { if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  }, []);
  return <div ref={root} role="region" aria-labelledby={title} className="rounded-lg border border-border p-3"
    onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); view.dismiss(); } }}>
    <p id={title} className="mb-2 text-sm font-semibold text-text-strong">
      {preview ? `${preview.recovery ? "恢复原操作：" : "确认："}${MEMORY_OPERATION_KIND_LABEL[preview.kind]}` : "读取转换预览"}
    </p>
    {view.previewLoading && <p role="status" className="text-xs text-text-secondary">正在核对完整证据，大语料可能需要较长时间…</p>}
    {view.previewError && <FeedbackLine tone="danger">{view.previewError}</FeedbackLine>}
    {preview && <div className="mb-3 flex flex-col gap-2">
      {emergency ? <MemoryTransitionDisclosure disclosure={preview} />
        : <p className="text-xs text-text-body">{preview.expected.sourceProvider === "local" ? "Local → Hindsight" : "Hindsight → Local"}；覆盖 {preview.expected.banks.length} 个 Bank。一次确认后由 Core 执行全部完整性检查、切换与收尾。</p>}
      <p className="text-xs text-text-secondary">关闭窗口或断线不会取消已受理工作。提交后请依据 Core 状态判断结果。</p>
      {emergency && preview.takeover === "refused" && <FeedbackLine tone="warn">当前证据不足，不能接管。{preview.blocking.map((code) => BLOCKER[code]).join(" ")}</FeedbackLine>}
    </div>}
    <div className="flex gap-2">
      <ActionButton tone="ghost" onClick={view.dismiss}>取消预览</ActionButton>
      <ActionButton tone={emergency ? "danger" : "primary"} disabled={locked || !preview || !preview.expected || view.previewLoading}
        onClick={() => void view.confirm()}>{emergency ? "确认紧急接管" : "确认切换"}</ActionButton>
    </div>
  </div>;
}
