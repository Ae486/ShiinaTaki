/**
 * INPUT:  the explicit older-Core subscription outcome and an existing manual-refresh action.
 * OUTPUT: a bounded compatibility notice with deliberate refresh; current Core adds no extra status chrome.
 * POS:    Home read projections — presentation only, with no transport retry, timer or authority inference.
 */
import type { ReadObservationState } from "@/lib/read-observation.js";
import { ActionButton } from "./action-button.tsx";

export function ReadObservationNotice({ observation, onRefresh, disabled }: {
  observation: ReadObservationState;
  onRefresh(): Promise<void>;
  disabled: boolean;
}) {
  if (observation !== "unsupported") return null;
  return <div role="status" className="flex flex-wrap items-center gap-2 text-xs text-warn-strong">
    <span>此 Core 不支持自动更新；进入页面或手动刷新时读取。</span>
    <ActionButton disabled={disabled} onClick={() => void onRefresh()}>刷新</ActionButton>
  </div>;
}
