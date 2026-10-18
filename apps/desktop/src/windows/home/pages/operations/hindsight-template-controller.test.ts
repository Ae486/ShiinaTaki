import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemoryTemplatePreview, MemoryTemplateDetail, MemoryTemplateDerivedObservation } from "@taki/shared";
import { createWsClient } from "@/lib/ws-client.js";
import { createBrowserTransport } from "@/lib/ws-transport.js";
import { createTimingPolicyStore } from "@/lib/timing-policy.js";
import { TIMING_POLICY_DEVELOPMENT_DEFAULTS } from "@taki/shared";
import { templateHomeFixture } from "./hindsight-template-test-fixture.ts";
import { INITIAL_TEMPLATES, TemplatesController, type TemplatesState } from "./hindsight-template-controller.ts";
import { EMPTY_TEMPLATE_CHOICES } from "./hindsight-template-state.ts";
import { createConfigRepo } from "../../../../../../../packages/core/src/db/config-repo.ts";

const close: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const dispose of close.splice(0).reverse()) await dispose(); vi.restoreAllMocks(); });
const ACK = { deletion: true, provider: true, enrollment: true };
async function until(predicate: () => boolean) {
  const end = Date.now() + 8000;
  while (!predicate()) { if (Date.now() > end) throw new Error("owned fixture condition timed out"); await new Promise((resolve) => setTimeout(resolve, 10)); }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { resolve, promise }; }
async function fixture() {
  const h = await templateHomeFixture(); close.push(() => h.close());
  const open = async () => {
    const client = createWsClient({ transport: createBrowserTransport(h.url), timingPolicy: createTimingPolicyStore({ ...TIMING_POLICY_DEVELOPMENT_DEFAULTS, interactiveRpcMs: 700 }), onTimingPolicyDiagnostic: () => undefined });
    const result = await client.connect({ role: "operator", deviceId: crypto.randomUUID(), deviceName: "owned template Home", capabilities: [] });
    if (!result.ok) throw new Error("fixture auth refused"); close.push(() => client.close()); return client;
  };
  const client = await open(); let state: TemplatesState = INITIAL_TEMPLATES;
  const controller = new TemplatesController((value) => { state = value; }); close.push(() => controller.dispose());
  controller.replace(client); await until(() => !state.loading);
  expect(state.error).toBeNull();
  // A generic refresh coalesces into an existing push read and can return before that read settles.
  const settle = async () => { await h.owner.stop(); await controller.refresh(); await until(() => !state.loading); expect(state.error).toBeNull(); };
  return { h, open, client, controller, settle, state: () => state };
}

