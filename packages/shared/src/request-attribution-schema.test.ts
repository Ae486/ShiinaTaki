import { describe, expect, it } from "vitest";
import { CONTEXT_CATEGORIES, CONTEXT_CONTENT_ORIGINS, ContextWindowSnapshotSchema,
  ContextRequestMeasuredEventSchema, LatestPrimaryRequestSnapshotSchema, RequestCompositionSchema, type RequestComposition } from "./request-attribution-schema.ts";
import { RunEventSchema, RunEventV1Schema } from "./run-event-schema.ts";
import { TimelinePartSchema } from "./timeline-schema.ts";

function composition(): RequestComposition {
  const categories = Object.fromEntries(CONTEXT_CATEGORIES.map((category) => [category, 1]));
  const origins = Object.fromEntries(CONTEXT_CATEGORIES.map((category) => [category,
    Object.fromEntries(CONTEXT_CONTENT_ORIGINS.map((origin) => [origin, origin === "builtin" ? 1 : 0]))]));
  return RequestCompositionSchema.parse({ estimator: "heuristic-v1", totalUnits: 9, categories, origins,
    coverage: { status: "complete", unestimatedParts: 0, unknownOriginUnits: 0, hasHeuristicMedia: false } });
}
const at = "2026-11-02T12:00:00.000Z";
function event() {
  return { eventId: "e", runId: "r", attemptId: "a", seq: 1, schemaVersion: "context-request.v1",
    category: "context", kind: "context.request.measured", occurredAt: at, source: "core.context-observer",
    payload: { kind: "context.request.measured", state: "captured", effectId: "m", provider: "p", modelId: "model",
      population: "primary", primaryInputSeq: 1, stepNumber: 0, dispatchedAt: at, composition: composition() } };
}
describe("request attribution contracts", () => {
  it("conserves all nine categories and origins while allowing known framing in other", () => {
    expect(RequestCompositionSchema.parse(composition()).coverage.status).toBe("complete");
    const wrong = composition(); wrong.categories.instructions++;
    expect(RequestCompositionSchema.safeParse(wrong).success).toBe(false);
    const originWrong = composition(); originWrong.origins.persona.mcp++;
    expect(RequestCompositionSchema.safeParse(originWrong).success).toBe(false);
  });
  it("requires honest unknown coverage without classifying heuristic images as exact tokens", () => {
    const value = composition(); value.origins.conversation.builtin = 0; value.origins.conversation.unknown = 1;
    expect(RequestCompositionSchema.safeParse(value).success).toBe(false);
    value.coverage.status = "partial"; value.coverage.unknownOriginUnits = 1; value.coverage.hasHeuristicMedia = true;
    expect(RequestCompositionSchema.safeParse(value).success).toBe(true);
    value.coverage.status = "complete";
    expect(RequestCompositionSchema.safeParse(value).success).toBe(false);
  });
  it("keeps a separate version and rejects raw request fields, absent primary order and unbounded counts", () => {
    expect(RunEventSchema.safeParse(event()).success).toBe(true);
    expect(RunEventV1Schema.safeParse({ ...event(), schemaVersion: "run-event.v1" }).success).toBe(false);
    const value = event();
    expect(ContextRequestMeasuredEventSchema.safeParse({ ...value, payload: { ...value.payload, prompt: "private" } }).success).toBe(false);
    expect(ContextRequestMeasuredEventSchema.safeParse({ ...value, payload: { ...value.payload, primaryInputSeq: undefined } }).success).toBe(false);
    expect(RequestCompositionSchema.safeParse({ ...composition(), totalUnits: Number.MAX_SAFE_INTEGER }).success).toBe(false);
  });
  it("preserves strict old admission snapshot semantics", () => {
    const old = { ...event(), schemaVersion: "run-event.v1", kind: "context.snapshot",
      payload: { kind: "context.snapshot", state: "captured", sourceCategories: ["summary"], accountingQuality: "estimated", inputTokens: 10 } };
    expect(RunEventSchema.safeParse(old).success).toBe(true);
    expect(RunEventSchema.safeParse({ ...old, payload: { ...old.payload, effectId: "m" } }).success).toBe(false);
  });
  it("retains machine-only supplier for new tool parts and leaves old parts unchanged", () => {
    const legacy = { type: "tool-call", toolCallId: "c", toolName: "extension_call" };
    expect(TimelinePartSchema.parse(legacy)).toEqual(legacy);
    expect(TimelinePartSchema.parse({ ...legacy, contextOrigin: "builtin" })).toHaveProperty("contextOrigin", "builtin");
    expect(TimelinePartSchema.safeParse({ ...legacy, contextOrigin: "tool-name-guess" }).success).toBe(false);
  });
  it("does not confuse effective tokens with estimator units", () => {
    const window = { declaredRealTokens: 100_000, effectiveRealTokens: 80_000, estimatorWindowUnits: 40_000, factor: 2 };
    expect(ContextWindowSnapshotSchema.parse(window)).toEqual(window);
    expect(ContextWindowSnapshotSchema.safeParse({ ...window, effectiveRealTokens: 100_001 }).success).toBe(false);
  });
  it("preserves old latest-request snapshots and accepts a separately bounded response model name", () => {
    const request = { runId: "r", effectId: "e", primaryInputSeq: 1, stepNumber: 0, provider: "p", modelId: "requested-model",
      dispatchedAt: at, completedAt: at, outcome: "completed", inputTokens: 10,
      window: { declaredRealTokens: 100, effectiveRealTokens: 80, estimatorWindowUnits: 40, factor: 2 }, composition: composition() };
    const snapshot = { scope: "latest-primary-request", characterId: "taki", computedAt: at, status: "ready", reason: null, request };
    expect(LatestPrimaryRequestSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    const renamed = { ...snapshot, request: { ...request, responseModelId: "served-model" } };
    expect(LatestPrimaryRequestSnapshotSchema.parse(renamed).request).toMatchObject({ modelId: "requested-model", responseModelId: "served-model" });
    for (const responseModelId of ["", "x".repeat(201), null]) {
      expect(LatestPrimaryRequestSnapshotSchema.safeParse({ ...snapshot, request: { ...request, responseModelId } }).success).toBe(false);
    }
  });
});
