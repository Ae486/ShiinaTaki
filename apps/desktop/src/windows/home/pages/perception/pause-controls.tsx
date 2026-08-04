/**
 * INPUT:  the current pause state + the page's setPause callback.
 * OUTPUT: <PauseControls> — the Privacy Pause card: current wording plus pause / pause-until-tomorrow / resume.
 * POS:    ui/windows/home/pages/perception — presentational; the deadline arithmetic is perception-view's midnightAfter
 *         (the protocol makes the timezone the client's business).
 */

import type { PerceptionPauseSetParams, PerceptionPauseState } from "@taki/shared";
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
      <p className="mb-2 text-xs text-slate-600">{pause ? pauseLabel(pause) : "读取中…"}</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onSet({ paused: true })}
          disabled={paused}
          className="rounded-md bg-slate-800 px-3 py-1.5 text-xs text-white disabled:opacity-40"
        >
          暂停观察
        </button>
        <button
          type="button"
          onClick={() => onSet({ paused: true, until: midnightAfter(new Date()) })}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
        >
          暂停到明天
        </button>
        <button
          type="button"
          onClick={() => onSet({ paused: false })}
          disabled={!paused}
          className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 disabled:opacity-40"
        >
          恢复观察
        </button>
      </div>
    </PageCard>
  );
}
