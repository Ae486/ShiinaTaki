/**
 * INPUT:  an isolated Core lifecycle fixture and controlled fake Native response boundaries
 * OUTPUT: actual authenticated template/operation/authority WS methods with one operation owner and cleanup
 * POS:    Desktop test support only — runtime binding/sync and Native SQL remain explicitly synthetic
 */
import { MEMORY_AUTHORITY_METHODS, MemoryAuthorityStatusParamsSchema, type HindsightTemplateRefreshResultSchema } from "@taki/shared";
import { templateLifecycleFixture } from "../../../../../../../packages/core/src/memory/hindsight/template-lifecycle/template-lifecycle-fixtures.ts";
import { createMemoryOperationService } from "../../../../../../../packages/core/src/memory/operations/memory-operation-service.ts";
import { fakeSetup } from "../../../../../../../packages/core/src/memory/operations/memory-operation-fixtures.ts";
import { readMemoryAuthorityStatus } from "../../../../../../../packages/core/src/memory/operations/memory-authority-status.ts";
import { createHindsightConnectionRepo } from "../../../../../../../packages/core/src/db/hindsight-connection-repo.ts";
import { createHindsightBankSetupRepo } from "../../../../../../../packages/core/src/db/hindsight-bank-setup-repo.ts";
import { readHindsightLiveProjection } from "../../../../../../../packages/core/src/memory/hindsight/hindsight-runtime-connection.ts";
import { createMethodRegistry } from "../../../../../../../packages/core/src/server/method-registry.ts";
import { createMemoryOperationSubscriptions } from "../../../../../../../packages/core/src/server/memory-operation-subscriptions.ts";
import { registerHindsightTemplateMethods } from "../../../../../../../packages/core/src/server/methods/hindsight-template-methods.ts";
import { registerMemoryOperationMethods } from "../../../../../../../packages/core/src/server/methods/memory-operation-methods.ts";
import { createConnectionRegistry } from "../../../../../../../packages/core/src/server/connection-registry.ts";
import { createDeviceRegistry } from "../../../../../../../packages/core/src/devices/device-registry.ts";
import type { PairedDevice } from "../../../../../../../packages/core/src/devices/paired-device-store.ts";
import { connectMethod } from "../../../../../../../packages/core/src/server/methods/connect.ts";
import { startWsServer } from "../../../../../../../packages/core/src/server/ws-server.ts";

type NativeChildState = typeof HindsightTemplateRefreshResultSchema._output.state;
export async function templateHomeFixture() {
  const f = templateLifecycleFixture();
  f.state.now = new Date().toISOString();
  await f.owner.stop();
  const control = { submitDelayMs: 0, submits: 0, submitted: [] as unknown[], previews: 0, failBank: null as string | null, failAfterCommit: false,
    holdApply: false, entered: false, childState: "pending" as NativeChildState, derivedFails: false };
  const waiters = new Set<() => void>();
  const release = () => { control.holdApply = false; for (const done of waiters) done(); waiters.clear(); };
  f.native.hooks.before = async (call) => {
    if (call.method !== "apply") return;
    if (control.holdApply && (control.failBank === null || call.bankId === control.failBank)) {
      control.entered = true; await new Promise<void>((resolve) => waiters.add(resolve));
    }
    if (call.bankId === control.failBank) throw new Error("owned Native failure");
  };
  f.native.hooks.afterCommit = () => { if (control.failAfterCommit) { control.failAfterCommit = false; throw new Error("owned lost Native reply"); } };
  const original = f.native.client.templateRefreshResult;
  f.native.client.templateRefreshResult = async (input) => {
    if (!original || control.derivedFails) throw new Error("owned derived failure");
    return { ...await original(input), state: control.childState,
      result_revision: control.childState === "completed" ? 2 : null,
      result_payload_hash: control.childState === "completed" ? "c".repeat(64) : null };
  };
  const start = async () => startHomeServer(f, control);
  let running = await start();
  return { f, control, release, get url() { return running.url; }, get owner() { return running.owner; },
    get subscriptions() { return running.subscriptions; },
    reopen: async () => { release(); await running.close(); await f.reopen(); await f.owner.stop(); running = await start(); },
    close: async () => { release(); await running.close(); await f.close(); } };
}

async function startHomeServer(f: ReturnType<typeof templateLifecycleFixture>, control: { submitDelayMs: number; submits: number; submitted: unknown[]; previews: number }) {
  const subscriptions = createMemoryOperationSubscriptions();
  const setup = fakeSetup();
  // The real authority read lists setup.status().banks. Its source must be the fixture's persisted Bank rows.
  setup.status = () => createHindsightConnectionRepo(f.db).read(createHindsightBankSetupRepo(f.db).list());
  const owner = createMemoryOperationService({ db: f.db, bootId: f.state.bootId, now: () => f.state.now,
    templates: f.service, setup, live: () => f.live, logger: f.base.logger, onChanged: (operation) => subscriptions.publish(operation) });
  const registry = createMethodRegistry({ logger: f.base.logger });
  registerHindsightTemplateMethods(registry, f.service);
  registerMemoryOperationMethods(registry, { service: owner, subscriptions, logger: f.base.logger });
  registry.register({ method: MEMORY_AUTHORITY_METHODS.status, roles: ["operator"], paramsSchema: MemoryAuthorityStatusParamsSchema,
    handler: () => readMemoryAuthorityStatus({ db: f.db, setup, operations: owner, live: () => f.live,
      liveConnection: () => readHindsightLiveProjection(f.deps), now: () => f.state.now }) });
  const devices = new Map<string, PairedDevice>();
  const connections = createConnectionRegistry();
  registry.register(connectMethod({ deviceRegistry: createDeviceRegistry({ store: { find: (id) => devices.get(id), save: (value) => { devices.set(value.deviceId, value); } } }),
    connectionRegistry: connections, trustLoopbackOperator: true, onPairingCode: () => undefined, onAutoTrust: () => undefined }));
  const dispatch = registry.dispatch;
  registry.dispatch = async (request, context) => {
    if (request.method === "memory.operations.submit") { control.submits++; control.submitted.push(request.params); }
    if (request.method === "memory.templates.preview") control.previews++;
    const result = await dispatch(request, context);
    if (request.method === "memory.operations.submit" && control.submitDelayMs) await new Promise((resolve) => setTimeout(resolve, control.submitDelayMs));
    return result;
  };
  const server = await startWsServer({ host: "127.0.0.1", port: 0, registry, connectionRegistry: connections, logger: f.base.logger });
  return { owner, subscriptions, url: `ws://127.0.0.1:${server.port}`, close: async () => { await server.close(); f.service.stop(); await owner.stop(); } };
}
