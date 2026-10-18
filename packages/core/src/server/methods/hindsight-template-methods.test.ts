import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  JSON_RPC_APP_ERROR, JSON_RPC_ERROR_CODES, JsonRpcErrorResponseSchema, JsonRpcSuccessResponseSchema,
  MEMORY_OPERATION_METHODS, MEMORY_TEMPLATE_METHODS, MemoryOperationStatusResultSchema, MemoryOperationSubmitResultSchema,
  MemoryTemplateDetailSchema, MemoryTemplatePreviewSchema, MemoryTemplateStatusSchema, type MemoryTemplateRequest, type Role,
} from "@taki/shared";
import { createDeviceRegistry } from "../../devices/device-registry.ts";
import type { PairedDevice } from "../../devices/paired-device-store.ts";
import { templateLifecycleFixture, type TemplateLifecycleFixture } from "../../memory/hindsight/template-lifecycle/template-lifecycle-fixtures.ts";
import { TEMPLATE_PREVIEW_TTL_MS } from "../../memory/hindsight/template-lifecycle/template-preview-service.ts";
import { appCode, openClient, sendConnect, type TestClient } from "../../testing/ws-test-client.ts";
import { createConnectionRegistry, type Connection } from "../connection-registry.ts";
import { createMemoryOperationSubscriptions } from "../memory-operation-subscriptions.ts";
import { createMethodRegistry, type MethodContext, type MethodRegistry } from "../method-registry.ts";
import { startWsServer } from "../ws-server.ts";
import { connectMethod } from "./connect.ts";
import { registerHindsightTemplateMethods } from "./hindsight-template-methods.ts";
import { registerMemoryOperationMethods } from "./memory-operation-methods.ts";

const fixtures: TemplateLifecycleFixture[] = [];
const socketClosers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of socketClosers.splice(0).reverse()) await close();
  for (const f of fixtures.splice(0)) await f.close();
});

function fixture() {
  const f = templateLifecycleFixture(); fixtures.push(f);
  const registry = createMethodRegistry({ logger: f.base.logger });
  registerHindsightTemplateMethods(registry, f.service);
  registerMemoryOperationMethods(registry, { service: f.owner, subscriptions: createMemoryOperationSubscriptions(), logger: f.base.logger });
  return { f, registry, dispatch: (method: string, params: unknown, role: Role | "awaiting" = "operator") =>
    registry.dispatch({ jsonrpc: "2.0", id: randomUUID(), method, params }, context(role)) };
}
function context(role: Role | "awaiting"): MethodContext {
  const connection: Connection = { state: role === "awaiting" ? { status: "awaiting" }
    : { status: "authenticated", deviceId: "fixture-device", role, capabilities: [] } };
  return { connection, notify: () => undefined, close: () => undefined, onClose: () => undefined };
}
function changes(f: TemplateLifecycleFixture): number {
  const value = f.db.prepare("SELECT total_changes() AS count").get()?.count;
  if (typeof value !== "number") throw new Error("fixture SQLite change counter unavailable");
  return value;
}
const result = (frame: unknown) => JsonRpcSuccessResponseSchema.parse(frame).result;
function readyPreview(frame: unknown) {
  const preview = MemoryTemplatePreviewSchema.parse(result(frame));
  expect(preview.state).toBe("ready");
  if (preview.state !== "ready") throw new Error("fixture preview refused");
  return preview;
}
function refused(frame: unknown, reason: string): void {
  expect(JsonRpcErrorResponseSchema.parse(frame).error).toMatchObject({ code: JSON_RPC_APP_ERROR,
    data: { code: "MEMORY_OPERATION_REFUSED", reason } });
}
function unissuedApply() {
  return { kind: "template.apply" as const, requestId: randomUUID(), previewId: randomUUID(), previewHash: "a".repeat(64) };
}
function detailParams(f: TemplateLifecycleFixture) {
  return { previewId: randomUUID(), previewHash: "a".repeat(64), bankId: f.bindings[0].externalBankId };
}
function readRequests(f: TemplateLifecycleFixture) {
  return [
    { method: MEMORY_TEMPLATE_METHODS.preview, params: f.params() },
    { method: MEMORY_TEMPLATE_METHODS.detail, params: detailParams(f) },
    { method: MEMORY_TEMPLATE_METHODS.status, params: {} },
    { method: MEMORY_TEMPLATE_METHODS.derived, params: { planId: randomUUID(), bankId: f.bindings[0].externalBankId, childId: randomUUID() } },
  ];
}
function operationRequests() {
  return [unissuedApply(), { kind: "template.recover" as const, requestId: randomUUID(), planId: randomUUID() }]
    .map((request) => ({ method: MEMORY_OPERATION_METHODS.submit, params: { request } }));
}
function hostileRequest(f: TemplateLifecycleFixture, name: string) {
  const snapshot = { snapshot_hash: "b".repeat(64), target: { bank_id: f.bindings[0].externalBankId } };
  switch (name) {
    case "preview snapshot": return { method: MEMORY_TEMPLATE_METHODS.preview, params: { ...f.params(), snapshot } };
    case "nested target snapshot": return { method: MEMORY_TEMPLATE_METHODS.preview,
      params: { ...f.params(), target: { ...f.params().target, snapshot } } };
    case "detail snapshot": return { method: MEMORY_TEMPLATE_METHODS.detail, params: { ...detailParams(f), snapshot } };
    case "status mutation": return { method: MEMORY_TEMPLATE_METHODS.status, params: { refresh: true } };
    case "derived refresh": return { method: MEMORY_TEMPLATE_METHODS.derived,
      params: { planId: randomUUID(), bankId: f.bindings[0].externalBankId, childId: randomUUID(), refresh: true } };
    case "inline apply snapshot": return { method: MEMORY_OPERATION_METHODS.submit,
      params: { request: { ...unissuedApply(), expected_snapshot: snapshot } } };
    case "caller recovery executor": return { method: MEMORY_OPERATION_METHODS.submit, params: { request: {
      kind: "template.recover", requestId: randomUUID(), planId: randomUUID(), executor: { generation: 1, token: randomUUID() } } } };
    default: throw new Error("unknown hostile fixture case");
  }
}

