import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { TrajectoryInspector, TrajectoryRow } from "@taki/shared";
import { groupTrajectoryRows, InspectorFields } from "./monitor-view.tsx";

const base = { seq: 1, label: "Run Started", phase: "run" as const, category: "lifecycle" as const,
  categoryLabel: "生命周期", status: "Running", occurredAt: "2026-08-27T00:00:00.000Z",
  surface: "current" as const, surfaceLabel: "当前" };

describe("monitor view", () => {
  it("groups technical attempt keys without rendering them as labels", () => {
    const rows: TrajectoryRow[] = [
      { ...base, rowKey: "run-row", kind: "lifecycle" },
      { ...base, rowKey: "attempt-row", seq: 2, groupKey: "opaque-attempt-id", kind: "attempt", attemptOrdinal: 2 },
      { ...base, rowKey: "effect-row", seq: 3, groupKey: "opaque-attempt-id", kind: "effect", effectKind: "tool" },
    ];
    expect(groupTrajectoryRows(rows).map((group) => ({ label: group.label, size: group.rows.length })))
      .toEqual([{ label: "Run", size: 1 }, { label: "Attempt 2", size: 2 }]);
  });

  it("gives every inspector technical field a labeled copy control", () => {
    const inspector: TrajectoryInspector = { mode: "FULL_LOCAL", title: "Run Started", detail: [],
      technical: [{ label: "Event ID", value: "event-1" }], technicalCollapsed: true,
      redactionNotice: "Sensitive content excluded." };
    const html = renderToStaticMarkup(<InspectorFields inspector={inspector} />);
    expect(html).toContain("Event ID"); expect(html).toContain('aria-label="复制 Event ID"'); expect(html).toContain("复制");
  });
});
