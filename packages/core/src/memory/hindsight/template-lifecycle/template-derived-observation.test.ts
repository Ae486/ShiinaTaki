import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { HindsightTemplateRefreshResultSchema, JsonRpcSuccessResponseSchema, MEMORY_TEMPLATE_METHODS,
  MemoryTemplateDerivedObservationSchema, type MemoryTemplateDerivedParams } from "@taki/shared";
import { createConfigRepo } from "../../../db/config-repo.ts";
import { createHindsightBankSetupRepo } from "../../../db/hindsight-bank-setup-repo.ts";
import { createMethodRegistry } from "../../../server/method-registry.ts";
import { registerHindsightTemplateMethods } from "../../../server/methods/hindsight-template-methods.ts";
import { failingGenerateModel } from "../../../testing/mock-language-model.ts";
import { HindsightTemplateRefusal } from "../hindsight-template-client.ts";
import { loadManagedTemplate, TAKI_MANAGED_TEMPLATE_REVISION } from "./template-catalog.ts";
import { readTemplateExecutor } from "./template-executor-store.ts";
import { templateLifecycleFixture, type TemplateLifecycleFixture } from "./template-lifecycle-fixtures.ts";

type NativeResult = z.infer<typeof HindsightTemplateRefreshResultSchema>;
const fixtures: TemplateLifecycleFixture[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const f of fixtures.splice(0)) await f.close(); });

async function fixture(execute = true) {
  const model = failingGenerateModel(new Error("derived observation cannot generate"));
  const f = templateLifecycleFixture({ model }); fixtures.push(f);
  const bankId = f.bindings[1].externalBankId;
  const params = f.params();
  params.refresh = [{ bankId, modelIds: [loadManagedTemplate(TAKI_MANAGED_TEMPLATE_REVISION, "character").models[0]!.id] }];
  const request = await f.request(params);
  const operation = execute ? f.owner.submit(request) : f.admit(request);
  if (execute) { await f.owner.stop(); expect(f.owner.status(operation.operationId).state).toBe("completed"); }
  const plan = f.plan(operation);
  const bank = plan.banks.find((entry) => entry.identity.target.bank_id === bankId)!;
  const input: MemoryTemplateDerivedParams = { planId: plan.planId, bankId, childId: bank.preview.request.refresh[0]!.child_id };
  const state: { result: NativeResult["state"]; beforeRead?: () => Promise<void> | void;
    transform?: (value: NativeResult) => NativeResult; error?: Error } = { result: "pending" };
  const original = f.native.client.templateRefreshResult!;
  f.native.client.templateRefreshResult = async (call) => {
    const result = await original(call); await state.beforeRead?.();
    if (state.error) throw state.error;
    const value = { ...result, state: state.result, result_revision: state.result === "completed" ? 2 : null,
      result_payload_hash: state.result === "completed" ? "a".repeat(64) : null };
    return state.transform ? state.transform(value) : value;
  };
  const registry = createMethodRegistry({ logger: f.base.logger }); registerHindsightTemplateMethods(registry, f.service);
  const observe = async () => {
    const frame = await registry.dispatch({ jsonrpc: "2.0", id: randomUUID(), method: MEMORY_TEMPLATE_METHODS.derived, params: input }, {
      connection: { state: { status: "authenticated", deviceId: "derived-operator", role: "operator", capabilities: [] } },
      notify: () => undefined, close: () => undefined, onClose: () => undefined,
    });
    return MemoryTemplateDerivedObservationSchema.parse(JsonRpcSuccessResponseSchema.parse(frame).result);
  };
  return { f, model, plan, input, operation, state, observe };
}
function changes(f: TemplateLifecycleFixture) { return f.db.prepare("SELECT total_changes() AS count").get()?.count; }

