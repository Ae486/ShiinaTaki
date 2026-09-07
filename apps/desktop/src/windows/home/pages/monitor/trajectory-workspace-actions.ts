/**
 * INPUT:  local trajectory selection/filter/fold state plus existing controller and ledger commands
 * OUTPUT: coordinated explicit navigation that preserves reading anchors and never changes Run truth
 * POS:    ui/monitor — DSH view interaction adapter; see third-party-notices.md (DeepSeek MIT)
 */
import type { Dispatch, SetStateAction } from "react";
import type { MonitorController, MonitorViewState } from "./monitor-controller.ts";
import {
  INITIAL_LEDGER_FILTERS, recordMatches, toggleAllFolds, toggleFold,
  type LedgerFilters, type LedgerFolds, type LedgerItem,
} from "./trajectory-layout.ts";
import { recordContains, type TrajectoryRecord } from "./trajectory-records.ts";
import { focusedRecordKeys, type TimeRange, type TimelineModel } from "./trajectory-timing.ts";
import type { LedgerHandle } from "./use-trajectory-follow.ts";

interface ActionContext {
  controller: MonitorController;
  view: MonitorViewState;
  records: readonly TrajectoryRecord[];
  items: readonly LedgerItem[];
  ledger: { current: LedgerHandle | null };
  pendingFocus: { current: string | undefined };
  groups: { attempts: readonly string[]; requests: readonly string[] };
  filters: LedgerFilters;
  folds: LedgerFolds;
  range: TimeRange | null;
  model?: TimelineModel;
}
interface ActionSetters {
  setFilters: Dispatch<SetStateAction<LedgerFilters>>;
  setFolds: Dispatch<SetStateAction<LedgerFolds>>;
  setRange: Dispatch<SetStateAction<TimeRange | null>>;
  setActualDuration: Dispatch<SetStateAction<boolean>>;
}

export function trajectoryActions(context: ActionContext, setters: ActionSetters) {
  const hold = () => context.ledger.current?.holdAnchor();
  const closeInspector = () => { hold(); context.controller.closeInspector(); };
  const select = (record: TrajectoryRecord) => {
    hold();
    const focused = focusedRecordKeys(context.model, context.range);
    if (focused && !focused.has(record.key)) setters.setRange(null);
    if (recordContains(record, context.view.inspectedRowKey)) context.controller.closeInspector();
    else void context.controller.inspect(record.row.rowKey);
  };
  return {
    select, closeInspector,
    loadOlder: async () => { hold(); await context.controller.loadMoreTrajectory(); },
    changeFilters: (filters: LedgerFilters) => { hold(); setters.setFilters(filters); },
    changeDuration: (duration: boolean) => { setters.setRange(null); setters.setActualDuration(duration); },
    toggleAttempt: (key: string) => { hold(); setters.setFolds((folds) => ({ ...folds, attempts: toggleFold(folds.attempts, key) })); },
    toggleRequest: (key: string) => { hold(); setters.setFolds((folds) => ({ ...folds, requests: toggleFold(folds.requests, key) })); },
    toggleAttempts: () => { hold(); setters.setFolds((folds) => ({ ...folds, attempts: toggleAllFolds(folds.attempts, context.groups.attempts) })); },
    toggleRequests: () => { hold(); setters.setFolds((folds) => ({ ...folds, requests: toggleAllFolds(folds.requests, context.groups.requests) })); },
    changeRange: (range: TimeRange | null) => {
      hold(); setters.setRange(range);
      const keys = focusedRecordKeys(context.model, range);
      context.pendingFocus.current = context.items.find((item) => item.type === "record" && keys?.has(item.key))?.key;
    },
    selectRecord: (key: string) => revealRecord(context, setters, key),
    resume: () => { setters.setRange(null); context.controller.closeInspector(); context.ledger.current?.resume(); },
  };
}

function revealRecord(context: ActionContext, setters: ActionSetters, key: string): void {
  const record = context.records.find((candidate) => candidate.key === key);
  if (!record) return;
  context.ledger.current?.holdAnchor();
  context.pendingFocus.current = key;
  setters.setRange(null);
  // An explicit Overview selection reveals its actual record even when a previous filter hid it.
  // The matching logic still runs exclusively over authorized loaded rows.
  if (!recordMatches(record, context.filters)) setters.setFilters({ ...INITIAL_LEDGER_FILTERS,
    surface: record.row.surface === "current" ? "current" : "all" });
  setters.setFolds((folds) => ({
    attempts: withoutKey(folds.attempts, record.attemptKey), requests: withoutKey(folds.requests, record.requestKey),
  }));
  if (!recordContains(record, context.view.inspectedRowKey)) void context.controller.inspect(record.row.rowKey);
}

function withoutKey(values: ReadonlySet<string>, key: string | undefined): ReadonlySet<string> {
  const next = new Set(values);
  if (key) next.delete(key);
  return next;
}
