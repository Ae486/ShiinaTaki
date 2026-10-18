import { afterEach, describe, expect, it, vi } from "vitest";
import { MEMORY_TEMPLATE_METHODS, TIMING_POLICY_DEVELOPMENT_DEFAULTS, MemoryTemplateStatusSchema, MemoryTemplatePreviewSchema,
  MemoryTemplateDetailSchema, type MemoryTemplatePreviewParams } from "@taki/shared";
import { createWsClient } from "./ws-client.ts";
import { rpcMethodPolicy } from "./rpc-deadline.ts";
import { createTimingPolicyStore } from "./timing-policy.ts";

const close: Array<() => void> = [];
afterEach(() => { close.splice(0).forEach((dispose) => dispose()); vi.useRealTimers(); });
const previewId = "11111111-1111-4111-8111-111111111111";
const child = { planId: previewId, bankId: "owned-bank", childId: "22222222-2222-4222-8222-222222222222" };
const target = { provider_lineage: previewId, bank_generation: child.childId, bank_id: child.bankId };
const hash = "a".repeat(64);
const params: MemoryTemplatePreviewParams = { target: { kind: "defaults", globalTemplateRevision: "taki-bank-v2", characterTemplateRevision: "taki-bank-v2" },
  enrollment: "fresh", directives: [], refresh: [] };
const bank = { target, canonicalIdentity: "global", scope: "global", enrollment: "fresh", templateRevision: "taki-bank-v2", userRevision: 0,
  expectedSelectionRevision: 0, snapshotHash: hash, effectiveDefinitionHash: hash, configChanges: 0, modelChanges: 0, directiveChanges: 0, deletions: 0, refreshChildren: 0 };
const ready = MemoryTemplatePreviewSchema.parse({ state: "ready", previewId, previewHash: hash, expiresAt: "2099-01-01T00:00:00Z", banks: [bank], changesDefaults: true });
const detail = MemoryTemplateDetailSchema.parse({ previewId, previewHash: hash, bank, before: { contract_version: "1.0.0", target,
  selectors: { config_keys: [], model_ids: [], directives: [] }, config: [], models: [], directives: [], snapshot_hash: hash },
  changes: { config: [], models: [], directives: [] }, deletions: [], refresh: [] });
const status = MemoryTemplateStatusSchema.parse({ supported: false, previewAvailable: false, holdPlanId: null, boundSelectionIdentity: null,
  recoverPlanId: null, recoverUnavailableReason: "no_plan", defaults: null, catalogs: [], bank: null, plan: null });

function fixture() {
  const sent: Array<{ id: string | number; method: string; params: unknown }> = [];
  const handlers: Array<(value: string) => void> = [];
  const client = createWsClient({ transport: { send: (payload) => sent.push(JSON.parse(payload)), close: () => undefined,
    onMessage: (handler) => handlers.push(handler), onOpen: () => undefined, onClose: () => undefined },
  timingPolicy: createTimingPolicyStore({ ...TIMING_POLICY_DEVELOPMENT_DEFAULTS, interactiveRpcMs: 100, longRpcMs: 1000 }), onTimingPolicyDiagnostic: () => undefined });
  close.push(() => client.close());
  const reply = (result: unknown) => handlers.forEach((handler) => handler(JSON.stringify({ jsonrpc: "2.0", id: sent.at(-1)!.id, result })));
  return { client, sent, reply };
}

