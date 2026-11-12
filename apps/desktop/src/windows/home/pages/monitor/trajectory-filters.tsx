/**
 * INPUT:  safe loaded record fields and local filter choices
 * OUTPUT: a closable Chinese filter popover with only producer-backed provider/model/tool/status options
 * POS:    ui/monitor — Toolbar detail adapter; literal search never scans data outside the loaded window
 */
import { useEffect, useRef } from "react";
import { RunEventCategorySchema, type RunEventCategory } from "@taki/shared";
import { wireLabel } from "./monitor-labels.ts";
import { trajectoryFilterOptions, type LedgerFilters } from "./trajectory-layout.ts";
import type { TrajectoryRecord } from "./trajectory-records.ts";
import css from "./trajectory-toolbar.module.css";

interface FilterProps {
  id: string;
  records: readonly TrajectoryRecord[];
  value: LedgerFilters;
  change(value: LedgerFilters): void;
  close(): void;
}

export function TrajectoryFilters({ id, records, value, change, close }: FilterProps) {
  const ref = useFilterDismiss(close);
  const choices = trajectoryFilterOptions(records);
  return <div ref={ref} className={css.popover} id={id} aria-label="筛选已载入记录">
    <label>记录类别<select value={value.category} onChange={(event) => change({ ...value, category: event.target.value as RunEventCategory | "" })}>
      <option value="">全部类别</option>{RunEventCategorySchema.options.map((category) => <option key={category} value={category}>{wireLabel(category)}</option>)}
    </select></label>
    <label>记录范围<select value={value.surface} onChange={(event) => change({ ...value, surface: event.target.value as LedgerFilters["surface"] })}>
      <option value="current">当前记录</option><option value="all">全部（含已替代与仅记录）</option>
    </select></label>
    <Choice label="提供方" options={choices.providers} value={value.provider} change={(provider) => change({ ...value, provider })} />
    <Choice label="模型" options={choices.models} value={value.model} change={(model) => change({ ...value, model })} />
    <Choice label="工具" options={choices.tools} value={value.tool} change={(tool) => change({ ...value, tool })} />
    <Choice label="状态或结果" options={choices.statuses} value={value.status} change={(status) => change({ ...value, status })} />
    <label className={css.checkbox}><input type="checkbox" checked={value.failuresOnly}
      onChange={(event) => change({ ...value, failuresOnly: event.target.checked })} />失败或未知结果</label>
    <label className={css.checkbox}><input type="checkbox" checked={value.retriesOnly}
      onChange={(event) => change({ ...value, retriesOnly: event.target.checked })} />只看重试</label>
    <button type="button" className={css.action} onClick={close}>关闭记录筛选</button>
  </div>;
}

function Choice({ label, options, value, change }: { label: string; options: readonly string[]; value: string; change(value: string): void }) {
  return <label>{label}<select value={value} onChange={(event) => change(event.target.value)}>
    <option value="">全部</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}
  </select></label>;
}

function useFilterDismiss(close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); latest.current(); }
    };
    const outside = (event: PointerEvent) => {
      // The toolbar's own toggle must receive its click without a preceding close/reopen race.
      if (event.target instanceof Node && !ref.current?.parentElement?.contains(event.target)) latest.current();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", outside); };
  }, []);
  return ref;
}