async function sockets(f: TemplateLifecycleFixture, registry: MethodRegistry) {
  const stored = new Map<string, PairedDevice>();
  const devices = createDeviceRegistry({ store: { find: (id) => stored.get(id), save: (value) => { stored.set(value.deviceId, value); } } });
  const connections = createConnectionRegistry();
  registry.register(connectMethod({ deviceRegistry: devices, connectionRegistry: connections, trustLoopbackOperator: true,
    onPairingCode: () => undefined, onAutoTrust: () => undefined }));
  const server = await startWsServer({ host: "127.0.0.1", port: 0, registry, connectionRegistry: connections, logger: f.base.logger });
  const clients: TestClient[] = [];
  const raw = async () => { const client = await openClient(`ws://127.0.0.1:${server.port}`); clients.push(client); return client; };
  socketClosers.push(async () => { for (const client of clients) client.close(); await server.close(); });
  return { raw, open: async (role: Role = "operator", token?: string, id = randomUUID()) => {
    const client = await raw(); const credential = token ?? devices.trustDevice(id, { deviceName: "template-fixture", role });
    sendConnect(client, { role, token: credential, deviceId: id, deviceName: "template-fixture" });
    expect((await client.take(1))[0]).toHaveProperty("result");
    return { client, credential, id };
  } };
}
async function call(client: TestClient, method: string, params: unknown) {
  const id = randomUUID(); client.send({ jsonrpc: "2.0", id, method, params });
  const frame = (await client.take(1))[0]; expect(frame).toMatchObject({ id }); return frame;
}

