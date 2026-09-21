import { describe, expect, it, vi } from "vitest";
import type { MemoryOnboardingChanged, MemoryOnboardingStatus, MemoryOperation } from "@taki/shared";
import { RpcDeadlineExceededError, rpcMethodPolicy } from "@/lib/rpc-deadline.js";
import { LocalOnboardingController, type LocalOnboardingClient } from "./local-onboarding-controller.ts";
import { onboardingOperation, onboardingPreview, onboardingRun, onboardingStatus, ONBOARDING_AT, ONBOARDING_OPERATION_ID } from "./local-onboarding-fixtures.ts";
import type { OnboardingAction } from "./local-onboarding-actions.ts";

const settle = () => new Promise((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function client(status = onboardingStatus()) {
  const changes = new Set<(changed: MemoryOnboardingChanged) => void>();
  const operations = new Set<(operation: MemoryOperation) => void>();
  return {
    memoryOnboardingStatus: vi.fn(async () => status),
    memoryOnboardingPreview: vi.fn(async () => onboardingPreview()),
    memoryOnboardingExceptions: vi.fn<LocalOnboardingClient["memoryOnboardingExceptions"]>(async () => ({ items: [], nextCursor: null })),
    memoryOnboardingExclude: vi.fn<LocalOnboardingClient["memoryOnboardingExclude"]>(async () => status),
    memoryOperationSubmit: vi.fn<LocalOnboardingClient["memoryOperationSubmit"]>(async () => onboardingOperation()),
    memoryOperationCancel: vi.fn<LocalOnboardingClient["memoryOperationCancel"]>(async () => onboardingOperation({ state: "cancelled", reason: "cancelled_before_claim", terminalAt: ONBOARDING_AT })),
    subscribeMemoryOnboarding: vi.fn<LocalOnboardingClient["subscribeMemoryOnboarding"]>(async () => undefined),
    subscribeMemoryOperations: vi.fn<LocalOnboardingClient["subscribeMemoryOperations"]>(async () => undefined),
    onMemoryOnboardingChanged: (handler: (changed: MemoryOnboardingChanged) => void) => { changes.add(handler); return () => { changes.delete(handler); }; },
    onMemoryOperationChanged: (handler: (operation: MemoryOperation) => void) => { operations.add(handler); return () => { operations.delete(handler); }; },
    changes, operations,
    push: (reason: MemoryOnboardingChanged["reason"] = "producer") => { for (const handler of changes) handler({ reason }); },
  } satisfies LocalOnboardingClient & Record<string, unknown>;
}

async function mounted(target = client()) {
  const sink = vi.fn();
  const controller = new LocalOnboardingController(sink);
  controller.setVisible(true);
  controller.replace(target);
  await settle();
  return { controller, sink, target };
}

function withAction(action: OnboardingAction, mode: MemoryOnboardingStatus["authority"]["mode"] = "legacy-markdown") {
  const initial = onboardingStatus();
  return onboardingStatus({ authority: { mode, epochId: mode === "canonical-local" ? "epoch-local-1" : null },
    run: ["prepare", "preview", "retry", "cancel"].includes(action) ? null : onboardingRun(),
    actions: { ...initial.actions, preview: true, prepare: action === "prepare", replace: action === "replace",
      resume: action === "resume", activate: action === "activate", recoverBinding: action === "recoverBinding", reconcileSources: action === "reconcileSources",
      cancelOperationId: action === "cancel" ? ONBOARDING_OPERATION_ID : null, retryOperationId: action === "retry" ? ONBOARDING_OPERATION_ID : null },
  });
}

describe("Local onboarding restoration", () => {
  it("waits for both subscriptions before discovery and never previews or mutates on mount", async () => {
    const target = client();
    const subscription = deferred<void>();
    target.subscribeMemoryOnboarding.mockReturnValueOnce(subscription.promise);
    const { controller } = await mounted(target);
    expect(target.subscribeMemoryOperations).toHaveBeenCalledTimes(1);
    expect(target.memoryOnboardingStatus).not.toHaveBeenCalled();
    await controller.execute("prepare");
    expect(target.memoryOperationSubmit).not.toHaveBeenCalled();
    subscription.resolve();
    await settle();
    expect(target.memoryOnboardingStatus).toHaveBeenCalledTimes(1);
    expect(target.memoryOnboardingPreview).not.toHaveBeenCalled();
    expect(controller.snapshot().stale).toBe(false);
  });

  it("locks failed subscriptions and recovers only through an explicit retry", async () => {
    const target = client();
    target.subscribeMemoryOperations.mockRejectedValueOnce(new Error("subscription refused"));
    const { controller } = await mounted(target);
    expect(controller.snapshot()).toMatchObject({ stale: true, loading: false, error: "subscription refused" });
    expect(target.memoryOnboardingStatus).not.toHaveBeenCalled();
    await controller.execute("preview");
    expect(target.memoryOnboardingPreview).not.toHaveBeenCalled();
    await controller.refresh();
    expect(controller.snapshot()).toMatchObject({ stale: false, error: null });
  });

  it("drops old-client reads and listeners and discovers a prior run on reconnect/remount", async () => {
    const first = client();
    const late = deferred<MemoryOnboardingStatus>();
    first.memoryOnboardingStatus.mockReturnValueOnce(late.promise);
    const { controller, sink } = await mounted(first);
    const second = client(onboardingStatus({ run: onboardingRun() }));
    controller.replace(second);
    await settle();
    expect(first.changes.size + first.operations.size).toBe(0);
    sink.mockClear();
    late.resolve(onboardingStatus());
    first.push();
    await settle();
    expect(sink).not.toHaveBeenCalled();
    expect(controller.snapshot().status?.run?.runId).toBe("run-local-1");
    controller.dispose();
    const remounted = await mounted(second);
    expect(remounted.controller.snapshot().status?.run?.runId).toBe("run-local-1");
    expect(second.memoryOperationSubmit).not.toHaveBeenCalled();
  });

  it("coalesces pushes during a read and discards the superseded frame", async () => {
    const target = client();
    const late = deferred<MemoryOnboardingStatus>();
    target.memoryOnboardingStatus.mockReturnValueOnce(late.promise);
    const { controller } = await mounted(target);
    target.push(); target.push("exclusion"); target.push("binding");
    expect(target.memoryOnboardingStatus).toHaveBeenCalledTimes(1);
    late.resolve(onboardingStatus({ run: onboardingRun({ runId: "obsolete" }) }));
    await settle();
    expect(target.memoryOnboardingStatus).toHaveBeenCalledTimes(2);
    expect(controller.snapshot().status?.run).toBeNull();
  });

  it("does no hidden reads or publishes, then refetches once on visibility restoration", async () => {
    const { controller, target, sink } = await mounted();
    controller.setVisible(false);
    sink.mockClear();
    target.push(); target.push("candidate");
    await controller.refresh();
    await controller.execute("preview");
    expect(target.memoryOnboardingStatus).toHaveBeenCalledTimes(1);
    expect(target.memoryOnboardingPreview).not.toHaveBeenCalled();
    expect(sink).not.toHaveBeenCalled();
    controller.setVisible(true);
    await settle();
    expect(target.memoryOnboardingStatus).toHaveBeenCalledTimes(2);
    expect(controller.snapshot().stale).toBe(false);
  });

  it("keeps one read in flight across hide/show and suppresses its old visibility result", async () => {
    const late = deferred<MemoryOnboardingStatus>();
    const target = client();
    target.memoryOnboardingStatus.mockReturnValueOnce(late.promise);
    const { controller } = await mounted(target);
    controller.setVisible(false);
    controller.setVisible(true);
    expect(target.memoryOnboardingStatus).toHaveBeenCalledTimes(1);
    late.resolve(onboardingStatus({ run: onboardingRun({ runId: "old-frame" }) }));
    await settle();
    expect(target.memoryOnboardingStatus).toHaveBeenCalledTimes(2);
    expect(controller.snapshot().status?.run).toBeNull();
  });

  it("retains last-good content but disables actions after a failed revalidation", async () => {
    const { controller, target } = await mounted();
    target.memoryOnboardingStatus.mockRejectedValueOnce(new Error("read deadline"));
    await controller.refresh();
    expect(controller.snapshot()).toMatchObject({ status: onboardingStatus(), stale: true, error: "read deadline" });
    await controller.execute("preview");
    expect(target.memoryOnboardingPreview).not.toHaveBeenCalled();
    await controller.refresh();
    expect(controller.snapshot().stale).toBe(false);
  });
});

describe("Local onboarding actions", () => {
  it.each([
    ["prepare", "legacy-markdown", { kind: "local.onboard.prepare", source: { mode: "new", previewId: "preview-1" } }],
    ["replace", "legacy-markdown", { kind: "local.onboard.prepare", source: { mode: "new", previewId: "preview-1", replaceRunId: "run-local-1" } }],
    ["resume", "legacy-markdown", { kind: "local.onboard.prepare", source: { mode: "resume", runId: "run-local-1" } }],
    ["retry", "legacy-markdown", { kind: "local.onboard.prepare", source: { mode: "retry", operationId: ONBOARDING_OPERATION_ID } }],
    ["activate", "legacy-markdown", { kind: "local.onboard.activate", runId: "run-local-1" }],
    ["recoverBinding", "canonical-local", { kind: "local.onboard.activate", runId: "run-local-1" }],
    ["reconcileSources", "legacy-markdown", { kind: "local.onboard.prepare", source: { mode: "resume", runId: "run-local-1" } }],
    ["reconcileSources", "canonical-local", { kind: "local.onboard.activate", runId: "run-local-1" }],
  ] as const)("routes %s in %s through the exact server-derived identity", async (action, mode, request) => {
    const { controller, target } = await mounted(client(withAction(action, mode)));
    if (action === "prepare" || action === "replace") {
      await controller.execute(action);
      expect(target.memoryOperationSubmit).not.toHaveBeenCalled();
      await controller.execute("preview");
    }
    await Promise.all([controller.execute(action), controller.execute(action)]);
    expect(target.memoryOperationSubmit).toHaveBeenCalledExactlyOnceWith(request);
    expect(controller.snapshot().feedback?.message).toContain("是否完成以最新状态为准");
  });

  it("uses only the server-provided cancellation id", async () => {
    const { controller, target } = await mounted(client(withAction("cancel")));
    await controller.execute("cancel");
    expect(target.memoryOperationCancel).toHaveBeenCalledExactlyOnceWith(ONBOARDING_OPERATION_ID);
    expect(target.memoryOperationSubmit).not.toHaveBeenCalled();
  });

  it("does not dispatch unsupported actions even when a run exists", async () => {
    const { controller, target } = await mounted(client(onboardingStatus({ run: onboardingRun() })));
    await controller.execute("activate"); await controller.execute("resume"); await controller.execute("cancel");
    expect(target.memoryOperationSubmit).not.toHaveBeenCalled();
    expect(target.memoryOperationCancel).not.toHaveBeenCalled();
  });

  it("discovers a lost submit reply without replay and keeps its outcome unknown until Core reports it", async () => {
    const { controller, target } = await mounted();
    await controller.execute("preview");
    target.memoryOperationSubmit.mockRejectedValueOnce(new RpcDeadlineExceededError("memory.operations.submit", 10, rpcMethodPolicy("memory.operations.submit")));
    const running = onboardingStatus({ operation: onboardingOperation({ state: "running" }) });
    target.memoryOnboardingStatus.mockResolvedValue(running);
    await controller.execute("prepare");
    expect(target.memoryOperationSubmit).toHaveBeenCalledTimes(1);
    expect(controller.snapshot()).toMatchObject({ status: running, busyKey: null, stale: false, feedback: { tone: "warn" } });
    expect(controller.snapshot().feedback?.message).toContain("操作结果未知");
    const replacement = client(running);
    controller.replace(replacement);
    await settle();
    expect(replacement.memoryOperationSubmit).not.toHaveBeenCalled();
  });

  it("ignores retired mutation and preview replies without overwriting a new generation", async () => {
    const { controller, target, sink } = await mounted();
    await controller.execute("preview");
    const late = deferred<MemoryOperation>();
    target.memoryOperationSubmit.mockReturnValueOnce(late.promise);
    const pending = controller.execute("prepare");
    const replacement = client(onboardingStatus({ run: onboardingRun() }));
    controller.replace(replacement);
    await settle();
    sink.mockClear();
    late.resolve(onboardingOperation());
    await pending;
    expect(sink).not.toHaveBeenCalled();
    expect(controller.snapshot().feedback).toBeNull();
    expect(replacement.memoryOnboardingStatus).toHaveBeenCalledTimes(1);
    const preview = deferred<ReturnType<typeof onboardingPreview>>();
    replacement.memoryOnboardingPreview.mockReturnValueOnce(preview.promise);
    const previewing = controller.execute("preview");
    controller.replace(client());
    await settle();
    preview.resolve(onboardingPreview(9));
    await previewing;
    expect(controller.snapshot().preview).toBeNull();
  });

  it("invalidates a candidate-bound preview and rejects its late replacement", async () => {
    const { controller, target } = await mounted(client(withAction("replace")));
    await controller.execute("preview");
    target.push("candidate");
    await settle();
    expect(controller.snapshot().preview).toBeNull();
    await controller.execute("replace");
    expect(target.memoryOperationSubmit).not.toHaveBeenCalled();
  });
});

describe("source diagnostics and exclusions", () => {
  const source = { sourceId: "unsupported-1", relativePath: "memory/old.txt", code: "UNSUPPORTED_FORMAT", canExclude: true };
  async function sources() {
    const target = client(withAction("resume"));
    target.memoryOnboardingExceptions.mockResolvedValue({ items: [source, { ...source, sourceId: "imported", canExclude: false }], nextCursor: "next" });
    return mounted(target);
  }

  it("excludes only the exact permitted source with a nonempty bounded reason", async () => {
    const { controller, target } = await sources();
    await controller.exclude("imported", "valid reason");
    await controller.exclude("missing", "valid reason");
    await controller.exclude(source.sourceId, " ");
    await controller.exclude(source.sourceId, "x".repeat(513));
    expect(target.memoryOnboardingExclude).not.toHaveBeenCalled();
    await Promise.all([controller.exclude(source.sourceId, "  unsupported personal format  "), controller.exclude(source.sourceId, "duplicate")]);
    expect(target.memoryOnboardingExclude).toHaveBeenCalledExactlyOnceWith({ runId: "run-local-1", sourceId: source.sourceId, reason: "unsupported personal format" });
    expect(target.memoryOnboardingStatus).toHaveBeenCalledTimes(2);
  });

  it("reloads source permissions after another client's exclusion and discards paginated stale rows", async () => {
    const { controller, target } = await sources();
    target.memoryOnboardingExceptions.mockResolvedValueOnce({ items: [{ ...source, sourceId: "page-2" }], nextCursor: null });
    await controller.loadMore();
    expect(controller.snapshot().exceptions?.items).toHaveLength(3);
    target.memoryOnboardingExceptions.mockResolvedValue({ items: [{ ...source, canExclude: false }], nextCursor: null });
    target.push("exclusion");
    await settle();
    expect(controller.snapshot().exceptions?.items).toHaveLength(1);
    await controller.exclude(source.sourceId, "reason");
    expect(target.memoryOnboardingExclude).not.toHaveBeenCalled();
  });

  it("keeps source-read failure visible and cannot exclude from old diagnostics", async () => {
    const { controller, target } = await sources();
    target.memoryOnboardingExceptions.mockRejectedValueOnce(new Error("diagnostics timeout"));
    await controller.refresh();
    expect(controller.snapshot()).toMatchObject({ exceptions: null, exceptionsError: "diagnostics timeout" });
    await controller.exclude(source.sourceId, "reason");
    expect(target.memoryOnboardingExclude).not.toHaveBeenCalled();
  });
});
