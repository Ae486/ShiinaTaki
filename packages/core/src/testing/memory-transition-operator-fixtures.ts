/**
 * INPUT: synthetic B4/healthy evidence with production healthy and emergency services.
 * OUTPUT: isolated authenticated WebSocket operator fixture and optional delayed responses.
 * POS: core/testing — real operation/runtime/publication producers; no private corpus or live Native server.
 */
import { join } from "node:path";
import { createHealthyTransitionHarness } from "./memory-transition-healthy-fixtures.ts";
import { composeEmergencyFixture } from "./memory-transition-emergency-service-fixtures.ts";
import { createMemoryOperationService } from "../memory/operations/memory-operation-service.ts";
import { fakeSetup } from "../memory/operations/memory-operation-fixtures.ts";
import { createLogger } from "../logging/logger.ts";
import { createMethodRegistry } from "../server/method-registry.ts";
import { createMemoryOperationSubscriptions } from "../server/memory-operation-subscriptions.ts";
import { registerMemoryTransitionMethods } from "../server/methods/memory-transition-methods.ts";
import { registerMemoryOperationMethods } from "../server/methods/memory-operation-methods.ts";
import { connectMethod } from "../server/methods/connect.ts";
import { createConnectionRegistry } from "../server/connection-registry.ts";
import { createDeviceRegistry } from "../devices/device-registry.ts";
import { createPairedDeviceStore } from "../devices/paired-device-store.ts";
import { startWsServer } from "../server/ws-server.ts";
import type { MemoryTransitionDriver } from "../memory/operations/memory-operation-transition-storage.ts";

export async function createTransitionOperatorFixture() {
  const h = await createHealthyTransitionHarness({ aliases: true });
  // Materialize actual bound policy evidence before emergency; the original B4 synthetic fixture lacks it.
  for (const kind of ["transition.return-local", "transition.reenter-hindsight"] as const) {
    const op = h.owner.submit(await h.request(undefined, kind)); await h.owner.stop();
    if (h.owner.status(op.operationId).state !== "completed") throw new Error("operator fixture seeding failed");
  }
  const e = composeEmergencyFixture(h); const subscriptions = createMemoryOperationSubscriptions();
  const logger = createLogger("fatal"); const registry = createMethodRegistry();
  const driver: MemoryTransitionDriver = {
    plan: (request, context) => (request.kind === "transition.emergency-local" ? e.emergency : h.service).plan(request, context),
    execute: (input) => (input.request.kind === "transition.emergency-local" ? e.emergency : h.service).execute(input),
    emergencyAdmitted: (epochId) => { h.service.quarantine(); e.emergency.emergencyAdmitted?.(epochId); },
  };
  const service = { ...driver, status: h.service.status, overview: h.service.overview,
    preview: (params: Parameters<typeof e.emergency.preview>[0]) => params.kind === "transition.emergency-local"
      ? e.emergency.preview(params) : h.service.preview({ ...params, kind: params.kind }) };
  const owner = createMemoryOperationService({ db: h.db, live: h.runtime.operations, setup: fakeSetup(), transition: driver,
    bootId: "healthy-fixture", now: () => h.clock.value, logger, onChanged: (operation) => subscriptions.publish(operation) });
  registerMemoryTransitionMethods(registry, service);
  registerMemoryOperationMethods(registry, { service: owner, subscriptions, logger });
  const connections = createConnectionRegistry();
  registry.register(connectMethod({ deviceRegistry: createDeviceRegistry({ store: createPairedDeviceStore(join(h.dataDir, "w7-devices.json")) }),
    connectionRegistry: connections, trustLoopbackOperator: true, onPairingCode: () => undefined, onAutoTrust: () => undefined }));
  const control = { submitDelayMs: 0, previewDelayMs: 0, bindDelayMs: 0, holdBinding: false, submits: 0, previews: 0 };
  const bindingWaiters = new Set<() => void>();
  const releaseBinding = () => { control.holdBinding = false; for (const release of bindingWaiters) release(); bindingWaiters.clear(); };
  const bind = h.runtime.transitions.bind.bind(h.runtime.transitions);
  h.runtime.transitions.bind = async (transitionId) => {
    // Hold an actual committed producer until the observer has seen it. A guessed delay can finish while a busy
    // browser is rendering and cannot reliably prove the initiator closed during execution.
    if (control.holdBinding) await new Promise<void>((resolve) => bindingWaiters.add(resolve));
    if (control.bindDelayMs) await new Promise<void>((resolve) => setTimeout(resolve, control.bindDelayMs));
    return bind(transitionId);
  };
  const dispatch = registry.dispatch;
  registry.dispatch = async (request, context) => {
    if (request.method === "memory.operations.submit") control.submits++;
    if (request.method === "memory.transitions.preview") control.previews++;
    const result = await dispatch(request, context);
    const delay = request.method === "memory.operations.submit" ? control.submitDelayMs
      : request.method === "memory.transitions.preview" ? control.previewDelayMs : 0;
    if (delay) await new Promise<void>((resolve) => setTimeout(resolve, delay));
    return result;
  };
  const server = await startWsServer({ host: "127.0.0.1", port: 0, registry, connectionRegistry: connections, logger });
  return { h, owner, service, control, releaseBinding, subscriptions, url: `ws://127.0.0.1:${server.port}`,
    close: async () => { releaseBinding(); await server.close(); await owner.stop(); await e.stopEmergency(); await h.close(); } };
}
