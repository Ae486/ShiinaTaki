import { describe, expect, it, vi } from "vitest";
import type { TrajectoryRow } from "@taki/shared";
import { projectTrajectoryRecords } from "./trajectory-records.ts";
import { focusedRecordKeys, orderedRange, panTimeline, projectTimeline, timeAt, visibleDomain, zoomTimeline } from "./trajectory-timing.ts";

const base = { label: "记录", phase: "model" as const, category: "model" as const, categoryLabel: "模型请求",
  status: "已完成", surface: "current" as const, surfaceLabel: "当前" };
const start = Date.parse("2026-09-06T01:00:00.000Z");
const at = (offset: number) => new Date(start + offset).toISOString();
const rows: TrajectoryRow[] = [
  { ...base, seq: 1, rowKey: "model", kind: "model", occurredAt: at(0), startedAt: at(0), durationMs: 100 },
  { ...base, seq: 2, rowKey: "tool", kind: "tool", toolName: "lookup", occurredAt: at(150), startedAt: at(100), durationMs: 50 },
  { ...base, seq: 3, rowKey: "running", kind: "model", occurredAt: at(200), startedAt: at(200), status: "运行中" },
  { ...base, seq: 4, rowKey: "system", kind: "lifecycle", occurredAt: at(250), phase: "run", category: "lifecycle", categoryLabel: "生命周期" },
];

describe("recorded three-lane timing", () => {
  it("projects only measured intervals and never extends an in-flight marker using wall clock", () => {
    const clock = vi.spyOn(Date, "now").mockImplementation(() => { throw new Error("wall clock is not a producer"); });
    try {
      const timeline = projectTimeline(projectTrajectoryRecords(rows))!;
      expect(timeline.start).toBe(start);
      expect(timeline.end).toBe(start + 250);
      expect(timeline.spans.map((span) => [span.lane, span.end - span.start])).toEqual([[1, 100], [2, 50], [1, 0], [0, 0]]);
    } finally { clock.mockRestore(); }
  });

  it("focuses inclusive overlaps, including markers, and clears without changing the model", () => {
    const model = projectTimeline(projectTrajectoryRecords(rows))!;
    const focus = focusedRecordKeys(model, orderedRange(start + 200, start + 100))!;
    expect(model.spans.filter((span) => focus.has(span.record.key)).map((span) => span.record.row.rowKey))
      .toEqual(["model", "tool", "running"]);
    expect(focusedRecordKeys(model, null)).toBeNull();
    expect(model.spans).toHaveLength(4);
  });

  it("zooms around the pointer, clamps panning and returns to the full recorded domain", () => {
    const full = { start: 0, end: 1_000 };
    const zoomed = zoomTimeline(full, full, { fraction: 0.25, delta: -500 })!;
    expect(zoomed.end - zoomed.start).toBeLessThan(1_000);
    expect(timeAt(zoomed, 0.25)).toBeCloseTo(250);
    const right = panTimeline(full, zoomed, -100);
    expect(right.end).toBe(1_000);
    expect(right.end - right.start).toBeCloseTo(zoomed.end - zoomed.start);
    expect(panTimeline(full, right, 100).start).toBe(0);
    expect(zoomTimeline(full, zoomed, { fraction: 0.5, delta: 10_000 })).toBeNull();
  });

  it("handles empty and single-instant domains without assigning a fake duration to any record", () => {
    expect(projectTimeline([])).toBeUndefined();
    const model = projectTimeline(projectTrajectoryRecords([rows[2]!]))!;
    expect(model.end).toBe(model.start);
    expect(visibleDomain(model, null)).toEqual({ start: model.start, end: model.start + 1 });
    expect(model.spans[0]!.record.timing.durationMs).toBeUndefined();
    expect(timeAt({ start: 2, end: 4 }, -10)).toBe(2);
    expect(timeAt({ start: 2, end: 4 }, 10)).toBe(4);
  });
});
