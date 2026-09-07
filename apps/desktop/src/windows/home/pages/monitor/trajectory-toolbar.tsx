/**
 * INPUT:  loaded record filters, independent group folds, recorded timing mode, and durable Run totals
 * OUTPUT: DSH's compact 32px Toolbar with Chinese controls and explicitly loaded-window search
 * POS:    ui/monitor — DSH TrajectoryToolbar adaptation; see third-party-notices.md (DeepSeek MIT)
 */
import { useEffect, useId, useRef, useState } from "react";
import type { RunMonitorSummary } from "@taki/shared";
import type { LedgerFilters, LedgerFolds } from "./trajectory-layout.ts";
import type { TrajectoryRecord } from "./trajectory-records.ts";
import type { TimeRange } from "./trajectory-timing.ts";
import { TrajectoryFilters } from "./trajectory-filters.tsx";
import css from "./trajectory-toolbar.module.css";

interface ToolbarModel {
  records: readonly TrajectoryRecord[];
  filters: LedgerFilters;
  groups: { attempts: readonly string[]; requests: readonly string[] };
  folds: LedgerFolds;
  actualDuration: boolean;
  range: TimeRange | null;
  run: RunMonitorSummary;
}
interface ToolbarActions {
  changeDuration(actual: boolean): void;
  toggleAttempts(): void;
  toggleRequests(): void;
  changeFilters(filters: LedgerFilters): void;
  changeRange(range: TimeRange | null): void;
}

export function TrajectoryToolbar({ model, actions, active }: { model: ToolbarModel; actions: ToolbarActions; active: boolean }) {
  const [filterOpen, setFilterOpen] = useState(false);
  const id = useId();
  const filterToggle = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!active) setFilterOpen(false); }, [active]);
  const closeFilters = () => { setFilterOpen(false); filterToggle.current?.focus({ preventScroll: true }); };
  return <div className={css.root} role="toolbar" aria-label="执行轨迹工具栏">
    <div className={css.inner}>
      <div className={css.actions}>
        <button type="button" className={css.action} aria-pressed={model.actualDuration}
          aria-label="显示实际耗时" title={model.actualDuration ? "切换为开始标记" : "显示实际耗时"}
          onClick={() => actions.changeDuration(!model.actualDuration)}>
          <svg className={css.icon} viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.25" /><path d="M8 4.75V8l2.25 1.5" /></svg>耗时
        </button>
        <GroupControl label="尝试" keys={model.groups.attempts} closed={model.folds.attempts} toggle={actions.toggleAttempts} />
        <GroupControl label="请求中的工具" keys={model.groups.requests} closed={model.folds.requests} toggle={actions.toggleRequests} />
      </div>
      <span className={css.totals} title="整次运行的已记录合计">{model.run.modelRequestCount} 次请求 · {model.run.toolCallCount} 次工具调用</span>
      {model.range && <button type="button" className={css.action} onClick={() => actions.changeRange(null)}>清除时间范围</button>}
      <label className={css.search}>
        <svg className={css.icon} viewBox="0 0 16 16" aria-hidden="true"><circle cx="6.5" cy="6.5" r="4" /><path d="m9.5 9.5 4 4" /></svg>
        <input type="search" value={model.filters.search} maxLength={200} aria-label="搜索已载入记录"
          placeholder="搜索已载入记录" onChange={(event) => actions.changeFilters({ ...model.filters, search: event.target.value })} />
      </label>
      <button ref={filterToggle} type="button" className={css.action} aria-expanded={filterOpen} aria-controls={id}
        onClick={() => setFilterOpen((open) => !open)}>记录筛选</button>
    </div>
    {filterOpen && <TrajectoryFilters id={id} records={model.records} value={model.filters}
      change={actions.changeFilters} close={closeFilters} />}
  </div>;
}

function GroupControl({ label, keys, closed, toggle }: {
  label: string; keys: readonly string[]; closed: ReadonlySet<string>; toggle(): void;
}) {
  const collapsed = keys.length > 0 && keys.every((key) => closed.has(key));
  return <button type="button" className={css.action} disabled={keys.length === 0}
    aria-label={`${collapsed ? "展开" : "收起"}全部${label}`} aria-pressed={collapsed}
    aria-expanded={keys.length > 0 ? !collapsed : undefined} onClick={toggle}>
    <span aria-hidden="true">{collapsed ? "⊞" : "⊟"}</span>{label}
  </button>;
}
