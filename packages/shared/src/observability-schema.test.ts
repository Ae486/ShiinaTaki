import { describe, expect, it } from "vitest";
import { MonitorModeSchema, RunMonitorListParamsSchema, RunMonitorEventSchema, RunMonitorSummarySchema, TrajectoryParamsSchema, TrajectoryRowSchema, TrajectoryInspectorSchema } from "./observability-schema.ts";
import { RunEventPayloadSchema } from "./run-event-schema.ts";

describe("observability schemas", () => {
  it("keeps the mode closed and disabled by explicit value", () => { expect(MonitorModeSchema.options).toEqual(["DISABLED", "FEEDBACK_ONLY", "FULL_LOCAL"]); });
  it("rejects oversized pages, stale ranges, and unknown filters", () => { expect(RunMonitorListParamsSchema.safeParse({ characterId: "taki", limit: 51 }).success).toBe(false); expect(RunMonitorListParamsSchema.safeParse({ characterId: "taki", from: "2026-08-28T00:00:00.000Z", to: "2026-08-27T00:00:00.000Z" }).success).toBe(false); expect(RunMonitorListParamsSchema.safeParse({ characterId: "taki", raw: true }).success).toBe(false); });
  it("keeps live notifications bounded and rejects raw payload fields", () => { expect(RunMonitorEventSchema.safeParse({ runKey: "run", cursor: 1, invalidated: true, reason: "overflow" }).success).toBe(true); expect(RunMonitorEventSchema.safeParse({ runKey: "run", cursor: 1, payload: { secret: "x" } }).success).toBe(false); });
  it("does not backfill missing producer counts with synthetic zero defaults", () => {
    const summary = { key: "run", characterId: "taki", title: "运行", initiator: "primary", initiatorLabel: "用户发起", triggerLabel: "对话", deliveryClass: "class_a", deliveryLabel: "A 类交付", state: "queued", queuedAt: "2026-08-28T00:00:00.000Z", attemptCount: 1, effectCount: 0, usage: {} };
    expect(RunMonitorSummarySchema.safeParse(summary).success).toBe(false);
  });

  it("preserves legacy forward queries and rejects conflicting or out-of-bounds history cursors", () => {
    const base = { characterId: "taki", runKey: "run" };
    expect(TrajectoryParamsSchema.parse(base)).toMatchObject({ afterSeq: 0, limit: 100 });
    for (const valid of [{ tail: true }, { beforeSeq: 1 }, { beforeSeq: 200, limit: 200 }, { afterSeq: 1, limit: 1 }]) {
      expect(TrajectoryParamsSchema.safeParse({ ...base, ...valid }).success).toBe(true);
    }
    for (const invalid of [{ tail: false }, { beforeSeq: 0 }, { limit: 0 }, { limit: 201 }, { tail: true, beforeSeq: 1 }, { tail: true, afterSeq: 1 }, { beforeSeq: 1, afterSeq: 1 }]) {
      expect(TrajectoryParamsSchema.safeParse({ ...base, ...invalid }).success).toBe(false);
    }
  });

  it("retains 240-unit captured names and optional exact identities without admitting raw input", () => {
    const payload = { kind: "tool.call.started", state: "received", validationState: "accepted", toolName: "tool", toolCallId: "call", invocationId: "invocation", modelEffectId: "model-effect", displayName: "名".repeat(240) };
    expect(RunEventPayloadSchema.parse(payload)).toEqual(payload);
    expect(RunEventPayloadSchema.safeParse({ ...payload, displayName: "名".repeat(241) }).success).toBe(false);
    expect(RunEventPayloadSchema.safeParse({ ...payload, input: {} }).success).toBe(false);
    const row = { rowKey: "row", seq: 1, label: "工具", phase: "tool", category: "tool", categoryLabel: "工具", status: "已接收", occurredAt: "2026-09-06T00:00:00.000Z", surface: "current", surfaceLabel: "当前", kind: "tool", toolName: "tool", displayName: payload.displayName, modelEffectId: "model-effect", invocationId: "invocation" };
    expect(TrajectoryRowSchema.parse(row).kind).toBe("tool");
    expect(TrajectoryRowSchema.safeParse({ ...row, raw: {} }).success).toBe(false);
  });

  it("admits only populated semantic section kinds", () => {
    const inspector = { mode: "FULL_LOCAL", title: "详情", detail: [], technical: [], technicalCollapsed: true, redactionNotice: "仅展示语义信息", sections: [{ key: "tool", fields: [{ label: "工具", value: "读取文件" }] }] };
    expect(TrajectoryInspectorSchema.safeParse(inspector).success).toBe(true);
    expect(TrajectoryInspectorSchema.safeParse({ ...inspector, sections: [{ key: "prompt", fields: [] }] }).success).toBe(false);
    expect(TrajectoryInspectorSchema.safeParse({ ...inspector, sections: [{ key: "tool", fields: [] }] }).success).toBe(false);
  });
});
