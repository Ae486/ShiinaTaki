import { describe, expect, it } from "vitest";
import type { TrajectoryRow } from "@taki/shared";
import { projectTrajectoryRecords, recordContains } from "./trajectory-records.ts";

const at = "2026-09-06T01:00:00.000Z";
const base = { phase: "model" as const, category: "model" as const, categoryLabel: "模型请求", status: "运行中",
  occurredAt: at, surface: "current" as const, surfaceLabel: "当前", groupKey: "attempt-private", callId: "one-generation" };

function model(seq: number, effect: string, patch: Partial<Extract<TrajectoryRow, { kind: "model" }>> = {}): TrajectoryRow {
  return { ...base, rowKey: `model-${seq}`, seq, kind: "model", label: "模型请求开始", provider: "Provider", modelId: "model [a]",
    eventKind: "model.request.started", modelEffectId: effect, startedAt: at, ...patch };
}
function tool(seq: number, invocation: string, patch: Partial<Extract<TrajectoryRow, { kind: "tool" }>> = {}): TrajectoryRow {
  return { ...base, rowKey: `tool-${seq}`, seq, kind: "tool", phase: "tool", category: "tool", categoryLabel: "工具",
    label: "工具调用", status: "已接收", toolName: "opaque-tool", displayName: "Search · lookup", toolCallId: "reused-call",
    invocationId: invocation, eventKind: "tool.call.started", ...patch };
}

describe("semantic trajectory records", () => {
  it("pairs exact requests and invocations across a reused SDK generation and tool call ID", () => {
    const rows: TrajectoryRow[] = [
      model(1, "request-a"), model(2, "request-a", { eventKind: "model.response.settled", status: "已完成", durationMs: 100 }),
      { ...base, kind: "usage", label: "模型用量", category: "usage", categoryLabel: "用量", phase: "usage",
        rowKey: "usage-a", seq: 3, eventKind: "usage.settled", modelEffectId: "request-a", quality: "上游报告", inputTokens: 10 },
      tool(4, "invocation-a", { modelEffectId: "request-a" }),
      tool(5, "invocation-a", { modelEffectId: "request-a", eventKind: "tool.result.settled", outcome: "失败" }),
      model(6, "request-b"), model(7, "request-b", { eventKind: "model.response.settled", status: "已完成", durationMs: 200 }),
      tool(8, "invocation-b", { modelEffectId: "request-b" }),
      tool(9, "invocation-b", { modelEffectId: "request-b", eventKind: "tool.result.settled", outcome: "已完成" }),
    ];
    const records = projectTrajectoryRecords(rows);
    expect(records).toHaveLength(4);
    expect(records[0]!.usage?.inputTokens).toBe(10);
    expect(records[1]!.requestKey).toBe(records[0]!.key);
    expect(records[3]!.requestKey).toBe(records[2]!.key);
    expect(records[1]!.key).not.toBe(records[3]!.key);
    expect(records[1]!.error).toBe(true);
    expect(records.flatMap((record) => record.sources.map((row) => row.rowKey)).sort())
      .toEqual(rows.map((row) => row.rowKey).sort());
  });

  it("keeps ambiguous identities and legacy call-only evidence independent", () => {
    const records = projectTrajectoryRecords([
      model(1, "conflict"), model(2, "conflict"),
      tool(3, "ambiguous", { modelEffectId: "conflict" }),
      tool(4, "ambiguous", { modelEffectId: "another-request", eventKind: "tool.result.settled" }),
      tool(5, "", { invocationId: undefined, modelEffectId: undefined }),
      tool(6, "", { invocationId: undefined, modelEffectId: undefined, eventKind: "tool.result.settled" }),
    ]);
    expect(records).toHaveLength(6);
    expect(records.every((record) => record.sources.length === 1 && record.requestKey === undefined)).toBe(true);
  });

  it("does not invent a missing request boundary for a tail-only tool result", () => {
    const [request, operation] = projectTrajectoryRecords([
      model(2, "request-a", { eventKind: "model.response.settled", startedAt: undefined, durationMs: 500 }),
      tool(3, "invocation-a", { modelEffectId: "request-a", eventKind: "tool.result.settled", durationMs: 100 }),
    ]);
    expect(request!.requestKey).toBeUndefined();
    expect(operation!.requestKey).toBeUndefined();
    expect(operation!.timing.end).toBe(operation!.timing.start);
    expect(operation!.timing.durationMs).toBe(100);
  });

  it("keeps a logical record key and selected source when its terminal observation arrives", () => {
    const start = tool(1, "invocation-a");
    const [before] = projectTrajectoryRecords([start]);
    const [after] = projectTrajectoryRecords([start, tool(2, "invocation-a", {
      eventKind: "tool.result.settled", outcome: "结果未知", status: "已记录", startedAt: at, durationMs: 55,
    })]);
    expect(after!.key).toBe(before!.key);
    expect(recordContains(after!, start.rowKey)).toBe(true);
    expect(after!.row.outcome).toBe("结果未知");
    expect(after!.timing.startKind).toBe("processing");
    expect(after!.timing.end - after!.timing.start).toBe(55);
  });

  it("retains full captured names and uses a generic fallback without decoding routing keys", () => {
    const captured = "名".repeat(240);
    const records = projectTrajectoryRecords([
      tool(1, "captured", { displayName: captured }),
      tool(2, "legacy", { displayName: undefined, toolName: "ext_mcp_privatehash_route" }),
    ]);
    expect(records[0]!.name).toBe(captured);
    expect(records[1]!.name).toBe("工具调用");
    expect(records[1]!.name).not.toContain("privatehash");
  });

  it("uses a start marker until duration exists and preserves real zero-duration samples", () => {
    const [running] = projectTrajectoryRecords([model(1, "running")]);
    expect(running!.timing.durationMs).toBeUndefined();
    expect(running!.timing.end).toBe(running!.timing.start);
    const [zero] = projectTrajectoryRecords([model(1, "zero", { eventKind: "model.response.settled", durationMs: 0 })]);
    expect(zero!.timing.durationMs).toBe(0);
    expect(zero!.timing.end).toBe(zero!.timing.start);
  });
});
