/**
 * INPUT:  a tool part (tool-call or tool-result) already persisted on a timeline row (#16 records).
 * OUTPUT: <ToolCard> — a compact one-line card: tool name + a status label; subtle, non-conversational.
 * POS:    ui/windows/home/pages/chat — the tool-part renderer used by timeline-message. Presentational; no WS/model output dump.
 */

import type { TimelineToolOutput } from "@taki/shared";

type ToolState = "call" | "done" | "denied" | "error";

const LABEL: Record<ToolState, string> = { call: "调用中", done: "完成", denied: "已拒绝", error: "失败" };
const TONE: Record<ToolState, string> = {
  call: "text-slate-500",
  done: "text-emerald-600",
  denied: "text-amber-600",
  error: "text-rose-600",
};

// A tool-result's output.type (AI SDK v7 tagged union) → a coarse UI state; unknown variants read as a plain result.
export function outputState(output: TimelineToolOutput): ToolState {
  if (output.type === "execution-denied") return "denied";
  return output.type.startsWith("error") ? "error" : "done";
}

export function ToolCard({ name, state }: { name: string; state: ToolState }) {
  return (
    <div className="my-1 flex items-center gap-2 rounded-md bg-slate-100 px-2.5 py-1 text-xs">
      <span aria-hidden>🔧</span>
      <span className="font-mono text-slate-600">{name}</span>
      <span className={TONE[state]}>{LABEL[state]}</span>
    </div>
  );
}
