/**
 * INPUT:  the current pause state + the page's setPause callback.
 * OUTPUT: <PauseControls> — the Privacy Pause card: current wording plus pause / pause-until-tomorrow / resume.
 * POS:    ui/windows/home/pages/perception — presentational; the deadline arithmetic is perception-view's midnightAfter
 *         (the protocol makes the timezone the client's business).
 */

import type { PerceptionPauseSetParams, PerceptionPauseState } from "@taki/shared";
import { ActionButton } from "../../action-button.tsx";
import { PageCard } from "../../page-card.tsx";
import { midnightAfter, pauseLabel } from "./perception-view.ts";

export interface PauseControlsProps {
  pause: PerceptionPauseState | null;
  onSet: (params: PerceptionPauseSetParams) => void;
}

export function PauseControls({ pause, onSet }: PauseControlsProps) {
  const paused = pause?.paused ?? false;
  return (
    <PageCard title="隐私暂停">
      <p className="mb-3 text-xs text-slate-600">{pause ? pauseLabel(pause) : "读取中…"}</p>
      <div className="flex flex-wrap gap-2">
        <ActionButton tone="primary" onClick={() => onSet({ paused: true })} disabled={paused}>
          暂停观察
        </ActionButton>
        <ActionButton onClick={() => onSet({ paused: true, until: midnightAfter(new Date()) })}>暂停到明天</ActionButton>
        <ActionButton onClick={() => onSet({ paused: false })} disabled={!paused}>
          恢复观察
        </ActionButton>
      </div>
    </PageCard>
  );
}