describe("template operator dispatcher boundaries", () => {
  it.each(["awaiting", "node"] as const)("refuses %s template reads before any Native call or SQLite write", async (role) => {
    const { f, dispatch } = fixture(); const before = changes(f);
    for (const request of readRequests(f)) expect(appCode(await dispatch(request.method, request.params, role))).toBe("FORBIDDEN");
    // The WS pre-auth gate owns unconnected operation submissions; authenticated role rejection belongs to dispatch.
    if (role === "node") for (const request of operationRequests()) {
      expect(appCode(await dispatch(request.method, request.params, role))).toBe("FORBIDDEN");
    }
    expect(f.native.calls).toEqual([]); expect(changes(f)).toBe(before);
    expect(f.db.prepare("SELECT * FROM memory_operations").all()).toEqual([]);
  });

  it.each(["preview snapshot", "nested target snapshot", "detail snapshot", "status mutation", "derived refresh", "inline apply snapshot", "caller recovery executor"])(
    "rejects hostile extra input: %s", async (name) => {
      const { f, dispatch } = fixture(); const before = changes(f); const request = hostileRequest(f, name);
      const response = JsonRpcErrorResponseSchema.parse(await dispatch(request.method, request.params));
      expect(response.error.code).toBe(JSON_RPC_ERROR_CODES.INVALID_PARAMS);
      expect(f.native.calls).toEqual([]); expect(changes(f)).toBe(before);
      expect(f.db.prepare("SELECT * FROM memory_operations").all()).toEqual([]);
    });

  it("returns Core-held preview/detail/status without persisting ownership or invoking a Native write", async () => {
    const { f, dispatch } = fixture(); const before = changes(f);
    const preview = readyPreview(await dispatch(MEMORY_TEMPLATE_METHODS.preview, f.params()));
    expect(preview.banks).toHaveLength(2);
    for (const bank of preview.banks) {
      const detail = MemoryTemplateDetailSchema.parse(result(await dispatch(MEMORY_TEMPLATE_METHODS.detail, {
        previewId: preview.previewId, previewHash: preview.previewHash, bankId: bank.target.bank_id })));
      expect(detail.before.target).toEqual(bank.target); expect(detail.bank).toEqual(bank);
      expect(detail.previewHash).toBe(preview.previewHash); expect(detail.changes.config.length).toBeGreaterThan(0);
    }
    expect(MemoryTemplateStatusSchema.parse(result(await dispatch(MEMORY_TEMPLATE_METHODS.status, {}))))
      .toMatchObject({ previewAvailable: true, holdPlanId: null, plan: null, defaults: null });
    expect(f.native.calls.map((entry) => entry.method)).toEqual(["compatibility", "snapshot", "snapshot"]);
    expect(f.native.receipts.size).toBe(0); expect(f.native.created.size).toBe(0); expect(changes(f)).toBe(before);
    expect(f.db.prepare("SELECT * FROM hindsight_template_plans").all()).toEqual([]);
  });

  it("returns a closed unknown-plan refusal through the actual status registration", async () => {
    const { f, dispatch } = fixture(); const before = changes(f);
    refused(await dispatch(MEMORY_TEMPLATE_METHODS.status, { planId: randomUUID() }), "MEMORY_TEMPLATE_PLAN_NOT_FOUND");
    expect(f.native.calls).toEqual([]); expect(changes(f)).toBe(before);
  });

  it("expires genuine detail with a closed refusal and no further Native read or SQLite write", async () => {
    const { f, dispatch } = fixture(); const request = await f.request();
    if (request.kind !== "template.apply") throw new Error("fixture apply request missing");
    const calls = structuredClone(f.native.calls); const before = changes(f);
    f.state.now = new Date(Date.parse(f.state.now) + TEMPLATE_PREVIEW_TTL_MS).toISOString();
    refused(await dispatch(MEMORY_TEMPLATE_METHODS.detail, { previewId: request.previewId, previewHash: request.previewHash,
      bankId: f.bindings[0].externalBankId }), "MEMORY_TEMPLATE_PREVIEW_EXPIRED");
    expect(f.native.calls).toEqual(calls); expect(changes(f)).toBe(before);
  });
});

