import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createConfigRepo } from "../../../db/config-repo.ts";
import { createMemoryOperationRepo } from "../../../db/memory-operation-repo.ts";
import { readTemplateHold, readTemplatePublication } from "./template-execution-reads.ts";
import { readTemplateDefaults } from "./template-default-store.ts";
import { readAppliedTemplateSelection } from "./template-overlay-store.ts";
import { templateLifecycleFixture, type TemplateLifecycleFixture } from "./template-lifecycle-fixtures.ts";
import { TEMPLATE_PREVIEW_TTL_MS } from "./template-preview-service.ts";
import { readTemplateExecutor, TEMPLATE_EXECUTOR_HEARTBEAT_MS } from "./template-executor-store.ts";

const fixtures: TemplateLifecycleFixture[] = [];
const fixture = (input?: Parameters<typeof templateLifecycleFixture>[0]) => {
  const value = templateLifecycleFixture(input); fixtures.push(value); return value;
};
afterEach(async () => { vi.restoreAllMocks(); for (const value of fixtures.splice(0)) await value.close(); });

describe("Core-owned genuine template lifecycle", () => {
  it("previews and details exact Native before-images without any SQLite or model write", async () => {
    const f = fixture();
    const before = f.db.prepare("SELECT total_changes() AS count").get();
    const request = await f.request();
    expect(request.kind).toBe("template.apply");
    if (request.kind !== "template.apply") throw new Error("expected apply");
    const detail = f.service.detail({ ...request, bankId: f.bindings[0].externalBankId });
    expect(detail.before.target.bank_id).toBe(f.bindings[0].externalBankId);
    expect(detail.changes.config.length).toBeGreaterThan(0);
    expect(f.db.prepare("SELECT total_changes() AS count").get()).toEqual(before);
    expect(f.native.calls.map((call) => call.method)).toEqual(["compatibility", "snapshot", "snapshot"]);
    expect(f.native.receipts.size).toBe(0);
  });

  it("captures preview identity before compatibility so configuration A-B-A cannot be admitted", async () => {
    const f = fixture();
    f.native.hooks.before = (call) => {
      if (call.method !== "compatibility") return;
      const config = createConfigRepo(f.db); config.upsert("TAKI_HINDSIGHT_ENABLED", false); config.upsert("TAKI_HINDSIGHT_ENABLED", true);
    };
    expect(await f.service.preview(f.params())).toMatchObject({ state: "refused", reason: "MEMORY_TEMPLATE_IDENTITY_CHANGED" });
    expect(f.native.calls.map((call) => call.method)).toEqual(["compatibility"]);
    expect(f.native.receipts.size).toBe(0);
  });

  it("cancels a stopped preview before a late snapshot can revisit SQLite or enter the cache", async () => {
    const f = fixture(); let enter!: () => void; let release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    f.native.hooks.before = async (call) => { if (call.method === "snapshot") { enter(); await released; } };
    const pending = f.service.preview(f.params()); await entered;
    f.service.stop(); const reads = vi.spyOn(f.db, "prepare");
    try {
      expect(await pending).toMatchObject({ state: "refused", reason: "MEMORY_TEMPLATE_NATIVE_REFUSED" });
      expect(await f.service.preview(f.params())).toMatchObject({ state: "refused", reason: "MEMORY_TEMPLATE_NATIVE_REFUSED" });
      expect(reads).not.toHaveBeenCalled();
    } finally { release(); }
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(reads).not.toHaveBeenCalled(); expect(f.native.receipts.size).toBe(0);
    expect(f.native.calls.map((call) => call.method)).toEqual(["compatibility", "snapshot"]);
  });

  it("keeps the admitted ACK window observable and cancels atomically before any dispatch", async () => {
    const f = fixture();
    const request = await f.request();
    const operation = f.owner.submit(request);
    const plan = f.plan(operation);
    expect(f.owner.status(operation.operationId)).toMatchObject({ state: "admitted", terminalAt: null });
    expect(f.service.observe(operation)).toBeNull();
    expect(f.owner.cancel(operation.operationId).state).toBe("cancelled");
    await f.owner.stop();
    expect(readTemplateHold(f.db, plan.planId)?.state).toBe("cancelled");
    expect(f.native.calls.some((call) => call.method === "apply")).toBe(false);
    expect(f.db.prepare("SELECT * FROM hindsight_template_bank_receipts").all()).toEqual([]);
  });

  it("settles ordinary stop and revokes renewal while a sent Apply ignores abort", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const f = fixture(); let enter!: () => void; let release!: () => void;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    f.native.hooks.before = async (call) => { if (call.method === "apply") { enter(); await released; } };
    try {
      const operation = f.owner.submit(await f.request()); await entered;
      const plan = f.plan(operation); const lease = readTemplateExecutor(f.db, plan.planId);
      f.state.now = new Date(Date.parse(f.state.now) + TEMPLATE_EXECUTOR_HEARTBEAT_MS).toISOString();
      vi.advanceTimersByTime(TEMPLATE_EXECUTOR_HEARTBEAT_MS);
      expect(readTemplateExecutor(f.db, plan.planId).deadlineMs).toBe(lease.deadlineMs + TEMPLATE_EXECUTOR_HEARTBEAT_MS);
      f.service.stop();
      let settled = false; const stop = f.owner.stop().then(() => { settled = true; });
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(true); expect(vi.getTimerCount()).toBe(0);
      const unknown = f.owner.status(operation.operationId);
      const executor = readTemplateExecutor(f.db, plan.planId);
      expect(unknown.state).toBe("outcome_unknown");
      expect(readTemplateHold(f.db, plan.planId)?.state).toBe("active");
      release(); await stop;
      await new Promise<void>((resolve) => setImmediate(resolve));
      vi.advanceTimersByTime(TEMPLATE_EXECUTOR_HEARTBEAT_MS * 2);
      expect(f.owner.status(operation.operationId)).toEqual(unknown);
      expect(readTemplateExecutor(f.db, plan.planId)).toEqual(executor);
      expect(readTemplatePublication(f.db, plan.planId)).toBeNull();
      expect(f.db.prepare("SELECT * FROM hindsight_template_bank_receipts").all()).toEqual([]);
      expect(f.native.receipts.size).toBe(1);
    } finally { release(); await f.owner.stop(); vi.useRealTimers(); }
  });

  it("publishes both Bank selections, defaults, admission and hold release before binding", async () => {
    const f = fixture();
    const operation = f.owner.submit(await f.request());
    await f.owner.stop();
    const result = f.owner.status(operation.operationId);
    expect(result).toMatchObject({ state: "completed", result: { kind: "template", outcome: "bound", appliedBanks: 2, totalBanks: 2 } });
    const plan = f.plan(operation);
    expect(readTemplateHold(f.db, plan.planId)?.state).toBe("published");
    const publication = readTemplatePublication(f.db, plan.planId)!;
    expect(f.state.bound).toBe(publication.selectionIdentity);
    for (const bank of plan.banks) expect(readAppliedTemplateSelection(f.db, bank.identity)?.request.request_id).toBe(bank.preview.request.request_id);
    expect(readTemplateDefaults(f.db, plan.guard.providerLineage)?.revision).toBe(1);
    expect(f.state.runtimeCalls).toEqual(["quiesce", ...plan.banks.map((bank) => `sync:${bank.identity.target.bank_id}`), "bind"]);
    expect(f.native.calls.filter((call) => call.method === "apply")).toHaveLength(2);
  });

  it("looks up an original admission before expiry or hold checks and never dispatches from replay/status", async () => {
    const f = fixture();
    const request = await f.request();
    const original = f.owner.submit(request);
    await f.owner.stop();
    const settled = f.owner.status(original.operationId);
    f.state.now = new Date(Date.parse(f.state.now) + TEMPLATE_PREVIEW_TTL_MS + 1).toISOString();
    const calls = structuredClone(f.native.calls);
    expect(f.owner.submit(request)).toEqual(settled);
    expect(f.owner.list({ includeTerminal: true, limit: 50 })).toContainEqual(settled);
    expect(f.native.calls).toEqual(calls);
    if (request.kind !== "template.apply") throw new Error("expected apply");
    expect(() => f.owner.submit({ ...request, previewHash: "f".repeat(64) })).toThrow("MEMORY_TEMPLATE_CONFLICT");
    expect(() => f.owner.submit({ ...request, requestId: randomUUID() })).toThrow("MEMORY_TEMPLATE_PREVIEW_EXPIRED");
  });

  it("records both default catalogs when no Character Bank exists yet", async () => {
    const f = fixture({ globalOnly: true });
    const operation = f.owner.submit(await f.request());
    await f.owner.stop();
    expect(f.owner.status(operation.operationId).state).toBe("completed");
    expect(f.db.prepare("SELECT scope_kind FROM hindsight_template_catalog ORDER BY scope_kind").all()).toEqual([{ scope_kind: "character" }, { scope_kind: "global" }]);
    const plan = f.plan(operation);
    expect(readTemplateDefaults(f.db, plan.guard.providerLineage)).toMatchObject({ revision: 1, banks: [{ identity: { scope: "global" } }] });
  });

  it("leaves durable hold and desired histories when publication cannot be completed", async () => {
    const f = fixture();
    f.native.hooks.before = (call) => { if (call.method === "apply") throw new Error("fixture send unknown"); };
    const operation = f.owner.submit(await f.request());
    await f.owner.stop();
    const plan = f.plan(operation);
    const result = f.owner.status(operation.operationId);
    expect(result).toMatchObject({ state: "outcome_unknown", result: { outcome: "outcome_unknown" } });
    expect(readTemplateHold(f.db, plan.planId)?.state).toBe("active");
    expect(readTemplatePublication(f.db, plan.planId)).toBeNull();
    expect(createMemoryOperationRepo(f.db).get(operation.operationId)).toEqual(result);
    const calls = f.native.calls.length;
    f.service.status({ planId: plan.planId });
    expect(f.native.calls).toHaveLength(calls);
    expect(() => f.owner.submit({ kind: "connection.revalidate", expectedEpochId: "epoch" })).toThrow("MEMORY_TEMPLATE_HOLD");
  });
});
