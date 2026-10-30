import { describe, expect, it } from "vitest";
import {
  MutationRequestSchema, MutationResultSchema, RecallPendingOverlayEntrySchema, RecallResultSchema,
  RetainRequestSchema, type RecallPendingOverlayEntry,
} from "./memory-provider-operation-schema.ts";
import { PendingMemoryOverlayEntrySchema } from "./pending-memory-schema.ts";
import type { CanonicalMemoryRecord } from "./memory-provider-domain-schema.ts";

const at = "2026-09-11T00:00:00.000Z";
const base = { confirmed: false as const, authorityEpochId: "epoch", bankId: "bank", operationId: "original-intent",
  originalAt: at, phase: "queued" as const };
const provenance = { actor: "user" as const, origin: "explicit-user" as const, characterId: null,
  timelineFromSeq: null, timelineToSeq: null, capturedAt: at, sanitized: true as const, sourceRef: "source:original" };
const policy = { layerId: "profile", importance: 5, visibility: "retrieved" as const, disclosure: null,
  origin: "self" as const, emotionalWeight: null, retention: { kind: "permanent" as const }, policyVersion: 1 };
const source = RetainRequestSchema.parse({ bankId: "bank", content: "An original source, not an extracted fact.", context: null,
  timestamp: "unset", tags: [], entities: [], metadata: { null: null, empty: [], object: {}, text: "{\"typed\":false}" },
  observationScopes: null, documentId: null, strategy: null, updateMode: "append", provenance, policy });
const mutation = MutationRequestSchema.parse({ kind: "edit", bankId: "bank", memoryId: "actual-memory", expectedRevision: 7,
  patch: { text: "An unconfirmed change.", context: null } });
const sourceOverlay: RecallPendingOverlayEntry = { ...base, operation: { kind: "retain", request: source, zeroResultAllowed: true } };
const mutationOverlay: RecallPendingOverlayEntry = { ...base, operation: { kind: "mutation", request: mutation } };
const emptyRecall = { hits: [], returned: 0, truncated: false, vectorState: "unavailable" as const, partial: false, branchFailures: [] };

function target(): CanonicalMemoryRecord {
  return { unit: { authorityEpochId: "epoch", bankId: "bank", memoryId: "actual-memory", documentId: "actual-source", chunkId: null,
    text: "A confirmed fact.", context: null, factType: "world", state: "valid", revision: 7, tags: ["taki-layer:profile"],
    metadata: {}, entities: [], sourceMemoryIds: [], observationScopes: null, eventDate: at, occurredStart: null, occurredEnd: null,
    mentionedAt: at, createdAt: at, updatedAt: at, editedAt: null, consolidatedAt: null, consolidationFailedAt: null,
    invalidationReason: null, invalidatedAt: null, proofCount: 1 },
  policy: { ...policy, authorityEpochId: "epoch", bankId: "bank", memoryId: "actual-memory", updatedAt: at }, provenance };
}

