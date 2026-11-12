/**
 * INPUT:  loaded authorized trajectory state and the existing Monitor controller
 * OUTPUT: local record/range selection, independent folds, filters, Inspector width, and scroll commands
 * POS:    ui/monitor — DSH TrajectoryView adaptation; see third-party-notices.md; no execution state authority
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TrajectoryRow } from "@taki/shared";
import type { MonitorController, MonitorViewState } from "./monitor-controller.ts";
import { projectTrajectoryRecords, recordContains } from "./trajectory-records.ts";
import { INITIAL_LEDGER_FILTERS, projectLedgerItems, requestGroupKeys, type LedgerFilters, type LedgerFolds } from "./trajectory-layout.ts";
import { focusedRecordKeys, projectTimeline, type TimeRange } from "./trajectory-timing.ts";
import { trajectoryActions } from "./trajectory-workspace-actions.ts";
import { INSPECTOR_WIDTH_DEFAULT } from "./use-inspector-resize.ts";
import type { LedgerHandle } from "./use-trajectory-follow.ts";

const EMPTY_ROWS: readonly TrajectoryRow[] = [];
interface WorkspaceInput { view: MonitorViewState; controller: MonitorController }

export function useTrajectoryWorkspace({ view, controller }: WorkspaceInput) {
  const rows = view.trajectory?.rows ?? EMPTY_ROWS;
  const [filters, setFilters] = useState<LedgerFilters>(INITIAL_LEDGER_FILTERS);
  const [folds, setFolds] = useState<LedgerFolds>({ attempts: new Set(), requests: new Set() });
  const [range, setRange] = useState<TimeRange | null>(null);
  const [actualDuration, setActualDuration] = useState(true);
  const [width, setWidth] = useState(INSPECTOR_WIDTH_DEFAULT);
  const [resizing, setResizing] = useState(false);
  const ledger = useRef<LedgerHandle | null>(null);
  const pendingFocus = useRef<string | undefined>(undefined);
  const records = useMemo(() => projectTrajectoryRecords(rows), [rows]);
  const model = useMemo(() => projectTimeline(records), [records]);
  const focusKeys = useMemo(() => focusedRecordKeys(model, range), [model, range]);
  const items = useMemo(() => projectLedgerItems(records, { filters, folds }), [records, filters, folds]);
  const selected = records.find((record) => recordContains(record, view.inspectedRowKey));
  const groups = useMemo(() => ({ attempts: [...new Set(records.flatMap((record) => record.attemptKey ? [record.attemptKey] : []))],
    requests: requestGroupKeys(records) }), [records]);
  const context = { controller, view, records, items, ledger, pendingFocus, groups, filters, folds, range, model };
  const actions = trajectoryActions(context, { setFilters, setFolds, setRange, setActualDuration });
  useLayoutEffect(() => {
    const key = pendingFocus.current;
    if (key && items.some((item) => item.type === "record" && item.key === key)) {
      ledger.current?.focusRecord(key);
      pendingFocus.current = undefined;
    }
  }, [items, view.inspectedRowKey, range]);
  return { records, model, items, selected, focusKeys, range, filters, folds, groups, ledger, actualDuration, width, resizing,
    actions, inspectorActions: { close: actions.closeInspector, resize: setWidth, resizing: setResizing } };
}
