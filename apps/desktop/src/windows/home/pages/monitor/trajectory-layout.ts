/**
 * INPUT:  safe semantic records, literal loaded-history filters, and independent Attempt/request fold sets
 * OUTPUT: stable measurable ledger items and ancestor-aware search matches without changing event authority
 * POS:    ui/monitor — DSH layout/virtual-row adaptation; see third-party-notices.md (DeepSeek MIT)
 */
import type { RunEventCategory } from "@taki/shared";
import type { TrajectoryRecord } from "./trajectory-records.ts";

export interface LedgerFilters {
  search: string;
  category: RunEventCategory | "";
  surface: "current" | "all";
  failuresOnly: boolean;
  provider: string;
  model: string;
  tool: string;
  status: string;
  retriesOnly: boolean;
}
export interface LedgerFolds { attempts: ReadonlySet<string>; requests: ReadonlySet<string> }
export type LedgerItem =
  | { type: "attempt"; key: string; groupKey: string; label: string; count: number; collapsed: boolean; height: 20 }
  | { type: "record"; key: string; record: TrajectoryRecord; requestChildren: number; collapsed: boolean; height: 30 };

export const INITIAL_LEDGER_FILTERS: LedgerFilters = {
  search: "", category: "", surface: "current", failuresOnly: false,
  provider: "", model: "", tool: "", status: "", retriesOnly: false,
};

export function recordMatches(record: TrajectoryRecord, filters: LedgerFilters): boolean {
  if (filters.surface !== "all" && record.row.surface !== "current") return false;
  if (filters.category && !record.sources.some((row) => row.category === filters.category)) return false;
  if (filters.failuresOnly && !record.error) return false;
  if (filters.provider && !record.sources.some((row) => row.kind === "model" && row.provider === filters.provider)) return false;
  if (filters.model && !record.sources.some((row) => row.kind === "model" && row.modelId === filters.model)) return false;
  if (filters.tool && !(record.row.kind === "tool" && record.name === filters.tool)) return false;
  if (filters.status && record.row.status !== filters.status && record.row.outcome !== filters.status) return false;
  if (filters.retriesOnly && !record.sources.some((row) => row.eventKind === "run.retry")) return false;
  const search = filters.search.trim().toLocaleLowerCase("zh-CN");
  if (!search) return true;
  const semantic = record.sources.flatMap((row) => [
    row.label, row.status, row.outcome, row.categoryLabel, row.summary, row.errorReason, row.contextLabel,
    ...(row.kind === "model" ? [row.provider, row.modelId, row.finishReason] : []),
    ...(row.kind === "tool" ? [row.displayName, row.errorClass] : []),
  ]);
  return [record.name, ...semantic].filter(Boolean).join(" ").toLocaleLowerCase("zh-CN").includes(search);
}

export function projectLedgerItems(records: readonly TrajectoryRecord[], options: {
  filters: LedgerFilters; folds: LedgerFolds;
}): LedgerItem[] {
  const matching = new Set(records.filter((record) => recordMatches(record, options.filters)).map((record) => record.key));
  const parents = new Set(records.filter((record) => matching.has(record.key)).flatMap((record) => record.requestKey ? [record.requestKey] : []));
  const visible = records.filter((record) => matching.has(record.key) || parents.has(record.key));
  const requests = countChildren(visible);
  const items: LedgerItem[] = [];
  const seenAttempts = new Set<string>();
  for (const record of visible) {
    const group = record.attemptKey;
    if (group && !seenAttempts.has(group)) {
      seenAttempts.add(group);
      items.push({ type: "attempt", key: `attempt:${group}`, groupKey: group,
        label: attemptLabel(records, group), count: visible.filter((item) => item.attemptKey === group).length,
        collapsed: options.folds.attempts.has(group), height: 20 });
    }
    if (group && options.folds.attempts.has(group)) continue;
    if (record.requestKey && record.key !== record.requestKey && options.folds.requests.has(record.requestKey)) continue;
    items.push({ type: "record", key: record.key, record, height: 30,
      requestChildren: requests.get(record.key) ?? 0, collapsed: options.folds.requests.has(record.key) });
  }
  return items;
}

export function requestGroupKeys(records: readonly TrajectoryRecord[]): string[] {
  return [...countChildren(records)].filter(([, count]) => count > 0).map(([key]) => key);
}

export function trajectoryFilterOptions(records: readonly TrajectoryRecord[]) {
  const distinct = (values: readonly string[]) => [...new Set(values)].sort((left, right) => left.localeCompare(right, "zh-CN"));
  const models = records.flatMap((record) => record.sources.filter((row) => row.kind === "model"));
  return {
    providers: distinct(models.flatMap((row) => row.provider ? [row.provider] : [])),
    models: distinct(models.flatMap((row) => row.modelId ? [row.modelId] : [])),
    tools: distinct(records.filter((record) => record.row.kind === "tool").map((record) => record.name)),
    statuses: distinct(records.flatMap((record) => [record.row.status, ...(record.row.outcome ? [record.row.outcome] : [])])),
  };
}

function countChildren(records: readonly TrajectoryRecord[]): Map<string, number> {
  const children = new Map<string, number>();
  for (const record of records) {
    if (record.requestKey && record.key !== record.requestKey) {
      children.set(record.requestKey, (children.get(record.requestKey) ?? 0) + 1);
    }
  }
  return children;
}

function attemptLabel(records: readonly TrajectoryRecord[], groupKey: string): string {
  const ordinals = new Set(records.flatMap((record) => record.sources.flatMap((row) =>
    row.groupKey === groupKey && row.kind === "attempt" ? [row.attemptOrdinal] : [])));
  return ordinals.size === 1 ? `尝试 ${[...ordinals][0]}` : "执行尝试";
}

export function toggleFold(previous: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(previous);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}

export function toggleAllFolds(previous: ReadonlySet<string>, keys: readonly string[]): ReadonlySet<string> {
  const next = new Set(previous);
  const collapsed = keys.length > 0 && keys.every((key) => next.has(key));
  for (const key of keys) if (collapsed) next.delete(key); else next.add(key);
  return next;
}