describe("truthful Pending consumer results", () => {
  it("round-trips historical recall and durable overlay bytes without adding defaults", () => {
    expect(JSON.stringify(RecallResultSchema.parse(emptyRecall))).toBe(JSON.stringify(emptyRecall));
    for (const entry of [sourceOverlay, mutationOverlay]) {
      expect(JSON.stringify(PendingMemoryOverlayEntrySchema.parse(entry))).toBe(JSON.stringify(entry));
      expect(JSON.stringify(RecallPendingOverlayEntrySchema.parse(entry))).toBe(JSON.stringify(entry));
    }
    expect(JSON.stringify(RetainRequestSchema.parse(source))).toBe(JSON.stringify(source));
    expect(JSON.stringify(MutationRequestSchema.parse(mutation))).toBe(JSON.stringify(mutation));
  });

  it("keeps original source content, policy, identity and typed metadata separate from Canonical hits", () => {
    const data = RecallResultSchema.parse({ ...emptyRecall, pending: [sourceOverlay] });
    expect(data.returned).toBe(0);
    expect(data.pending).toEqual([sourceOverlay]);
    expect(data.pending?.[0]).not.toHaveProperty("record");
    expect(data.pending?.[0]).not.toHaveProperty("revision");
    expect(data.pending?.[0]).not.toHaveProperty("memoryId");
    expect(RecallResultSchema.safeParse({ ...data, returned: 1 }).success).toBe(false);
  });

  it("represents a queued mutation without claiming an applied record or losing omission/null semantics", () => {
    const value = { outcome: "pending", record: null, pending: mutationOverlay };
    expect(MutationResultSchema.parse(value)).toEqual(value);
    expect(MutationResultSchema.safeParse({ ...value, record: target() }).success).toBe(false);
    expect(MutationResultSchema.safeParse({ ...value, outcome: "applied" }).success).toBe(false);
    expect(MutationResultSchema.safeParse({ ...value, pending: sourceOverlay }).success).toBe(false);
    expect(mutationOverlay.operation.request).not.toHaveProperty("occurredStart");
  });

  it("accepts exact target evidence only as a consumer attachment, never as durable intent", () => {
    const entry = { ...mutationOverlay, targetRecord: target() };
    expect(RecallPendingOverlayEntrySchema.parse(entry)).toEqual(entry);
    expect(MutationResultSchema.safeParse({ outcome: "pending", record: null, pending: entry }).success).toBe(true);
    expect(PendingMemoryOverlayEntrySchema.safeParse(entry).success).toBe(false);
    expect(RecallPendingOverlayEntrySchema.safeParse({ ...sourceOverlay, targetRecord: target() }).success).toBe(false);
  });

  it.each(["authorityEpochId", "bankId", "memoryId", "revision"] as const)("rejects mismatched target %s", (key) => {
    const record = target();
    if (key === "revision") record.unit.revision += 1;
    else { record.unit[key] = "other"; record.policy[key] = "other"; }
    expect(RecallPendingOverlayEntrySchema.safeParse({ ...mutationOverlay, targetRecord: record }).success).toBe(false);
  });

  it.each(["queued", "submitted", "awaiting_derived", "awaiting_pull", "outcome_unknown"])("preserves %s as unconfirmed", (phase) => {
    expect(RecallResultSchema.parse({ ...emptyRecall, pending: [{ ...sourceOverlay, phase }] }).pending?.[0]?.confirmed).toBe(false);
  });

  it.each(["completed", "superseded", "cancelled", "failed"])("does not expose %s audit rows as operational overlays", (phase) => {
    expect(RecallResultSchema.safeParse({ ...emptyRecall, pending: [{ ...sourceOverlay, phase }] }).success).toBe(false);
    expect(MutationResultSchema.safeParse({ outcome: "pending", record: null, pending: { ...mutationOverlay, phase } }).success).toBe(false);
  });

  it("rejects wrong Bank, confirmed status, fabricated fields and missing target revision", () => {
    for (const change of [{ bankId: "other" }, { confirmed: true }, { revision: 1 }, { record: target() }]) {
      expect(RecallPendingOverlayEntrySchema.safeParse({ ...sourceOverlay, ...change }).success).toBe(false);
    }
    expect(RecallPendingOverlayEntrySchema.safeParse({ ...mutationOverlay, operation: { kind: "mutation",
      request: { kind: "restore", bankId: "bank", memoryId: "actual-memory" } } }).success).toBe(false);
  });

  it("shares the bounded result count while preserving a full supported source before consumer budgeting", () => {
    const large = { ...sourceOverlay, operation: { kind: "retain", zeroResultAllowed: true,
      request: { ...source, content: "界".repeat(100_000) } } };
    expect(RecallPendingOverlayEntrySchema.safeParse(large).success).toBe(true);
    const pending = Array.from({ length: 100 }, (_, index) => ({ ...sourceOverlay, operationId: `intent-${index}` }));
    expect(RecallResultSchema.safeParse({ ...emptyRecall, pending }).success).toBe(true);
    const hit = { record: target(), scores: [], confirmed: true };
    expect(RecallResultSchema.safeParse({ ...emptyRecall, hits: [hit], returned: 1, pending }).success).toBe(false);
  });
});
