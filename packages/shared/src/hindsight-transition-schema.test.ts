import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HindsightTransitionAcquireSchema, HindsightTransitionOutcomeRequestSchema } from "./hindsight-transition-schema.ts";
import { HindsightTransitionDeltaRequestSchema } from "./hindsight-transition-delta-schema.ts";

const hash = "a".repeat(64);
function identity() { return { transition_id: randomUUID(), attempt_id: randomUUID(), generation: 1, fence_token: randomUUID() }; }
function acquire() { return { transition_id: randomUUID(), attempt_id: randomUUID(), provider_lineage: randomUUID(),
  bank_generation: randomUUID(), direction: "reenter-hindsight" as const, request_hash: hash }; }

describe("independent native transition schema", () => {
  it("requires one real baseline kind and forbids a fabricated return baseline", () => {
    const value = acquire();
    expect(HindsightTransitionAcquireSchema.safeParse(value).success).toBe(false);
    expect(HindsightTransitionAcquireSchema.safeParse({ ...value, baseline_transition_id: randomUUID(), baseline_proof_hash: hash }).success).toBe(true);
    expect(HindsightTransitionAcquireSchema.safeParse({ ...value, direction: "return-local", baseline_transition_id: randomUUID(), baseline_proof_hash: hash }).success).toBe(false);
    expect(HindsightTransitionAcquireSchema.safeParse({ ...value, baseline_transition_id: randomUUID(), baseline_proof_hash: hash,
      unused_scope: { kind: "unused-scope", bank_id: "bank", provider_lineage: value.provider_lineage, bank_generation: value.bank_generation,
        creation_id: randomUUID(), native_cursor: 1, template_hash: hash, history_hash: hash, baseline_hash: hash, proof_hash: hash } }).success).toBe(false);
  });
  it("never calls a committed authority decision an abort", () => {
    expect(HindsightTransitionOutcomeRequestSchema.safeParse({ executor: identity(), disposition: "abort", decision_id: randomUUID(),
      decision_hash: hash, core_receipt_id: hash, proof_hash: hash }).success).toBe(false);
  });
  it("retains current Local config metadata including prototype-shaped keys", () => {
    const source = { source_kind: "bank", source_id: "local", source_revision: 2, source_payload_hash: hash };
    const metadata = JSON.parse('{"empty":"","null":null,"__proto__":{"constructor":[null,true,1,"1"]}}');
    const parsed = HindsightTransitionDeltaRequestSchema.parse({ executor: identity(), operation_id: randomUUID(), request_hash: hash,
      baseline_transition_id: randomUUID(), baseline_proof_hash: hash, local_manifest_hash: hash,
      native: [{ source, target: { object_kind: "bank", object_id: "native", object_revision: 1, payload_hash: hash },
        disposition: "upsert", body_hash: hash }], chunks: [], application: [],
      rows: { bank: { source, payload: { bank_id: "native", name: "Current Local bank", mission: "", config: metadata,
        disposition: { skepticism: 3, literalism: 3, empathy: 3 }, created_at: "2026-09-30T01:00:00Z", updated_at: "2026-09-30T01:00:00Z" } } } });
    expect(parsed.rows.bank?.payload.config).toEqual(metadata);
    expect(Object.hasOwn(parsed.rows.bank!.payload.config, "__proto__")).toBe(true);
    expect(parsed.rows.documents).toEqual([]);
  });
});