describe("explicit single-child Native observation", () => {
  it("observes pending, completed and failed through real dispatch while preserving the timestamped rollout record", async () => {
    const h = await fixture(); const { f, input, state, observe, model } = h;
    const recordedAt = f.state.now;
    const recorded = f.service.status({ planId: input.planId }).plan!.banks.flatMap((bank) => bank.derived);
    expect(recorded).toEqual([{ childId: input.childId, modelId: h.plan.banks.find((bank) => bank.identity.scope === "character")!.preview.request.refresh[0]!.model_id,
      state: "pending", source: "rollout_record", observedAt: recordedAt }]);
    const before = changes(f); const executor = readTemplateExecutor(f.db, input.planId);
    const operation = f.owner.status(h.operation.operationId); const calls = f.native.calls.length;
    const runtimeCalls = structuredClone(f.base.remote.calls);
    for (const [index, result] of (["pending", "completed", "failed"] as const).entries()) {
      state.result = result; f.state.now = new Date(Date.parse(recordedAt) + (index + 1) * 1000).toISOString();
      expect(await observe()).toMatchObject({ ...input, state: "observed", observedAt: f.state.now, result: { state: result } });
    }
    expect(f.service.status({ planId: input.planId }).plan!.banks.flatMap((bank) => bank.derived)).toEqual(recorded);
    expect(changes(f)).toBe(before); expect(readTemplateExecutor(f.db, input.planId)).toEqual(executor);
    expect(f.owner.status(h.operation.operationId)).toEqual(operation);
    expect(f.native.calls.slice(calls).map((call) => call.method)).toEqual(["compatibility", "refresh", "compatibility", "refresh", "compatibility", "refresh"]);
    expect(f.native.calls.slice(calls).filter((call) => call.method === "refresh").every((call) => call.bankId === input.bankId)).toBe(true);
    expect(f.base.remote.calls).toEqual(runtimeCalls); expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("returns not_observed without looking up or resuming a child whose original receipt is not recorded", async () => {
    const h = await fixture(false); const before = changes(h.f); const calls = structuredClone(h.f.native.calls);
    expect(await h.observe()).toMatchObject({ state: "unavailable", reason: "not_observed", observedAt: null });
    expect(changes(h.f)).toBe(before); expect(h.f.native.calls).toEqual(calls);
    expect(h.f.owner.status(h.operation.operationId).state).toBe("admitted");
  });

  it("never substitutes cached pending for a failed current read", async () => {
    const h = await fixture(); expect(await h.observe()).toMatchObject({ state: "observed", result: { state: "pending" } });
    const before = changes(h.f);
    h.state.error = new Error("HINDSIGHT_TIMEOUT");
    expect(await h.observe()).toEqual({ ...h.input, state: "unavailable", reason: "request_failed", observedAt: null });
    expect(changes(h.f)).toBe(before);
  });

  it("reports a disabled connection and unsupported capability without child dispatch", async () => {
    const h = await fixture(); const config = createConfigRepo(h.f.db);
    config.upsert("TAKI_HINDSIGHT_ENABLED", false);
    const calls = h.f.native.calls.length;
    expect(await h.observe()).toMatchObject({ state: "unavailable", reason: "connection_unavailable", observedAt: null });
    expect(h.f.native.calls).toHaveLength(calls);
    config.upsert("TAKI_HINDSIGHT_ENABLED", true);
    delete h.f.native.manifest.contracts.template_lifecycle;
    expect(await h.observe()).toMatchObject({ state: "unavailable", reason: "unsupported", observedAt: null });
    expect(h.f.native.calls.slice(calls).map((call) => call.method)).toEqual(["compatibility"]);
  });

  it.each(["configuration", "secret", "bank"] as const)("rejects a %s identity change while the read is in flight", async (kind) => {
    const h = await fixture();
    h.state.beforeRead = () => {
      if (kind === "configuration") {
        const config = createConfigRepo(h.f.db); config.upsert("TAKI_HINDSIGHT_ENABLED", false); config.upsert("TAKI_HINDSIGHT_ENABLED", true);
      } else if (kind === "secret") h.f.base.secrets.state.version++;
      else {
        const repo = createHindsightBankSetupRepo(h.f.db); const row = repo.get("character:taki")!;
        repo.upsert({ ...row, templateDigest: "d".repeat(64) });
      }
    };
    expect(await h.observe()).toEqual({ ...h.input, state: "stale", reason: "identity_changed", observedAt: null });
  });

  it("rejects configuration A-B-A during compatibility before dispatching the child read", async () => {
    const h = await fixture(); const calls = h.f.native.calls.length;
    h.f.native.hooks.before = (call) => {
      if (call.method !== "compatibility") return;
      const config = createConfigRepo(h.f.db); config.upsert("TAKI_HINDSIGHT_ENABLED", false); config.upsert("TAKI_HINDSIGHT_ENABLED", true);
    };
    expect(await h.observe()).toEqual({ ...h.input, state: "stale", reason: "identity_changed", observedAt: null });
    expect(h.f.native.calls.slice(calls).map((call) => call.method)).toEqual(["compatibility"]);
  });

  it.each(["target", "request", "child", "model", "definition"] as const)("refuses a wrong %s response identity", async (field) => {
    const h = await fixture(); const before = changes(h.f);
    h.state.transform = (value) => ({ ...value,
      ...field === "target" ? { target: { ...value.target, bank_generation: randomUUID() } } : {},
      ...field === "request" ? { request_id: randomUUID() } : {},
      ...field === "child" ? { child_id: randomUUID() } : {},
      ...field === "model" ? { model_id: "other-model" } : {},
      ...field === "definition" ? { definition_hash: "f".repeat(64) } : {},
    });
    expect(await h.observe()).toEqual({ ...h.input, state: "unavailable", reason: "invalid_evidence", observedAt: null });
    expect(changes(h.f)).toBe(before);
  });

  it("marks Native incarnation loss stale without recovering or retrying", async () => {
    const h = await fixture(); h.state.error = new HindsightTemplateRefusal("generation_mismatch");
    const before = changes(h.f); const calls = h.f.native.calls.length;
    expect(await h.observe()).toEqual({ ...h.input, state: "stale", reason: "identity_changed", observedAt: null });
    expect(changes(h.f)).toBe(before);
    expect(h.f.native.calls.slice(calls).map((call) => call.method)).toEqual(["compatibility", "refresh"]);
  });

  it("bounds an ignored transport abort and never publishes a late successful answer", async () => {
    const h = await fixture(); const deadline = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    let enter!: () => void; let release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    h.state.beforeRead = async () => { enter(); await released; };
    const before = changes(h.f); const pending = h.observe();
    await entered; deadline.abort();
    expect(await pending).toEqual({ ...h.input, state: "unavailable", reason: "request_failed", observedAt: null });
    release(); await new Promise<void>((resolve) => setImmediate(resolve));
    expect(changes(h.f)).toBe(before);
  });

  it("settles an in-flight read on lifecycle stop and denies late or new database access", async () => {
    const h = await fixture();
    let enter!: () => void; let release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    h.state.beforeRead = async () => { enter(); await released; };
    const pending = h.observe(); await entered;
    h.f.service.stop(); const reads = vi.spyOn(h.f.db, "prepare");
    try {
      expect(await pending).toEqual({ ...h.input, state: "unavailable", reason: "request_failed", observedAt: null });
      expect(await h.observe()).toEqual({ ...h.input, state: "unavailable", reason: "request_failed", observedAt: null });
      expect(reads).not.toHaveBeenCalled();
    } finally { release(); }
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(reads).not.toHaveBeenCalled();
  });
});
