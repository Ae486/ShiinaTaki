import { describe, expect, it } from "vitest";
import type { TrajectoryRow } from "@taki/shared";
import { projectTrajectoryRecords } from "./trajectory-records.ts";
import {
  INITIAL_LEDGER_FILTERS, projectLedgerItems, recordMatches, requestGroupKeys,
  toggleAllFolds, toggleFold, trajectoryFilterOptions,
} from "./trajectory-layout.ts";

const base = { occurredAt: "2026-09-06T01:00:00.000Z", surface: "current" as const, surfaceLabel: "当前", status: "已完成",
  groupKey: "hidden-attempt", phase: "model" as const, category: "model" as const, categoryLabel: "模型请求" };
const rows: TrajectoryRow[] = [
  { ...base, seq: 1, rowKey: "attempt-start", kind: "attempt", attemptOrdinal: 2, label: "尝试开始" },
  { ...base, seq: 2, rowKey: "model-start", kind: "model", label: "模型请求开始", provider: "Provider", modelId: "model [a]",
    eventKind: "model.request.started", modelEffectId: "hidden-model", callId: "hidden-generation" },
  { ...base, seq: 3, rowKey: "tool-start", kind: "tool", category: "tool", categoryLabel: "工具", phase: "tool",
    eventKind: "tool.call.started", modelEffectId: "hidden-model", invocationId: "hidden-invocation", toolCallId: "hidden-call",
    toolName: "hidden-route", displayName: "Search · lookup", label: "工具调用", summary: "literal [a].* content", outcome: "失败" },
];
const records = projectTrajectoryRecords(rows);
const emptyFolds = { attempts: new Set<string>(), requests: new Set<string>() };

describe("trajectory layout and loaded filters", () => {
  it("uses actual Attempt ordinals while keeping all opaque identities out of group labels", () => {
    const items = projectLedgerItems(records, { filters: INITIAL_LEDGER_FILTERS, folds: emptyFolds });
    expect(items[0]).toMatchObject({ type: "attempt", label: "尝试 2", height: 20 });
    expect(items.filter((item) => item.type === "record").every((item) => item.height === 30)).toBe(true);
    const unknown = projectTrajectoryRecords(rows.slice(1));
    expect(projectLedgerItems(unknown, { filters: INITIAL_LEDGER_FILTERS, folds: emptyFolds })[0])
      .toMatchObject({ label: "执行尝试" });
  });

  it("folds requests and attempts independently and restores exactly the remaining fold state", () => {
    const request = requestGroupKeys(records)[0]!;
    const requests = toggleFold(emptyFolds.requests, request);
    const attempts = toggleFold(emptyFolds.attempts, "hidden-attempt");
    expect(projectLedgerItems(records, { filters: INITIAL_LEDGER_FILTERS, folds: { requests, attempts } })).toHaveLength(1);
    const reopened = toggleFold(attempts, "hidden-attempt");
    const items = projectLedgerItems(records, { filters: INITIAL_LEDGER_FILTERS, folds: { requests, attempts: reopened } });
    expect(items.filter((item) => item.type === "record")).toHaveLength(2);
    expect(items.some((item) => item.type === "record" && item.record.row.kind === "tool")).toBe(false);
    expect(toggleAllFolds(requests, [request]).size).toBe(0);
    expect(requests.has(request)).toBe(true);
  });

  it("searches literal authorized fields and includes the exact parent of a matched tool", () => {
    const filters = { ...INITIAL_LEDGER_FILTERS, search: "[a].*" };
    expect(recordMatches(records[2]!, filters)).toBe(true);
    expect(recordMatches(records[1]!, filters)).toBe(false);
    const visible = projectLedgerItems(records, { filters, folds: emptyFolds });
    expect(visible.filter((item) => item.type === "record").map((item) => item.record.row.kind)).toEqual(["model", "tool"]);
    for (const hidden of ["hidden-route", "hidden-invocation", "hidden-call", "hidden-model", "hidden-attempt", "hidden-generation"]) {
      expect(records.some((record) => recordMatches(record, { ...INITIAL_LEDGER_FILTERS, search: hidden }))).toBe(false);
    }
  });

  it("offers real display fields and combines provider/category/outcome/retry filters literally", () => {
    expect(trajectoryFilterOptions(records)).toEqual({ providers: ["Provider"], models: ["model [a]"], tools: ["Search · lookup"],
      statuses: expect.arrayContaining(["已完成", "失败"]) });
    expect(recordMatches(records[1]!, { ...INITIAL_LEDGER_FILTERS, provider: "Provider", model: "model [a]", category: "model" })).toBe(true);
    expect(recordMatches(records[1]!, { ...INITIAL_LEDGER_FILTERS, provider: "Different" })).toBe(false);
    expect(recordMatches(records[2]!, { ...INITIAL_LEDGER_FILTERS, tool: "Search · lookup", failuresOnly: true, status: "失败" })).toBe(true);
    expect(recordMatches(records[2]!, { ...INITIAL_LEDGER_FILTERS, retriesOnly: true })).toBe(false);
    const [retry] = projectTrajectoryRecords([{ ...base, seq: 4, rowKey: "retry", kind: "recovery", eventKind: "run.retry",
      label: "运行重试", category: "recovery", categoryLabel: "重试与恢复", phase: "recovery", classification: "正在重试" }]);
    expect(recordMatches(retry!, { ...INITIAL_LEDGER_FILTERS, retriesOnly: true })).toBe(true);
  });

  it("retains stable record keys through prepends and excludes log-only evidence by default", () => {
    const earlier: TrajectoryRow = { ...base, seq: 1, rowKey: "earlier", groupKey: undefined,
      kind: "lifecycle", label: "已记录", phase: "run", category: "lifecycle", categoryLabel: "生命周期", surface: "log-only" };
    const after = projectTrajectoryRecords([earlier, ...rows.map((row) => ({ ...row, seq: row.seq + 1 }))]);
    expect(after.slice(1).map((record) => record.key)).toEqual(records.map((record) => record.key));
    expect(recordMatches(after[0]!, INITIAL_LEDGER_FILTERS)).toBe(false);
    expect(recordMatches(after[0]!, { ...INITIAL_LEDGER_FILTERS, surface: "all" })).toBe(true);
  });

  it("keeps the Attempt measurement key when an older prefix enters the same group", () => {
    const previous = projectLedgerItems(records, { filters: INITIAL_LEDGER_FILTERS, folds: emptyFolds });
    const prefix: TrajectoryRow = { ...base, seq: 1, rowKey: "earlier-in-attempt", kind: "lifecycle", label: "运行开始" };
    const later = projectTrajectoryRecords([prefix, ...rows.map((row) => ({ ...row, seq: row.seq + 1 }))]);
    const next = projectLedgerItems(later, { filters: INITIAL_LEDGER_FILTERS, folds: emptyFolds });
    expect(next[0]!.key).toBe(previous[0]!.key);
    const interspersed: TrajectoryRow = { ...base, seq: 5, rowKey: "run-fact", groupKey: undefined, kind: "lifecycle", label: "运行记录" };
    const scopedAgain: TrajectoryRow = { ...base, seq: 6, rowKey: "later-in-attempt", kind: "lifecycle", label: "运行记录" };
    const keys = projectLedgerItems(projectTrajectoryRecords([...rows, interspersed, scopedAgain]), {
      filters: INITIAL_LEDGER_FILTERS, folds: emptyFolds,
    }).map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
