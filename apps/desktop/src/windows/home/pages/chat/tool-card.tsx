/**
 * INPUT:  a persisted tool part's canonical key, optional captured display name, and existing status.
 * OUTPUT: compact tool cards with captured/fixed/generic readable labels; routing keys remain internal.
 * POS:    ui/windows/home/pages/chat — the tool-part renderer used by timeline-message. Presentational; no WS/model output dump.
 */

import { getKnownToolDisplayName, getValidToolDisplayName, type TimelineToolOutput } from "@taki/shared";
import { ToolIcon } from "@/lib/icons/tool-icon.js";

type ToolState = "call" | "done" | "denied" | "error";

const LABEL: Record<ToolState, string> = { call: "调用中", done: "完成", denied: "已拒绝", error: "失败" };
const TONE: Record<ToolState, string> = {
  call: "text-text-secondary",
  done: "text-ok",
  denied: "text-warn",
  error: "text-danger",
};

// A tool-result's output.type (AI SDK v7 tagged union) → a coarse UI state; unknown variants read as a plain result.
export function outputState(output: TimelineToolOutput): ToolState {
  if (output.type === "execution-denied") return "denied";
  return output.type.startsWith("error") ? "error" : "done";
}

type ToolCardProps = { name: string; displayName?: string; state: ToolState };

export function ToolCard({ name, displayName, state }: ToolCardProps) {
  const label = getValidToolDisplayName(displayName) ?? getKnownToolDisplayName(name) ?? "工具调用";
  return (
    <div className="my-1 flex items-center gap-2 rounded-md bg-surface-sunken px-2.5 py-1 text-xs">
      <ToolIcon className="h-3.5 w-3.5 shrink-0 text-text-faint" />
      <span className="min-w-0 break-words font-mono text-text-body">{label}</span>
      <span className={`shrink-0 ${TONE[state]}`}>{LABEL[state]}</span>
    </div>
  );
}