describe("template lifecycle over actual operator WebSockets", () => {
  it.each(["awaiting", "node"] as const)("rejects %s socket reads and apply/recover without producer or DB work", async (role) => {
    const { f, registry } = fixture(); const transport = await sockets(f, registry); const before = changes(f);
    const node = role === "node" ? await transport.open("node") : null;
    for (const request of [...readRequests(f), ...operationRequests()]) {
      const client = node?.client ?? await transport.raw();
      expect(appCode(await call(client, request.method, request.params))).toBe(role === "node" ? "FORBIDDEN" : "NOT_AUTHENTICATED");
      if (role === "awaiting") await client.waitClosed();
    }
    expect(f.native.calls).toEqual([]); expect(changes(f)).toBe(before);
    expect(f.db.prepare("SELECT * FROM memory_operations").all()).toEqual([]);
  });

  it.each([{ committed: 0, outcome: "outcome_unknown" }, { committed: 1, outcome: "partial" }] as const)(
    "shares retained $outcome across reconnect and only resumes from explicit same-plan recovery", async ({ committed, outcome }) => {
      const { f, registry } = fixture(); const transport = await sockets(f, registry);
      const first = await transport.open(); const second = await transport.open();
      const preview = readyPreview(await call(first.client, MEMORY_TEMPLATE_METHODS.preview, f.params()));
      const request: MemoryTemplateRequest = { kind: "template.apply", requestId: randomUUID(),
        previewId: preview.previewId, previewHash: preview.previewHash };
      // Preview summaries retain the persisted rollout order; fixture bindings use a different order.
      const failing = preview.banks[committed];
      if (!failing) throw new Error("fixture requires the planned failure Bank");
      const failingBank = failing.target.bank_id;
      f.native.hooks.before = (entry) => { if (entry.method === "apply" && entry.bankId === failingBank) throw new Error("fixture lost apply reply"); };
      const original = MemoryOperationSubmitResultSchema.parse(result(await call(first.client, MEMORY_OPERATION_METHODS.submit, { request }))).operation;
      await f.owner.stop(); const plan = f.plan(original);
      expect(plan.banks.map((bank) => bank.identity.target.bank_id)).toEqual(preview.banks.map((bank) => bank.target.bank_id));
      const retained = MemoryOperationStatusResultSchema.parse(result(await call(second.client, MEMORY_OPERATION_METHODS.status,
        { operationId: original.operationId }))).operation;
      expect(retained).toMatchObject({ state: "outcome_unknown", result: { kind: "template", outcome, appliedBanks: committed, totalBanks: 2 } });
      const held = MemoryTemplateStatusSchema.parse(result(await call(first.client, MEMORY_TEMPLATE_METHODS.status, { planId: plan.planId })));
      expect(held).toMatchObject({ holdPlanId: plan.planId, plan: { planId: plan.planId, originalOperationId: original.operationId, hold: "active" } });
      expect(held.plan!.banks.filter((bank) => bank.receiptHash !== null)).toHaveLength(committed);
      const beforeRead = changes(f); const calls = structuredClone(f.native.calls);
      expect(MemoryTemplateStatusSchema.parse(result(await call(second.client, MEMORY_TEMPLATE_METHODS.status, { planId: plan.planId })))).toEqual(held);
      first.client.close(); await first.client.waitClosed();
      f.state.now = new Date(Date.parse(f.state.now) + TEMPLATE_PREVIEW_TTL_MS + 1).toISOString();
      const reconnected = await transport.open("operator", first.credential, first.id);
      const replay = MemoryOperationSubmitResultSchema.parse(result(await call(reconnected.client, MEMORY_OPERATION_METHODS.submit, { request }))).operation;
      expect(replay).toEqual(retained);
      refused(await call(reconnected.client, MEMORY_TEMPLATE_METHODS.detail, { previewId: preview.previewId,
        previewHash: preview.previewHash, bankId: f.bindings[0].externalBankId }), "MEMORY_TEMPLATE_PREVIEW_EXPIRED");
      expect(MemoryTemplateStatusSchema.parse(result(await call(reconnected.client, MEMORY_TEMPLATE_METHODS.status, { planId: plan.planId })))).toEqual(held);
      expect(f.native.calls).toEqual(calls); expect(changes(f)).toBe(beforeRead);

      f.native.hooks.before = undefined;
      const recovery = MemoryOperationSubmitResultSchema.parse(result(await call(second.client, MEMORY_OPERATION_METHODS.submit,
        { request: { kind: "template.recover", requestId: randomUUID(), planId: plan.planId } }))).operation;
      expect(recovery.operationId).not.toBe(original.operationId); expect(f.plan(recovery)).toEqual(plan);
      await f.owner.stop();
      const finished = MemoryOperationStatusResultSchema.parse(result(await call(reconnected.client, MEMORY_OPERATION_METHODS.status,
        { operationId: recovery.operationId }))).operation;
      expect(finished).toMatchObject({ state: "completed", result: { outcome: "bound", appliedBanks: 2, totalBanks: 2, originalOperationId: original.operationId } });
      const finalCalls = structuredClone(f.native.calls); const afterRecovery = changes(f);
      const published = MemoryTemplateStatusSchema.parse(result(await call(second.client, MEMORY_TEMPLATE_METHODS.status, { planId: plan.planId })));
      expect(published).toMatchObject({ holdPlanId: null, plan: { planId: plan.planId, hold: "published" } });
      expect(published.boundSelectionIdentity).not.toBeNull();
      expect(MemoryTemplateStatusSchema.parse(result(await call(reconnected.client, MEMORY_TEMPLATE_METHODS.status, { planId: plan.planId })))).toEqual(published);
      expect(MemoryOperationStatusResultSchema.parse(result(await call(second.client, MEMORY_OPERATION_METHODS.status,
        { operationId: original.operationId }))).operation).toEqual(retained);
      expect(f.native.receipts.size).toBe(2);
      expect([...f.native.receipts.keys()].sort()).toEqual(plan.banks.map((bank) => bank.preview.request.request_id).sort());
      expect(f.native.calls).toEqual(finalCalls); expect(changes(f)).toBe(afterRecovery);
    });
});
