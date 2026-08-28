import { describe, expect, it } from "vitest";
import { RunEventSchema } from "./run-event-schema.ts";

const at = "2026-08-28T00:00:00.000Z";

describe("Run event observability schema", () => {
  it("accepts authoritative detailed usage without inventing absent cache buckets", () => {
    const parsed = RunEventSchema.parse({
      eventId: "event", runId: "run", attemptId: "attempt", seq: 1,
      schemaVersion: "run-event.v1", category: "usage", kind: "usage.settled",
      occurredAt: at, source: "core.effect-lifecycle",
      payload: {
        kind: "usage.settled", state: "settled", effectId: "effect", usageId: "usage",
        quality: "reported", inputTokens: 13,
        inputTokenDetails: { noCacheTokens: 8, cacheReadTokens: 5 },
        outputTokens: 7, outputTokenDetails: { textTokens: 4, reasoningTokens: 3 }, totalTokens: 20,
      },
    });
    expect(parsed.payload).toMatchObject({
      inputTokenDetails: { noCacheTokens: 8, cacheReadTokens: 5 },
      outputTokenDetails: { textTokens: 4, reasoningTokens: 3 }, totalTokens: 20,
    });
    expect(parsed.payload).not.toHaveProperty("inputTokenDetails.cacheWriteTokens");
  });

  it("requires attempt scope plus the fixed category and source for model facts", () => {
    const event = {
      eventId: "event", runId: "run", seq: 1, schemaVersion: "run-event.v1",
      category: "model", kind: "model.request.started", occurredAt: at, source: "core.model-observer",
      payload: {
        kind: "model.request.started", state: "running", effectId: "effect", callId: "call",
        provider: "provider", modelId: "model", startedAt: at,
      },
    } as const;
    expect(RunEventSchema.safeParse(event).success).toBe(false);
    expect(RunEventSchema.safeParse({ ...event, attemptId: "attempt", category: "lifecycle" }).success).toBe(false);
    expect(RunEventSchema.safeParse({ ...event, attemptId: "attempt" }).success).toBe(true);
  });

  it("rejects raw payload fields and protected content in bounded summaries", () => {
    const base = {
      eventId: "event", runId: "run", attemptId: "attempt", seq: 1,
      schemaVersion: "run-event.v1", category: "tool", kind: "tool.result.settled",
      occurredAt: at, source: "core.tool-observer",
      payload: {
        kind: "tool.result.settled", state: "failed", toolName: "echo", toolCallId: "tool-call",
        outcome: "failed", errorClass: "execution", errorCode: "tool_failed",
      },
    } as const;
    expect(RunEventSchema.safeParse({ ...base, payload: { ...base.payload, arguments: { secret: "x" } } }).success).toBe(false);
    expect(RunEventSchema.safeParse({ ...base, payload: { ...base.payload, summary: "raw tool payload: secret" } }).success).toBe(false);
  });

  it("keeps historical recovery events readable while assigning new recovery ownership", () => {
    const payload = {
      kind: "recovery.classified", state: "recovering", classification: "safe_replay",
    } as const;
    const base = { eventId: "event", runId: "run", seq: 1, schemaVersion: "run-event.v1", occurredAt: at, payload } as const;
    expect(RunEventSchema.safeParse({ ...base, category: "lifecycle", kind: payload.kind, source: "core.run-repo" }).success).toBe(true);
    expect(RunEventSchema.safeParse({ ...base, category: "recovery", kind: payload.kind, source: "core.recovery-repo" }).success).toBe(true);
  });
});
