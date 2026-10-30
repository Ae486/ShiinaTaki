import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { RunEventSchema } from "@taki/shared";
import { classifyToolOutcome } from "../../../../../../../packages/core/src/agents/tool-outcome.ts";
import { inspectEvent } from "../../../../../../../packages/core/src/observability/observability-inspector.ts";
import { projectEvent } from "../../../../../../../packages/core/src/observability/observability-event-projection.ts";
import { pattern } from "@/features/initiative-patterns/pattern-test-fixtures.js";
import { InspectorFields } from "./monitor-view.tsx";
import { projectTrajectoryRecords } from "./trajectory-records.ts";

describe("Pattern tool through actual Monitor projection", () => {
  it.each(["FEEDBACK_ONLY", "FULL_LOCAL"] as const)("keeps full tool payload/IDs/digests out of expanded and accessible %s output", (mode) => {
    const output = { ok: true, status: "applied", pattern: pattern(), commandId: "private-command", digest: "e".repeat(64) };
    const outcome = classifyToolOutcome({ type: "tool-result", output });
    expect(outcome).toEqual({ outcome: "completed" });
    const event = RunEventSchema.parse({ eventId: "private-event", runId: "private-run", attemptId: "private-attempt", seq: 1,
      schemaVersion: "run-event.v1", category: "tool", kind: "tool.result.settled", source: "core.tool-observer", occurredAt: "2026-09-28T10:00:00Z",
      payload: { kind: "tool.result.settled", state: outcome.outcome, ...outcome, toolName: "manage_interaction_pattern",
        toolCallId: "private-tool-call", invocationId: "private-invocation", effectId: "private-effect", durationMs: 125 } });
    const inspector = inspectEvent(event, mode);
    const [record] = projectTrajectoryRecords([projectEvent(event)]);
    const markup = renderToStaticMarkup(<InspectorFields inspector={inspector} record={record} />);
    expect(markup).toContain("管理互动习惯"); expect(markup).toContain("125 毫秒");
    expect(markup).toContain('aria-expanded="true"');
    for (const hidden of ["opaque-pattern", "opaque-revision", "178923", "private-command", "private-event", "private-run",
      "private-attempt", "private-tool-call", "private-invocation", "private-effect", "e".repeat(64), "复制", "manage_interaction_pattern"]) expect(markup).not.toContain(hidden);
    expect(inspector.technical).toEqual([]);
    expect(record?.row.summary).toBeUndefined();
  });
});
