/**
 * INPUT:  Home's disposable operator WsClient generation
 * OUTPUT: DSH-shaped three-zone monitor (L1): compact Run browser | grouped ledger | on-demand closable inspector
 *         with a drag-adjustable width; filters live in the browser pane; stacks under a narrow container
 * POS:    ui/windows/home/pages/monitor — operator-only developer surface; no technical identifiers in primary rows.
 *         Tiles ride SelectionTile (U1: the selected run and the inspected row close on a second click), filters ride
 *         Field, and loading/empty/error ride Skeleton/EmptyState/FeedbackLine with a retry action. Hidden pages stop
 *         working (P1e): the controller unsubscribes + stops publishing while hidden and refetches on reactivation.
 */
import { useEffect, useMemo, useState } from "react";
import type { MonitorMode, RunInitiator, RunMonitorSummary, RunState, TrajectoryRow } from "@taki/shared";
import { useHomeClient } from "../../home-client-context.ts";
import { LabeledRows, PageCard } from "../../page-card.tsx";
import { PageAlert, PageBody, PageHeader } from "../../page-chrome.tsx";
import { FeedbackLine } from "@/components/ui/feedback-line.js";
import { Field, FIELD_CONTROL } from "@/components/ui/field.js";
import { SelectionTile } from "@/components/ui/selection-tile.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { EmptyState } from "@/components/ui/empty-state.js";
import { ActionButton } from "../../action-button.tsx";
import {
  createMonitorController, INITIAL_MONITOR_STATE,
  type MonitorController, type MonitorFilters, type MonitorViewState,
} from "./monitor-controller.ts";
import { groupTrajectoryRows } from "./monitor-view.tsx";
import { InspectorPane, INSPECTOR_WIDTH_DEFAULT, MonitorThreeZones } from "./monitor-layout.tsx";
import { usePageVisible } from "../../page-visibility-store.ts";
import { INITIATOR_OPTIONS, STATE_OPTIONS, connectionKindLabel, wireLabel } from "./monitor-labels.ts";

function readableTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