describe("template read adapter through the real WsClient boundary", () => {
  it("uses the released wire names and preserves complete Shared-validated responses", async () => {
    const f = fixture();
    const preview = f.client.hindsightTemplatePreview(params); f.reply(ready); expect(await preview).toEqual(ready);
    const details = f.client.hindsightTemplateDetail({ previewId, previewHash: hash, bankId: child.bankId }); f.reply(detail); expect(await details).toEqual(detail);
    const state = f.client.hindsightTemplateStatus({ bankId: child.bankId }); f.reply(status); expect(await state).toEqual(status);
    const derived = f.client.hindsightTemplateDerived(child); const unavailable = { ...child, state: "unavailable", reason: "not_observed", observedAt: null };
    f.reply(unavailable); expect(await derived).toEqual(unavailable);
    expect(f.sent.map((entry) => entry.method)).toEqual(Object.values(MEMORY_TEMPLATE_METHODS));
    expect(f.sent.map((entry) => entry.params)).toEqual([params, { previewId, previewHash: hash, bankId: child.bankId }, { bankId: child.bankId }, child]);
  });

  it("rejects extra fields on each read response and Native snapshots in outgoing intentions", async () => {
    const f = fixture();
    const cases = [
      { call: () => f.client.hindsightTemplatePreview(params), value: ready },
      { call: () => f.client.hindsightTemplateDetail({ previewId, previewHash: hash, bankId: child.bankId }), value: detail },
      { call: () => f.client.hindsightTemplateStatus({}), value: status },
      { call: () => f.client.hindsightTemplateDerived(child), value: { ...child, state: "unavailable", reason: "not_observed", observedAt: null } },
    ];
    for (const item of cases) { const result = item.call(); const rejected = expect(result).rejects.toThrow(); f.reply({ ...item.value, rawSecret: "SENTINEL" }); await rejected; }
    await expect(f.client.hindsightTemplatePreview(Object.assign({}, params, { expected_snapshot: {} }))).rejects.toThrow();
    await expect(f.client.hindsightTemplateDetail({ previewId: "invalid", previewHash: hash, bankId: child.bankId })).rejects.toThrow();
    await expect(f.client.hindsightTemplateDerived({ ...child, childId: "invalid" })).rejects.toThrow();
    expect(f.sent).toHaveLength(4);
  });

  it("rejects a current child result that names a different Bank or child", async () => {
    const f = fixture();
    for (const change of [{ child_id: previewId }, { target: { ...target, bank_id: "different-bank" } }]) {
      const pending = f.client.hindsightTemplateDerived(child); const rejected = expect(pending).rejects.toThrow();
      f.reply({ ...child, state: "observed", observedAt: "2026-10-09T00:00:00Z", result: { contract_version: "1.0.0", target,
        request_id: previewId, child_id: child.childId, model_id: "model", definition_hash: hash, state: "completed", result_revision: 2, result_payload_hash: hash, ...change } });
      await rejected;
    }
  });

  it("bounds Native reads separately from local reads and retains unknown submit ACK semantics without replay", async () => {
    vi.useFakeTimers(); const f = fixture();
    for (const method of [MEMORY_TEMPLATE_METHODS.preview, MEMORY_TEMPLATE_METHODS.derived]) expect(rpcMethodPolicy(method)).toMatchObject({ class: "long", timeoutOutcome: "read-only" });
    for (const method of [MEMORY_TEMPLATE_METHODS.status, MEMORY_TEMPLATE_METHODS.detail]) expect(rpcMethodPolicy(method)).toMatchObject({ class: "interactive", timeoutOutcome: "read-only" });
    const pending = f.client.hindsightTemplateDerived(child); const rejection = expect(pending).rejects.toMatchObject({ name: "RpcDeadlineExceededError", outcomeUnknown: false });
    await vi.advanceTimersByTimeAsync(1000); await rejection;
    const request = { kind: "template.apply" as const, requestId: previewId, previewId, previewHash: hash };
    expect(rpcMethodPolicy("memory.operations.submit", { request })).toMatchObject({ class: "interactive", timeoutOutcome: "unknown" });
    const submit = f.client.memoryOperationSubmit(request); const submitRejection = expect(submit).rejects.toMatchObject({ outcomeUnknown: true });
    await vi.advanceTimersByTimeAsync(100); await submitRejection; expect(f.sent).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5000); expect(f.sent).toHaveLength(2);
  });
});
