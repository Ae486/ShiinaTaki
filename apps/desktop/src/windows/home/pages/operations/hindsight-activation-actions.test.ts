import { describe, expect, it, vi } from "vitest";
import type { MemoryActivationStatus, MemoryOperation } from "@taki/shared";
import { RpcDeadlineExceededError, rpcMethodPolicy } from "@/lib/rpc-deadline.js";
import { activationActionAllowed, activationBusyKey, activationRequest, dispatchActivation, type ActivationAction } from "./hindsight-activation-actions.ts";
import { activatedStatus, activationBank, activationOperation, activationStatus, admittedStatus, ACTIVATION_AT, ACTIVATION_OPERATION_ID, blockedStatus,
  committedUnavailableStatus, interruptedStatus, legacyStatus, missingBankStatus, runningStatus, unconfiguredStatus, unknownStatus } from "./hindsight-activation-fixtures.ts";
import { initialActivationState, type HindsightActivationState } from "./hindsight-activation-state.ts";
import { createMemoryOperationsController, type MemoryOperationsClient } from "./memory-operations-controller.ts";
import { bankStatus, hindsightStatus } from "./memory-authority-fixtures.ts";

const ACTIONS: ActivationAction[] = ["validate", "apply", "activate", "resume", "recoverBinding", "cancel"];
const settle = () => new Promise((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function client(status = activationStatus()) {
  const handlers = new Set<(operation: MemoryOperation) => void>();
  return {
    memoryAuthorityStatus: vi.fn(async () => hindsightStatus()),
    memoryActivationStatus: vi.fn(async () => status),
    memoryReplicaConfigure: vi.fn<MemoryOperationsClient["memoryReplicaConfigure"]>(async (bankId) => bankStatus(bankId)),
    memoryOperationSubmit: vi.fn<MemoryOperationsClient["memoryOperationSubmit"]>(async () => activationOperation()),
    memoryOperationCancel: vi.fn<MemoryOperationsClient["memoryOperationCancel"]>(async () => activationOperation({ state: "cancelled", reason: "cancelled_before_claim", terminalAt: ACTIVATION_AT })),
    memoryOperationList: vi.fn<MemoryOperationsClient["memoryOperationList"]>(async () => { throw new Error("Unexpected Tidy operation list read"); }),
    memoryOperationStatus: vi.fn<MemoryOperationsClient["memoryOperationStatus"]>(async () => { throw new Error("Unexpected Tidy operation status read"); }),
    subscribeMemoryOperations: vi.fn<MemoryOperationsClient["subscribeMemoryOperations"]>(async () => undefined),
    onMemoryOperationChanged: (handler: (operation: MemoryOperation) => void) => { handlers.add(handler); return () => { handlers.delete(handler); }; },
    onMemoryReplicaChanged: vi.fn<MemoryOperationsClient["onMemoryReplicaChanged"]>(() => () => undefined),
    handlers, push: () => { for (const handler of handlers) handler(activationOperation()); },
  } satisfies MemoryOperationsClient & Record<string, unknown>;
}

/** The hook's sink, reduced to a plain state cell so the controller/dispatch pair is exercised without React. */
function harness() {
  let state: HindsightActivationState = initialActivationState();
  const publish = vi.fn((patch: Partial<HindsightActivationState>) => { state = { ...state, ...patch }; });
  const controller = createMemoryOperationsController<MemoryActivationStatus>({
    loading: () => publish({ loading: true }),
    loaded: (status) => publish({ status, loading: false, error: null }),
    loadFailed: (cause) => publish({ loading: false, error: cause instanceof Error ? cause.message : String(cause) }),
    mutationStarted: (busyKey) => publish({ busyKey, feedback: null }),
    mutationSettled: (feedback) => publish({ busyKey: null, feedback }),
  }, (target) => target.memoryActivationStatus());
  return { controller, publish, snapshot: () => state, execute: (action: ActivationAction) => dispatchActivation(controller, state, action) };
}

async function mounted(target = client()) {
  const h = harness();
  h.controller.replace(target);
  await settle();
  return { ...h, target };
}

describe("Hindsight activation actions", () => {
  it("offers only what Core derived plus the setup kinds while unconfigured", () => {
    const allowed = (status: MemoryActivationStatus) => ACTIONS.filter((action) => activationActionAllowed(status, action));
    expect(allowed(legacyStatus())).toEqual([]);
    expect(allowed(unconfiguredStatus())).toEqual(["validate"]);
    expect(allowed(unconfiguredStatus("compatible"))).toEqual(["validate", "apply"]);
    expect(allowed(unconfiguredStatus("failed"))).toEqual(["validate", "apply"]);
    expect(allowed(unconfiguredStatus("unconfigured"))).toEqual(["validate"]);
    expect(allowed({ ...unconfiguredStatus("unconfigured"), authority: { mode: "hindsight", epochId: "epoch-hindsight" } })).toEqual([]);
    expect(allowed({ ...unconfiguredStatus("unconfigured"), operation: activationOperation({ state: "running" }) })).toEqual([]);
    expect(allowed(unconfiguredStatus("disabled"))).toEqual([]);
    expect(allowed(unconfiguredStatus("applying-templates"))).toEqual([]);
    expect(allowed({ ...unconfiguredStatus("compatible"), authority: { mode: "legacy-markdown", epochId: null } })).toEqual([]);
    expect(allowed(blockedStatus())).toEqual([]);
    expect(allowed(missingBankStatus())).toEqual(["apply"]);
    expect(allowed({ ...missingBankStatus(), operation: activationOperation({ state: "running" }) })).toEqual([]);
    expect(allowed(activationStatus())).toEqual(["activate"]);
    expect(allowed(admittedStatus())).toEqual(["cancel"]);
    expect(allowed({ ...admittedStatus(), setup: { phase: "compatible", revision: 3, configured: false } })).toEqual(["cancel"]);
    expect(allowed(runningStatus())).toEqual([]);
    expect(allowed(interruptedStatus())).toEqual(["resume"]);
    expect(allowed(unknownStatus())).toEqual(["resume"]);
    expect(allowed(committedUnavailableStatus())).toEqual(["recoverBinding"]);
    expect(allowed(activatedStatus())).toEqual([]);
  });

  it("builds every request from the status alone", () => {
    expect(activationRequest(unconfiguredStatus("unconfigured"), "validate")).toEqual({ kind: "setup.validate", expectedRevision: 2 });
    expect(activationRequest(unconfiguredStatus(), "validate")).toEqual({ kind: "setup.validate", expectedRevision: 2 });
    expect(activationRequest(unconfiguredStatus("compatible"), "apply")).toEqual({ kind: "setup.apply", expectedRevision: 2, characterId: "taki" });
    const twoCharacters = { ...unconfiguredStatus("compatible"), prerequisites: { blocking: [],
      banks: [activationBank("character", { characterId: "first", localBankId: "local-first" }), activationBank("character", { characterId: "second", localBankId: "local-second", verified: false, nativeBankId: null })] } };
    expect(activationRequest(twoCharacters, "apply")).toMatchObject({ characterId: "second" });
    const globalOnly = { ...unconfiguredStatus("compatible"), prerequisites: { banks: [activationBank("global", { verified: false, nativeBankId: null })], blocking: [] } };
    expect(activationRequest(globalOnly, "apply")).toMatchObject({ characterId: "taki" });
    expect(activationRequest(missingBankStatus(), "apply")).toEqual({ kind: "setup.apply", expectedRevision: 3, characterId: "taki" });
    expect(activationRequest(activationStatus(), "activate")).toEqual({ kind: "hindsight.activate", source: { mode: "new", setupRevision: 3, expectedEpochId: "epoch-local-1" } });
    expect(activationRequest(interruptedStatus(), "resume")).toEqual({ kind: "hindsight.activate", source: { mode: "resume", runId: "run-hindsight-1" } });
    expect(activationRequest(committedUnavailableStatus(), "recoverBinding")).toEqual({ kind: "hindsight.activate", source: { mode: "recover", epochId: "epoch-hindsight-1" } });
    expect(activationRequest(activationStatus(), "resume")).toBeNull();
    expect(activationRequest(activationStatus(), "validate")).toBeNull();
    expect(activationRequest(admittedStatus(), "cancel")).toBeNull();
    expect(activationBusyKey(admittedStatus(), "cancel")).toBe(`cancel:${ACTIVATION_OPERATION_ID}`);
    expect(activationBusyKey(activationStatus(), "activate")).toBe("hindsight:activate");
  });
});

describe("Hindsight activation dispatch through the generic controller", () => {
  it("subscribes before the first read, reads nothing for a late client and dispatches nothing on mount", async () => {
    const target = client();
    const subscription = deferred<void>();
    target.subscribeMemoryOperations.mockReturnValueOnce(subscription.promise);
    const h = harness();
    await h.execute("activate");
    expect(h.snapshot()).toMatchObject({ status: null, loading: true });
    h.controller.replace(target);
    await settle();
    expect(target.subscribeMemoryOperations).toHaveBeenCalledTimes(1);
    expect(target.memoryActivationStatus).not.toHaveBeenCalled();
    await h.execute("activate");
    expect(target.memoryOperationSubmit).not.toHaveBeenCalled();
    subscription.resolve();
    await settle();
    expect(target.memoryActivationStatus).toHaveBeenCalledTimes(1);
    expect(target.memoryAuthorityStatus).not.toHaveBeenCalled();
    expect(h.snapshot()).toMatchObject({ status: activationStatus(), loading: false, error: null });
  });

  it.each([
    ["validate", unconfiguredStatus("unconfigured"), { kind: "setup.validate", expectedRevision: 2 }],
    ["validate", unconfiguredStatus(), { kind: "setup.validate", expectedRevision: 2 }],
    ["apply", unconfiguredStatus("compatible"), { kind: "setup.apply", expectedRevision: 2, characterId: "taki" }],
    ["activate", activationStatus(), { kind: "hindsight.activate", source: { mode: "new", setupRevision: 3, expectedEpochId: "epoch-local-1" } }],
    ["resume", interruptedStatus(), { kind: "hindsight.activate", source: { mode: "resume", runId: "run-hindsight-1" } }],
    ["recoverBinding", committedUnavailableStatus(), { kind: "hindsight.activate", source: { mode: "recover", epochId: "epoch-hindsight-1" } }],
  ] as const)("serializes %s and re-reads the activation status after the reply", async (action, status, request) => {
    const { execute, target, snapshot } = await mounted(client(status));
    await Promise.all([execute(action), execute(action)]);
    expect(target.memoryOperationSubmit).toHaveBeenCalledExactlyOnceWith(request);
    expect(target.memoryActivationStatus).toHaveBeenCalledTimes(2);
    expect(snapshot()).toMatchObject({ busyKey: null, loading: false, feedback: { tone: "ok" } });
    expect(snapshot().feedback?.message).toContain("是否完成以最新状态为准");
  });

  it("cancels only through the server-provided id and refuses unsupported intents", async () => {
    const admitted = await mounted(client(admittedStatus()));
    await admitted.execute("activate"); await admitted.execute("resume");
    await admitted.execute("cancel");
    expect(admitted.target.memoryOperationCancel).toHaveBeenCalledExactlyOnceWith(ACTIVATION_OPERATION_ID);
    expect(admitted.target.memoryOperationSubmit).not.toHaveBeenCalled();
    const running = await mounted(client(runningStatus()));
    for (const action of ACTIONS) await running.execute(action);
    expect(running.target.memoryOperationSubmit).not.toHaveBeenCalled();
    expect(running.target.memoryOperationCancel).not.toHaveBeenCalled();
  });

  it("discovers a lost submit reply without replay and keeps the outcome unknown until Core reports it", async () => {
    const { execute, target, snapshot, controller } = await mounted();
    target.memoryOperationSubmit.mockRejectedValueOnce(new RpcDeadlineExceededError("memory.operations.submit", 10, rpcMethodPolicy("memory.operations.submit")));
    target.memoryActivationStatus.mockResolvedValue(runningStatus());
    await execute("activate");
    expect(target.memoryOperationSubmit).toHaveBeenCalledTimes(1);
    expect(target.memoryActivationStatus).toHaveBeenCalledTimes(2);
    expect(snapshot()).toMatchObject({ status: runningStatus(), busyKey: null, loading: false, feedback: { tone: "warn" } });
    expect(snapshot().feedback?.message).toContain("操作结果未知");
    const replacement = client(runningStatus());
    controller.replace(replacement);
    await settle();
    expect(replacement.memoryOperationSubmit).not.toHaveBeenCalled();
  });

  it("surfaces a Core refusal with its closed reason and still re-reads", async () => {
    const { execute, target, snapshot } = await mounted();
    target.memoryOperationSubmit.mockRejectedValueOnce(Object.assign(new Error("refused"), { data: { code: "MEMORY_OPERATION_REFUSED", reason: "MEMORY_OPERATION_BUSY" } }));
    await execute("activate");
    expect(snapshot().feedback).toEqual({ tone: "warn", message: "Core 拒绝了该操作：MEMORY_OPERATION_BUSY" });
    expect(target.memoryActivationStatus).toHaveBeenCalledTimes(2);
  });

  it("drops old-client reads, listeners and mutation replies on reconnect and never overwrites the new generation", async () => {
    const first = client();
    const late = deferred<MemoryActivationStatus>();
    first.memoryActivationStatus.mockReturnValueOnce(late.promise);
    const h = harness();
    h.controller.replace(first);
    await settle();
    const second = client(interruptedStatus());
    h.controller.replace(second);
    await settle();
    expect(first.handlers.size).toBe(0);
    h.publish.mockClear();
    late.resolve(activationStatus());
    first.push();
    await settle();
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.snapshot().status?.run?.status).toBe("failed");
    const reply = deferred<MemoryOperation>();
    second.memoryOperationSubmit.mockReturnValueOnce(reply.promise);
    const pending = h.execute("resume");
    const third = client();
    h.controller.replace(third);
    await settle();
    h.publish.mockClear();
    reply.resolve(activationOperation());
    await pending;
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.snapshot()).toMatchObject({ status: activationStatus(), feedback: null });
    expect(third.memoryOperationSubmit).not.toHaveBeenCalled();
  });

  it("does no hidden reads or publishes, then refetches exactly once when shown again", async () => {
    const { controller, target, publish } = await mounted();
    controller.replace(null);
    publish.mockClear();
    target.push(); target.push();
    await controller.refresh();
    await settle();
    expect(target.memoryActivationStatus).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
    controller.replace(target);
    await settle();
    expect(target.memoryActivationStatus).toHaveBeenCalledTimes(2);
    expect(target.subscribeMemoryOperations).toHaveBeenCalledTimes(2);
  });

  it("coalesces pushes that land mid-read and refetches on every changed push", async () => {
    const target = client();
    const late = deferred<MemoryActivationStatus>();
    target.memoryActivationStatus.mockReturnValueOnce(late.promise);
    const h = harness();
    h.controller.replace(target);
    await settle();
    target.push(); target.push(); target.push();
    expect(target.memoryActivationStatus).toHaveBeenCalledTimes(1);
    late.resolve(interruptedStatus());
    await settle();
    expect(target.memoryActivationStatus).toHaveBeenCalledTimes(2);
    expect(h.snapshot().status?.run).toBeNull();
    target.push();
    await settle();
    expect(target.memoryActivationStatus).toHaveBeenCalledTimes(3);
  });

  it("keeps last-good content but refuses actions after a failed revalidation until a read succeeds", async () => {
    const { execute, controller, target, snapshot } = await mounted();
    target.memoryActivationStatus.mockRejectedValueOnce(new Error("read deadline"));
    await controller.refresh();
    expect(snapshot()).toMatchObject({ status: activationStatus(), loading: false, error: "read deadline" });
    await execute("activate");
    expect(target.memoryOperationSubmit).not.toHaveBeenCalled();
    await controller.refresh();
    expect(snapshot()).toMatchObject({ error: null, loading: false });
    await execute("activate");
    expect(target.memoryOperationSubmit).toHaveBeenCalledTimes(1);
  });

  it("refuses unacknowledged reads and retries a failed subscription on explicit refresh", async () => {
    const target = client();
    target.subscribeMemoryOperations.mockRejectedValueOnce(new Error("subscription refused"));
    const { controller, snapshot } = await mounted(target);
    expect(snapshot()).toMatchObject({ status: null, error: "subscription refused", loading: false });
    expect(target.memoryActivationStatus).not.toHaveBeenCalled();
    await controller.refresh();
    expect(target.subscribeMemoryOperations).toHaveBeenCalledTimes(2);
    await controller.refresh();
    expect(target.subscribeMemoryOperations).toHaveBeenCalledTimes(2);
  });
});