function FiltersCard({ draft, setDraft, onApply, applying }: {
  draft: MonitorFilters;
  setDraft(next: MonitorFilters): void;
  onApply(): void;
  applying: boolean;
}) {
  return (
    <PageCard title="筛选" action={<ActionButton tone="primary" busy={applying} disabled={applying} onClick={onApply}>应用</ActionButton>}>
      <div className="flex flex-col gap-2">
        <Field label="搜索">
          <input value={draft.text} maxLength={100} placeholder="触发器 / 摘要" className={FIELD_CONTROL}
            onChange={(event) => setDraft({ ...draft, text: event.target.value })} />
        </Field>
        <Field label="发起方">
          <select value={draft.initiator} className={FIELD_CONTROL}
            onChange={(event) => setDraft({ ...draft, initiator: event.target.value as RunInitiator | "" })}>
            <option value="">全部</option>{INITIATOR_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="状态">
          <select value={draft.state} className={FIELD_CONTROL}
            onChange={(event) => setDraft({ ...draft, state: event.target.value as RunState | "" })}>
            <option value="">全部</option>{STATE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
      </div>
    </PageCard>
  );
}

// Compact browser tile (L1): readable label first, one outcome line, one time/counts line — the technical joins
// stay in the inspector. The character line is dropped (the controller pins the filter to the active character).
function RunTile({ run, selected, onSelect }: { run: RunMonitorSummary; selected: boolean; onSelect(): void }) {
  return (
    <SelectionTile selected={selected} onSelect={onSelect}>
      <p className="truncate text-sm font-medium text-text-strong">{run.title}</p>
      <p className="truncate text-xs text-text-secondary">
        {run.initiatorLabel} · {run.outcome ? `${wireLabel(run.state)} / ${wireLabel(run.outcome)}` : wireLabel(run.state)}
      </p>
      <p className="truncate text-xs text-text-secondary">{readableTime(run.queuedAt)} · {run.attemptCount} 次尝试 / {run.effectCount} 个效果</p>
    </SelectionTile>
  );
}

function RunsCard({ view, controller }: { view: MonitorViewState; controller: MonitorController }) {
  return (
    <PageCard title="Run 记录" action={view.nextCursor ? <ActionButton onClick={() => void controller.loadOlderRuns()} disabled={view.loadingRuns}>加载更早记录</ActionButton> : undefined}>
      <div className="flex flex-col gap-2">
        {view.loadingRuns && view.runs.length === 0 && <Skeleton lines={4} />}
        {view.runs.map((run) => (
          <RunTile key={run.key} run={run} selected={run.key === view.selectedRunKey} onSelect={() => void controller.select(run.key)} />
        ))}
        {!view.loadingRuns && view.runs.length === 0 && <EmptyState title="没有符合条件的 Run" hint="调整筛选条件后重新应用。" />}
      </div>
    </PageCard>
  );
}

function TrajectoryRowTile({ row, selected, onSelect }: { row: TrajectoryRow; selected: boolean; onSelect(): void }) {
  return (
    <SelectionTile selected={selected} onSelect={onSelect}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-text-body">{row.label}</p>
        <span className="text-xs text-text-secondary">{wireLabel(row.surface)}</span>
      </div>
      <LabeledRows rows={[
        { label: "阶段", value: wireLabel(row.phase) },
        { label: "状态", value: row.outcome ? `${row.status} / ${row.outcome}` : row.status },
        ...(row.contextLabel ? [{ label: "上下文", value: row.contextLabel }] : []),
        ...(row.kind === "attempt" ? [{ label: "尝试", value: String(row.attemptOrdinal) }] : []),
        ...(row.kind === "effect" ? [{ label: "效果", value: wireLabel(row.effectKind) }] : []),
        { label: "时间", value: readableTime(row.occurredAt) },
        ...(row.summary ? [{ label: "摘要", value: row.summary }] : []),
        ...(row.errorReason ? [{ label: "原因", value: row.errorReason }] : []),
      ]} />
    </SelectionTile>
  );
}

function TrajectoryCard({ view, controller }: { view: MonitorViewState; controller: MonitorController }) {
  const trajectory = view.trajectory;
  if (!trajectory) return null;
  return (
    <PageCard title={`轨迹 · ${trajectory.run.title}`} action={trajectory.hasMore ? <ActionButton onClick={() => void controller.loadMoreTrajectory()} disabled={view.loadingTrajectory}>加载更多</ActionButton> : undefined}>
      <div className="flex flex-col gap-2">
        {view.loadingTrajectory && trajectory.rows.length === 0 && <Skeleton lines={4} />}
        {groupTrajectoryRows(trajectory.rows).map((group) => (
          <section key={group.key} aria-label={group.label} className="flex flex-col gap-1.5">
            <h3 className="text-xs font-semibold text-text-secondary">{group.label}</h3>
            {group.rows.map((row) => (
              <TrajectoryRowTile key={row.rowKey} row={row} selected={view.inspectedRowKey === row.rowKey} onSelect={() => void controller.inspect(row.rowKey)} />
            ))}
          </section>
        ))}
        {trajectory.rows.length === 0 && !view.loadingTrajectory && <EmptyState title="该 Run 暂无轨迹事件" />}
      </div>
    </PageCard>
  );
}

export function MonitorPage() {
  const { client, status } = useHomeClient();
  const [view, setView] = useState<MonitorViewState>(INITIAL_MONITOR_STATE);
  const controller = useMemo(() => createMonitorController(setView), []);
  const [draft, setDraft] = useState<MonitorFilters>(INITIAL_MONITOR_STATE.filters);
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_WIDTH_DEFAULT);
  const visible = usePageVisible("monitor");

  useEffect(() => {
    controller.bind(client);
    return () => controller.dispose();
  }, [client, controller]);
  // P1e: while hidden the controller tears its live subscription down and stops re-publishing; reactivation
  // re-attaches and refetches (monitorState → restore) with the selection kept in page memory.
  useEffect(() => { controller.setVisible(visible); }, [controller, visible]);

  const modeHint: Record<MonitorMode, string> = {
    DISABLED: "开发监控已关闭；Run 正确性证据仍由 Core 保留。",
    FEEDBACK_ONLY: "仅展示有界生命周期反馈。",
    FULL_LOCAL: "展示有界、脱敏的本地开发细节。",
  };

  return (
    <>
      <PageHeader title="运行监视" hint={`${modeHint[view.mode]} 这是只读开发面板。`} busy={view.loadingRuns || view.loadingTrajectory} />
      <PageBody>
        {view.error && <PageAlert action={{ label: "重试", onClick: () => void controller.refresh() }}>{view.error}</PageAlert>}
        {view.stale && <FeedbackLine tone="warn">实时流已落后，正在从 durable cursor 重新读取。</FeedbackLine>}
        {view.mode === "DISABLED" ? <PageCard title="监控未启用"><p className="text-xs text-text-secondary">请在 Core 配置中启用 FEEDBACK_ONLY 或 FULL_LOCAL。</p></PageCard> : (
          <MonitorThreeZones
            browser={<><FiltersCard draft={draft} setDraft={setDraft} onApply={() => void controller.applyFilters(draft)} applying={view.loadingRuns} /><RunsCard view={view} controller={controller} /></>}
            ledger={<TrajectoryCard view={view} controller={controller} />}
            inspector={view.inspector && (
              <InspectorPane
                inspector={view.inspector}
                width={inspectorWidth}
                onWidthChange={setInspectorWidth}
                onClose={() => controller.closeInspector()}
              />
            )}
          />
        )}
        <p className="text-xs text-text-secondary">连接：{connectionKindLabel(status.kind)}{view.loadingInspector ? " · 检查器读取中…" : ""}</p>
      </PageBody>
    </>
  );
}
