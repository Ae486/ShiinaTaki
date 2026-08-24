import { describe, expect, it } from "vitest";
import type { RunEvent } from "@taki/shared";
import { lifecycleProjection, replayRunEvents } from "./run-event-projection.ts";

const events: RunEvent[] = [
  { eventId: "e1", runId: "r", seq: 1, schemaVersion: "run-event.v1", category: "lifecycle", kind: "run.admitted", occurredAt: "2026-08-24T00:00:00.000Z", source: "core.run-repo", payload: { kind: "run.admitted", state: "queued", initiator: "primary", deliveryClass: "class_a", attemptOrdinal: 1 } },
  { eventId: "e2", runId: "r", seq: 2, schemaVersion: "run-event.v1", category: "lifecycle", kind: "run.settled", occurredAt: "2026-08-24T00:00:01.000Z", source: "core.run-repo", payload: { kind: "run.settled", state: "completed", outcome: "completed", retryability: "not_retryable", summary: "done" } },
];

describe("Run event projection", () => {
  it("rebuilds deterministically and keeps opaque identity out of ordinary summaries", () => {
    const first = replayRunEvents(events, lifecycleProjection);
    const second = replayRunEvents([...events], lifecycleProjection);
    expect(second).toEqual(first);
    expect(first.milestones[0]).toEqual({ label: "run admitted", phase: "run", status: "queued", surface: "current" });
    expect(first.milestones[0]).not.toHaveProperty("runId");
    expect(first.terminal?.outcome).toBe("completed");
  });
});
