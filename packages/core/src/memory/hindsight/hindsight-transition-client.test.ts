import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { HindsightTransitionAcquireSchema, HindsightTransitionStatusSchema, type HindsightTransitionOutcomeRequest } from "@taki/shared";
import { createHindsightClient, type HindsightTransport } from "./hindsight-client.ts";
import { requireHindsightTransitionClient } from "./hindsight-transition-capability.ts";
import { hindsightTransitionHash, signHindsightTransitionAcquire } from "./hindsight-transition-proof.ts";

const bankId = "owned-bank"; const context = { timeoutMs: 1000 };
function fixture() {
  const request = signHindsightTransitionAcquire(bankId, HindsightTransitionAcquireSchema.parse({
    transition_id: randomUUID(), attempt_id: randomUUID(), provider_lineage: randomUUID(), bank_generation: randomUUID(),
    direction: "return-local", request_hash: "0".repeat(64),
  }));
  const status = HindsightTransitionStatusSchema.parse({ bank_id: bankId, request,
    executor: { transition_id: request.transition_id, attempt_id: request.attempt_id, generation: 1, fence_token: randomUUID() },
    revision: 1, phase: "draining", lease_expires_at: "2026-09-30T12:00:00+00:00", executor_live: true,
    active_writers: 0, accepted_operations: 0, proof: null, outcome: null });
  return { request, status };
}
function client(transport: HindsightTransport) {
  return requireHindsightTransitionClient(createHindsightClient({ endpoint: "http://127.0.0.1:8888", resolveApiKey: () => "owned-key", transport }));
}

describe("native transition client", () => {
  it("sends the exact authenticated request and recovers status without redispatch", async () => {
    const value = fixture(); const transport = vi.fn<HindsightTransport>().mockResolvedValue({ status: 200, body: JSON.stringify(value.status) });
    const native = client(transport);
    expect(await native.acquireTransition({ bankId, request: value.request, context })).toEqual(value.status);
    expect(transport.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: "Bearer owned-key" });
    expect(JSON.parse(String(transport.mock.calls[0]?.[1]?.body))).toEqual(value.request);
    expect(await native.transitionStatus({ bankId, transitionId: value.request.transition_id, context })).toEqual(value.status);
    expect(transport.mock.calls[1]?.[1]?.method).toBeUndefined();
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("refuses altered input before dispatch and foreign response identity after dispatch", async () => {
    const value = fixture(); const transport = vi.fn<HindsightTransport>().mockResolvedValue({ status: 200, body: JSON.stringify({ ...value.status, bank_id: "foreign" }) });
    const native = client(transport);
    expect(() => native.acquireTransition({ bankId, request: { ...value.request, request_hash: "f".repeat(64) }, context })).toThrow("HINDSIGHT_RESPONSE_INVALID");
    expect(transport).not.toHaveBeenCalled();
    await expect(native.acquireTransition({ bankId, request: value.request, context })).rejects.toThrow("HINDSIGHT_RESPONSE_INVALID");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("preserves a closed refusal without retrying a new operation", async () => {
    const value = fixture(); const transport = vi.fn<HindsightTransport>().mockResolvedValue({ status: 409,
      body: JSON.stringify({ error: "taki_transition_refused", reason: "accepted_work_unresolved" }) });
    await expect(client(transport).fenceTransition({ bankId, request: value.status.executor, context })).rejects.toThrow("HINDSIGHT_TRANSITION_ACCEPTED_WORK_UNRESOLVED");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each(["attempt", "revision", "generation"])("rejects a claim response with a different %s", async (field) => {
    const value = fixture(); const attempt = randomUUID();
    value.status.executor = { ...value.status.executor, attempt_id: attempt, generation: 2 };
    value.status.revision = 2;
    if (field === "attempt") value.status.executor.attempt_id = randomUUID();
    if (field === "revision") value.status.revision = 3;
    if (field === "generation") value.status.executor.generation = 1;
    const transport = vi.fn<HindsightTransport>().mockResolvedValue({ status: 200, body: JSON.stringify(value.status) });
    await expect(client(transport).claimTransition({ bankId, transitionId: value.request.transition_id,
      request: { attempt_id: attempt, expected_revision: 1 }, context })).rejects.toThrow("HINDSIGHT_RESPONSE_INVALID");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("binds resolution to the submitted decision even when a different outcome has a valid hash", async () => {
    const value = fixture();
    const request: HindsightTransitionOutcomeRequest = { executor: value.status.executor, disposition: "abort",
      decision_id: randomUUID(), decision_hash: "a".repeat(64), core_receipt_id: null, proof_hash: null };
    const body = { request: { ...request, decision_id: randomUUID() }, bank_id: bankId,
      provider_lineage: value.request.provider_lineage, bank_generation: value.request.bank_generation,
      phase: "aborted" as const, resolution: "source_resumed" as const, restored_baseline_hash: null,
      recorded_at: "2026-09-30T12:00:00+00:00" };
    value.status.phase = "aborted"; value.status.executor_live = false;
    value.status.outcome = { ...body, outcome_hash: hindsightTransitionHash(body) };
    const transport = vi.fn<HindsightTransport>().mockResolvedValue({ status: 200, body: JSON.stringify(value.status) });
    await expect(client(transport).resolveTransition({ bankId, request, context })).rejects.toThrow("HINDSIGHT_RESPONSE_INVALID");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each(["taki_transition_fenced", "taki_transition_writer_stale"])("never interprets ordinary native %s as a cursor reset", async (reason) => {
    const native = client(async () => ({ status: 409, body: JSON.stringify({ detail: reason }) }));
    const code = reason.endsWith("writer_stale") ? "HINDSIGHT_TRANSITION_EXECUTOR_LOST" : "HINDSIGHT_TRANSITION_FENCED";
    await expect(native.changesAfter!({ bankId, afterCursor: 0, limit: 10, context })).rejects.toThrow(code);
    await expect(native.createLogicalSnapshot!({ bankId, pageSize: 1, ttlSeconds: 60, context })).rejects.toThrow(code);
  });
  it("recognizes fenced D77 responses before its own response schema and preserves old unknown reset behavior", async () => {
    const native = client(async () => ({ status: 409, body: JSON.stringify({ error: "taki_transition_refused", reason: "bank_fenced" }) }));
    await expect(native.initializeApplication!({ bankId, namespace: { application_id: "taki", provider_lineage: randomUUID(), bank_generation: randomUUID() }, context })).rejects.toThrow("HINDSIGHT_TRANSITION_FENCED");
    const legacy = client(async () => ({ status: 409, body: "{}" }));
    await expect(legacy.changesAfter!({ bankId, afterCursor: 0, limit: 10, context })).rejects.toThrow("HINDSIGHT_CURSOR_RESET_REQUIRED");
  });
});
