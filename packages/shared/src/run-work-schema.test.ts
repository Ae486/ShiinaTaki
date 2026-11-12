import { describe, expect, it } from "vitest";
import { RunEventSchema, RunEventV1Schema } from "./run-event-schema.ts";

const held = {
  eventId: "event", runId: "root", attemptId: "attempt", seq: 4,
  schemaVersion: "run-event.v3", category: "lifecycle", kind: "run.work_held",
  occurredAt: "2026-10-10T01:00:00.000Z", source: "core.run-work",
  payload: { kind: "run.work_held", state: "waiting", runVersion: 2 },
};

describe("bounded accepted-work lifecycle events", () => {
  it("reads held/resumed events without changing the historical v1 decoder", () => {
    expect(RunEventSchema.safeParse(held).success).toBe(true);
    expect(RunEventV1Schema.safeParse({ ...held, schemaVersion: "run-event.v1" }).success).toBe(false);
    expect(RunEventSchema.safeParse({ ...held, kind: "run.work_resumed",
      payload: { kind: "run.work_resumed", state: "running", runVersion: 3 } }).success).toBe(true);
  });

  it("rejects mismatched state, source, Attempt absence and content-bearing additions", () => {
    const missingAttempt = { ...held, attemptId: undefined };
    for (const candidate of [missingAttempt, { ...held, source: "core.delivery" },
      { ...held, payload: { ...held.payload, state: "running" } },
      { ...held, payload: { ...held.payload, reasonRef: "private task source" } },
      { ...held, payload: { ...held.payload, runVersion: -1 } }]) {
      expect(RunEventSchema.safeParse(candidate).success).toBe(false);
    }
  });
});
