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
  connectionReady: boolean;
  onSet: (params: PerceptionPauseSetParams) => void;
  read?: { loading: boolean; refreshing: boolean; pending: boolean; stale: boolean };
}

export function PauseControls({ pause, connectionReady, onSet, read }: PauseControlsProps) {
  const paused = pause?.paused ?? false;
  const disabled = !connectionReady || read?.pending === true;
  return (
    <PageCard title="隐私暂停">
      <p className="mb-3 text-xs text-text-body">{pause ? `${read?.stale ? "上次确认：" : ""}${pauseLabel(pause)}` : read?.loading ? "读取隐私状态中…" : "隐私暂停状态尚未确认"}</p>
      {pause && read?.refreshing && <p className="mb-2 text-xs text-text-secondary">正在更新隐私状态…</p>}
      <div className="flex flex-wrap gap-2">
        <ActionButton
          tone="primary"
          onClick={() => onSet({ paused: true })}
          disabled={disabled || (paused && !read?.stale)}
        >
          暂停观察
        </ActionButton>
        <ActionButton
          onClick={() => onSet({ paused: true, until: midnightAfter(new Date()) })}
          disabled={disabled}
        >
          暂停到明天
        </ActionButton>
        <ActionButton onClick={() => onSet({ paused: false })} disabled={disabled || !paused || read?.stale === true}>
          恢复观察
        </ActionButton>
      </div>
    </PageCard>
  );
}