describe("Home templates through actual authenticated WsClient/Core operations", () => {
  it("retires consent after observing a same-connection configuration change without losing the draft", async () => {
    const t = await fixture();
    const draft = { ...t.state().draft!, enrollment: "reviewed-existing" as const };
    t.controller.edit(draft); await t.controller.preview();
    expect(t.state().preview?.state).toBe("ready");
    const config = createConfigRepo(t.h.f.db);
    config.upsert("TAKI_HINDSIGHT_ENABLED", false);
    await t.controller.refresh(); await until(() => !t.state().loading);
    expect(t.state().frame?.authority.hindsight?.connection.config).toBe("disabled");
    expect(t.state().preview).toBeNull();
    expect(t.state().draft).toEqual(draft); expect(t.state().draftStale).toBe(true);
    config.upsert("TAKI_HINDSIGHT_ENABLED", true);
    await t.controller.refresh(); await until(() => !t.state().loading);
    expect(t.state().frame?.template.previewAvailable).toBe(true);
    await t.controller.confirm(ACK);
    expect(t.h.control.submits).toBe(0);
  });

  it("keeps reviewed consent usable when ordinary scheduler and observation timestamps advance", async () => {
    const t = await fixture(); const bankId = t.h.f.bindings[0].externalBankId;
    const draft = { ...t.state().draft!, enrollment: "reviewed-existing" as const };
    t.controller.edit(draft); await t.controller.preview(); const preview = t.state().preview;
    expect(preview?.state).toBe("ready");
    // Only the explicit fake scheduler advances; the actual WS authority reader supplies the new observation.
    t.h.f.state.now = new Date(Date.parse(t.h.f.state.now) + 1000).toISOString();
    t.h.f.live.scheduler.requestManual(bankId); await t.h.f.live.scheduler.tick();
    await t.controller.refresh(); await until(() => !t.state().loading);
    expect(t.state().frame?.authority.observedAt).toBe(t.h.f.state.now);
    expect(t.state().frame?.authority.replica?.find((bank) => bank.bankId === bankId)?.lastSuccessAt).toBe(t.h.f.state.now);
    expect(t.state().preview).toEqual(preview); expect(t.state().draftStale).toBe(false);
    await t.controller.confirm(ACK); await t.settle(); expect(t.h.control.submits).toBe(1);
  });

  it("subscribes, reads all Bank consequences before confirmation and submits exactly once", async () => {
    const t = await fixture(); expect(t.h.subscriptions.count()).toBe(1);
    expect(t.state().frame?.authority.hindsight?.banks.map((bank) => bank.nativeBankId).sort()).toEqual(t.h.f.bindings.map((bank) => bank.externalBankId).sort());
    await t.controller.preview(); expect(t.state().details).toHaveLength(2); expect(t.h.control.submits).toBe(0);
    const preview = t.state().preview!; if (preview.state !== "ready") throw new Error("preview missing");
    expect(t.h.f.native.calls.some((entry) => entry.method === "apply" || entry.method === "refresh")).toBe(false);
    await Promise.all([t.controller.confirm(ACK), t.controller.confirm(ACK)]);
    await t.settle();
    expect(t.h.control.submits).toBe(1); expect(t.state().frame?.original?.result).toMatchObject({ kind: "template", outcome: "bound" });
    expect(t.h.control.submitted).toEqual([{ request: { kind: "template.apply", requestId: expect.any(String), previewId: preview.previewId, previewHash: preview.previewHash } }]);
  });

  it("requires full deletion and provider acknowledgement and preserves user choices after removal", async () => {
    const t = await fixture(); const bankId = t.h.f.bindings[0].externalBankId;
    t.controller.selectBank(bankId); await until(() => !t.state().loading);
    const draft = t.state().draft!; if (draft.target.kind !== "bank") throw new Error("Bank draft missing");
    t.controller.edit({ ...draft, target: { ...draft.target, userChoices: { ...EMPTY_TEMPLATE_CHOICES,
      config: [{ key: "retain_mission", choice: { mode: "value", value: "explicit-user-mission" } }],
      labels: [{ key: "user-facets", choice: { mode: "value", value: { key: "user-facets", type: "map", optional: false,
        tag: false, fields: { tone: { type: "multi-values", values: [{ value: "warm", description: "Preserved user detail" }] } } } } }],
      models: [{ id: "user-model", choice: { mode: "value", value: { id: "user-model", name: "User", source_query: "User query",
        tags: ["user:full"], max_tokens: 512, trigger: { refresh_after_consolidation: true, fact_types: ["world"],
          include_chunks: false, response_schema: { type: "object", properties: { summary: { type: "string" } } } },
      } } }],
      directives: [{ id: "44444444-4444-4444-8444-444444444444", name: "Full user directive", choice: { mode: "value", value: {
        id: "44444444-4444-4444-8444-444444444444", name: "Full user directive", content: "Keep this exact content",
        tags: ["user:directive"], priority: -19, is_active: false } } }] } },
    refresh: [{ bankId, modelIds: ["user-model"] }] });
    await t.controller.preview(); await t.controller.confirm({ ...ACK, provider: false }); expect(t.h.control.submits).toBe(0);
    await t.controller.confirm(ACK); await t.settle();
    const selected = t.state().frame!.template.bank!.selected!;
    expect(selected.user.models[0]?.choice.mode).toBe("value");
    const updated = t.state().draft!; if (updated.target.kind !== "bank") throw new Error("missing Bank draft");
    t.controller.edit({ ...updated, target: { ...updated.target, templateRevision: "none" } });
    await t.controller.preview(); expect(t.state().details.some((detail) => detail.deletions.length > 0)).toBe(true);
    await t.controller.confirm({ ...ACK, deletion: false }); expect(t.h.control.submits).toBe(1);
    await t.controller.confirm(ACK); await t.settle();
    expect(t.state().frame?.template.bank?.selected).toMatchObject({ templateRevision: "none", user: selected.user });
    expect(t.state().frame?.authority.authority.mode).toBe("hindsight");
  });

  it("retires delayed previews/details after draft, scope or connection change", async () => {
    const t = await fixture(); const preview = deferred<MemoryTemplatePreview>();
    const spy = vi.spyOn(t.client, "hindsightTemplatePreview").mockReturnValueOnce(preview.promise);
    const work = t.controller.preview(); t.controller.edit({ ...t.state().draft!, enrollment: "reviewed-existing" });
    preview.resolve({ state: "refused", reason: "MEMORY_TEMPLATE_CONFLICT", bankId: null, review: null }); await work;
    expect(t.state().preview).toBeNull(); spy.mockRestore();
    const detail = deferred<MemoryTemplateDetail>();
    const realDetail = t.client.hindsightTemplateDetail.bind(t.client);
    let original: MemoryTemplateDetail | null = null;
    vi.spyOn(t.client, "hindsightTemplateDetail").mockImplementationOnce(async (params) => { original = await realDetail(params); return detail.promise; });
    const pending = t.controller.preview(); await until(() => original !== null);
    t.controller.selectBank(t.h.f.bindings[0].externalBankId); detail.resolve(original!); await pending;
    await until(() => !t.state().loading); expect(t.state().details).toEqual([]);
    await t.controller.confirm(ACK); expect(t.h.control.submits).toBe(0);
    const late = deferred<MemoryTemplatePreview>();
    vi.spyOn(t.client, "hindsightTemplatePreview").mockReturnValueOnce(late.promise);
    const replaced = t.controller.preview(); const next = await t.open(); t.controller.replace(next);
    late.resolve({ state: "refused", reason: "MEMORY_TEMPLATE_CONFLICT", bankId: null, review: null }); await replaced;
    expect(t.state().preview).toBeNull(); expect(t.h.control.submits).toBe(0);
  });

  it("keeps unsubmitted choices through a client replacement and blocks preview while a resource form is unfinished", async () => {
    const t = await fixture(); const draft = { ...t.state().draft!, enrollment: "reviewed-existing" as const };
    t.controller.edit(draft); await t.controller.preview(); expect(t.state().preview?.state).toBe("ready");
    t.controller.setResourceEditing(true); const reads = t.h.control.previews;
    await t.controller.preview(); await t.controller.confirm(ACK);
    expect(t.state().preview).toBeNull(); expect(t.h.control.previews).toBe(reads); expect(t.h.control.submits).toBe(0);
    t.controller.replace(null); expect(t.state().draft).toEqual(draft);
    const next = await t.open(); t.controller.replace(next); await until(() => !t.state().loading);
    expect(t.state().draft).toEqual(draft); expect(t.state().editorPending).toBe(true);
    t.controller.resetDraft(); expect(t.state().editorPending).toBe(false); expect(t.state().draft?.enrollment).toBe("fresh");
  });

  it("sanitizes a subscription failure through the template formatter without losing read-only status", async () => {
    const t = await fixture(); const next = await t.open();
    vi.spyOn(next, "subscribeMemoryOperations").mockRejectedValueOnce(new Error("SUBSCRIPTION_SECRET_SENTINEL"));
    t.controller.replace(next); await until(() => !t.state().loading);
    expect(t.state().feedback).toEqual({ tone: "warn", message: "请求未完成，请刷新 Core 状态后重试。" });
    expect(JSON.stringify(t.state())).not.toContain("SUBSCRIPTION_SECRET_SENTINEL");
    expect(t.state().frame).not.toBeNull(); expect(t.h.control.submits).toBe(0);
  });

  it("refuses corrupt/failed details and expired previews without a submit", async () => {
    const t = await fixture(); vi.spyOn(t.client, "hindsightTemplateDetail").mockRejectedValueOnce(new Error("SECRET_SENTINEL"));
    await t.controller.preview(); expect(t.state().preview).toBeNull(); expect(t.state().previewError).not.toContain("SECRET_SENTINEL");
    await t.controller.confirm(ACK); expect(t.h.control.submits).toBe(0);
    const actual = await t.client.hindsightTemplatePreview(t.h.f.params()); if (actual.state !== "ready") throw new Error("preview missing");
    vi.spyOn(t.client, "hindsightTemplatePreview").mockResolvedValueOnce({ ...actual, expiresAt: "2020-01-01T00:00:00Z" });
    await t.controller.preview(); await t.controller.confirm(ACK); expect(t.h.control.submits).toBe(0);
  });

  it("cannot confirm incomplete all-Bank details or a detail from another preview", async () => {
    const t = await fixture(); const detail = deferred<MemoryTemplateDetail>();
    const realDetail = t.client.hindsightTemplateDetail.bind(t.client); let second: MemoryTemplateDetail | null = null;
    vi.spyOn(t.client, "hindsightTemplateDetail").mockImplementation(async (params) => {
      const current = await realDetail(params);
      if (second === null && current.bank.scope === "global") { second = current; return detail.promise; }
      return current;
    });
    const preview = t.controller.preview(); await until(() => second !== null);
    expect(t.state().previewLoading).toBe(true);
    await t.controller.confirm(ACK); expect(t.h.control.submits).toBe(0);
    detail.resolve({ ...second!, previewHash: "f".repeat(64) }); await preview;
    expect(t.state().preview).toBeNull(); expect(t.state().details).toEqual([]);
    expect(t.state().previewError).toBe("请求未完成，请刷新 Core 状态后重试。");
    await t.controller.confirm(ACK); expect(t.h.control.submits).toBe(0);
  });

  it("uses Core's recovery action while an original executor is still active", async () => {
    const t = await fixture(); t.h.control.holdApply = true;
    await t.controller.preview(); await t.controller.confirm(ACK);
    await until(() => t.h.control.entered);
    await t.controller.refresh(); await until(() => !t.state().loading);
    expect(t.state().frame?.template.plan?.hold).toBe("active");
    expect(t.state().frame?.template.recoverPlanId).toBeNull();
    expect(t.state().frame?.template.recoverUnavailableReason).toBe("active");
    await t.controller.recover(); expect(t.h.control.submits).toBe(1);
    t.h.release(); await t.settle();
  });

  it("sanitizes a mutation transport failure and consumes the confirmation without replay", async () => {
    const t = await fixture(); await t.controller.preview();
    vi.spyOn(t.client, "memoryOperationSubmit").mockRejectedValueOnce(new Error("MUTATION_SECRET_SENTINEL"));
    await t.controller.confirm(ACK);
    expect(t.state().feedback).toEqual({ tone: "warn", message: "请求未完成，请刷新 Core 状态后重试。" });
    expect(JSON.stringify(t.state())).not.toContain("MUTATION_SECRET_SENTINEL");
    await t.controller.confirm(ACK); expect(t.h.control.submits).toBe(0);
    expect(t.h.f.native.calls.some((call) => call.method === "apply")).toBe(false);
  });

  it("a lost submit acknowledgement and second observer rediscover partial work without replay", async () => {
    const t = await fixture(); await t.controller.preview(); const originalPreview = t.state().preview!;
    if (originalPreview.state !== "ready") throw new Error("preview missing");
    t.h.control.failBank = originalPreview.banks[1]!.target.bank_id;
    t.h.control.submitDelayMs = 1000;
    await t.controller.confirm(ACK); await t.settle();
    expect(t.state().frame?.original?.result).toMatchObject({ outcome: "partial", appliedBanks: 1 });
    const original = t.state().frame!.template.plan!;
    const second = await t.open(); t.client.close(); t.controller.replace(second); await until(() => !t.state().loading);
    expect(t.state().frame?.template.plan?.originalOperationId).toBe(original.originalOperationId);
    expect(t.h.control.submits).toBe(1); expect(t.state().frame?.template.recoverPlanId).toBe(original.planId);
    t.h.control.failBank = null; t.h.control.submitDelayMs = 0; const before = t.h.f.native.calls.filter((call) => call.method === "apply").length;
    await t.controller.recover(); await t.settle();
    expect(t.h.control.submits).toBe(2);
    expect(t.h.f.native.calls.filter((call) => call.method === "apply").length).toBe(before + 1);
    expect(t.state().frame?.template.recoverUnavailableReason).toBe("already_bound");
  });

  it("published binding failure recovers only binding and physical reopen keeps original identity", async () => {
    const t = await fixture(); t.h.f.state.failBinding = true;
    await t.controller.preview(); await t.controller.confirm(ACK); await t.settle();
    const plan = t.state().frame!.template.plan!; expect(plan.publicationId).not.toBeNull();
    expect(t.state().frame?.original?.result).toMatchObject({ outcome: "binding_unavailable" });
    t.controller.replace(null); t.client.close(); await t.h.reopen(); const next = await t.open();
    t.controller.replace(next); await until(() => !t.state().loading);
    expect(t.state().frame?.template.plan?.planId).toBe(plan.planId);
    const applyCount = t.h.f.native.calls.filter((call) => call.method === "apply").length;
    t.h.f.state.failBinding = false; await t.controller.recover(); await t.settle();
    expect(t.h.f.native.calls.filter((call) => call.method === "apply").length).toBe(applyCount);
    expect(t.state().frame?.template.recoverUnavailableReason).toBe("already_bound");
  });

  it("current derived reads do not promote rollout history and failure clears previous success", async () => {
    const t = await fixture(); await t.controller.preview(); const first = t.state().details[0]!;
    const model = first.changes.models.find((item) => item.kind === "upsert"); if (!model || model.kind !== "upsert") throw new Error("model missing");
    t.controller.edit({ ...t.state().draft!, refresh: [{ bankId: first.bank.target.bank_id, modelIds: [model.definition.id] }] });
    await t.controller.preview(); await t.controller.confirm(ACK); await t.settle();
    const plan = t.state().frame!.template.plan!; const bank = plan.banks.find((entry) => entry.derived.length)!;
    const child = { planId: plan.planId, bankId: bank.bank.target.bank_id, childId: bank.derived[0]!.childId };
    t.h.control.childState = "completed"; await t.controller.observeChild(child);
    expect(t.state().derived).toMatchObject({ state: "observed", result: { state: "completed" } });
    expect(bank.derived[0]).toMatchObject({ source: "rollout_record", state: "pending" });
    const previous = t.state().derived!;
    t.h.control.derivedFails = true; await t.controller.observeChild(child);
    expect(t.state().derived).toMatchObject({ state: "unavailable" });
    expect(t.state().derived).not.toHaveProperty("result");
    const late = deferred<MemoryTemplateDerivedObservation>();
    vi.spyOn(t.client, "hindsightTemplateDerived").mockReturnValueOnce(late.promise);
    const pending = t.controller.observeChild(child);
    const replacement = await t.open(); t.controller.replace(replacement);
    await until(() => !t.state().loading && !t.state().derivedLoading);
    late.resolve(previous); await pending;
    expect(t.state().derived).toMatchObject({ state: "unavailable" });
    expect(t.state().derived).not.toHaveProperty("result");
    t.h.control.derivedFails = false; const next = await t.open(); t.controller.replace(next); await until(() => !t.state().loading && !t.state().derivedLoading);
    expect(t.state().derived).toMatchObject({ state: "observed", result: { state: "completed" } });
  });

  it("unsupported preview never changes operations or hides an untracked Bank's history boundary", async () => {
    const t = await fixture(); t.controller.selectBank(t.h.f.bindings[0].externalBankId); await until(() => !t.state().loading);
    expect(t.state().frame?.template.bank).toMatchObject({ enrollment: "untracked", selected: null, latestUser: null });
    delete t.h.f.native.manifest.contracts.template_lifecycle;
    await t.controller.preview(); expect(t.state().preview).toMatchObject({ state: "refused", reason: "MEMORY_TEMPLATE_UNSUPPORTED" });
    await t.controller.confirm(ACK); expect(t.h.control.submits).toBe(0);
  });
});
