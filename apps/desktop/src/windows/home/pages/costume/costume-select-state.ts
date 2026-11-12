/**
 * INPUT:  the costume page's actions (a click, an undeliverable command, the operator's Cancel, the deadline) and the
 *         pet window's pet:costume-result reports.
 * OUTPUT: reduceCostumeSelect(state, action) -> { pending, selected, error } — the page's switch lifecycle, pure.
 * POS:    ui/windows/home/pages/costume — the node-testable core of the page's switch state. The rule that makes the
 *         page honest: the selection follows the pet's RESULT, never the click, and every ending clears `pending` so
 *         the next click is accepted without reopening the window (manual checks #74 / #75).
 */

import type { CostumeResultPayload } from "@/lib/costume-switch-event.js";

export interface CostumeSelectState {
  /** The costume the pet has not settled yet — its row alone shows the indicator and the Cancel button. */
  pending: string | null;
  /** The costume observed in the live Pet scene; null means empty or not currently observed. */
  selected: string | null;
  error: string | null;
}

export const IDLE: CostumeSelectState = { pending: null, selected: null, error: null };

export type CostumeSelectAction =
  | { kind: "request"; costumeId: string }
  | { kind: "undeliverable"; costumeId: string; reason: string }
  | { kind: "result"; result: CostumeResultPayload }
  | { kind: "observed"; costumeId: string | null }
  | { kind: "cancel" }
  | { kind: "timeout"; costumeId: string };

const REFUSALS: Record<string, string> = {
  busy: "宠物窗口正在切换另一套服装，可先取消",
  "no-scene": "宠物窗口尚未就绪，请稍后重试",
  "unknown-costume": "宠物窗口不认识这套服装，请刷新列表",
  "not-renderable": "这套服装缺少必要资源，无法渲染",
};

/** A failure line always names the costume; a refusal word becomes readable, anything else is the switch's own text. */
function failureText(costumeId: string, reason: string): string {
  return `${costumeId}：${REFUSALS[reason] ?? reason}`;
}

function applyResult(state: CostumeSelectState, result: CostumeResultPayload): CostumeSelectState {
  const { costumeId, phase } = result;
  const ours = state.pending === costumeId;
  // Success clears stale failure state and triggers a fresh Pet observation in the adapter. An old result may arrive
  // after a scene replacement, so its payload alone cannot claim the current scene still wears that costume.
  if (phase === "succeeded") {
    return { pending: ours ? null : state.pending, selected: null, error: null };
  }
  if (!ours || phase === "started") return state;
  if (phase === "failed") return { ...state, pending: null, error: failureText(costumeId, result.reason ?? "切换失败") };
  return { ...state, pending: null, error: null }; // cancelled
}

export function reduceCostumeSelect(state: CostumeSelectState, action: CostumeSelectAction): CostumeSelectState {
  switch (action.kind) {
    case "observed":
      return { ...state, selected: action.costumeId };
    case "request":
      // The highlight must NOT follow the click (#74) — only a result moves it. A click during a switch is a safe
      // no-op that explains itself rather than stealing the pending row (#75).
      if (state.pending !== null && state.pending !== action.costumeId) {
        return { ...state, error: failureText(state.pending, "busy") };
      }
      return { ...state, pending: action.costumeId, error: null };
    case "undeliverable":
      return { ...state, pending: null, error: `无法通知宠物窗口换装：${action.reason}` };
    case "cancel":
      // The operator's Cancel releases this page immediately; the pet's cancelled report lands later as a no-op.
      return { ...state, pending: null, error: null };
    case "timeout":
      return state.pending === action.costumeId
        ? { ...state, pending: null, error: `${action.costumeId}：宠物窗口没有响应，请重试` }
        : state;
    case "result":
      return applyResult(state, action.result);
  }
}
