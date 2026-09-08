import { describe, expect, it, vi } from "vitest";
import type { PermissionCellsState, PermissionLevelState } from "@taki/shared";
import { createPermissionController, type PermissionClient, type PermissionControllerSink } from "./permission-controller.ts";
import { RpcDeadlineExceededError } from "@/lib/rpc-deadline.js";

function snapshot(generation = 1): PermissionCellsState {
  return {
    level: "standard", policyGeneration: generation, registryRevision: 1,
    cells: [{ key: "screenshot", level: "standard", capabilityId: "screenshot", descriptorRevision: 1, factoryPosture: "ask", overridePosture: null, effectivePosture: "ask", approvalMemory: "rememberable", overrideMode: "ordinary" }],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

function client(overrides: Partial<PermissionClient> = {}): PermissionClient {
  return {
    permissionLevelGet: vi.fn(async (): Promise<PermissionLevelState> => ({ level: "standard", policyGeneration: 1, registryRevision: 1 })),
    permissionCellsGet: vi.fn(async () => snapshot()),
    permissionLevelSet: vi.fn(async (): Promise<PermissionLevelState> => ({ level: "relaxed", policyGeneration: 2, registryRevision: 1 })),
    permissionCellSet: vi.fn(async () => ({ policyGeneration: 2, registryRevision: 1, cell: snapshot().cells[0]! })),
    ...overrides,
  };
}

function harness() {
  const events: Array<{ kind: string; value?: unknown }> = [];
  const sink: PermissionControllerSink = {
    loading: (value) => events.push({ kind: "loading", value }),
    loaded: (value, feedback) => events.push({ kind: "loaded", value: { value, feedback } }),
    loadFailed: (value) => events.push({ kind: "loadFailed", value }),
    mutationStarted: (value) => events.push({ kind: "mutationStarted", value }),
    mutationFailed: (value) => events.push({ kind: "mutationFailed", value }),
  };
  return { controller: createPermissionController(sink), events };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe("permission controller generations", () => {
  it("joins coincident pair reads and retires both old successes and failures while hidden", async () => {
    const pending = deferred<PermissionLevelState>();
    const active = client({ permissionLevelGet: vi.fn(() => pending.promise) });
    const h = harness();
    h.controller.replace(active);
    const done = h.controller.refresh();
    void h.controller.refresh();
    expect(active.permissionLevelGet).toHaveBeenCalledTimes(1);
    expect(active.permissionCellsGet).toHaveBeenCalledTimes(1);
    h.controller.setVisible(false);
    pending.reject(new Error("retired"));
    await done;
    expect(h.events.some((event) => event.kind === "loadFailed")).toBe(false);
    vi.mocked(active.permissionLevelGet).mockResolvedValue({ level: "standard", policyGeneration: 1, registryRevision: 1 });
    h.controller.setVisible(true);
    await h.controller.refresh();
    expect(active.permissionCellsGet).toHaveBeenCalledTimes(2);
  });

  it("restores a post-mutation read retired by hide/show without replaying the policy write", async () => {
    const oldLevel = deferred<PermissionLevelState>();
    const oldCells = deferred<PermissionCellsState>();
    const active = client();
    vi.mocked(active.permissionLevelGet).mockResolvedValueOnce({ level: "standard", policyGeneration: 1, registryRevision: 1 })
      .mockReturnValueOnce(oldLevel.promise).mockResolvedValue({ level: "strict", policyGeneration: 3, registryRevision: 1 });
    vi.mocked(active.permissionCellsGet).mockResolvedValueOnce(snapshot()).mockReturnValueOnce(oldCells.promise)
      .mockResolvedValue({ ...snapshot(3), level: "strict" });
    const h = harness();
    h.controller.replace(active);
    await h.controller.refresh();
    const done = h.controller.setLevel("relaxed", 1);
    await flush();
    h.controller.setVisible(false);
    h.controller.setVisible(true);
    oldLevel.resolve({ level: "relaxed", policyGeneration: 2, registryRevision: 1 });
    oldCells.resolve({ ...snapshot(2), level: "relaxed" });
    await done;
    expect(active.permissionLevelGet).toHaveBeenCalledTimes(3);
    expect(active.permissionCellsGet).toHaveBeenCalledTimes(3);
    expect(active.permissionLevelSet).toHaveBeenCalledTimes(1);
    expect(h.events.at(-1)).toMatchObject({ kind: "loaded", value: { value: { cells: { policyGeneration: 3 } } } });
  });

  it("refetches every replacement client and suppresses late retired-client results", async () => {
    const oldLevel = deferred<PermissionLevelState>();
    const oldCells = deferred<PermissionCellsState>();
    const first = client({ permissionLevelGet: () => oldLevel.promise, permissionCellsGet: () => oldCells.promise });
    const second = client();
    const h = harness();
    h.controller.replace(first);
    h.controller.replace(second);
    await flush();
    oldLevel.resolve({ level: "standard", policyGeneration: 9, registryRevision: 1 });
    oldCells.resolve(snapshot(9));
    await flush();
    const loaded = h.events.filter((event) => event.kind === "loaded");
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.value).toMatchObject({ value: { cells: { policyGeneration: 1 } } });
  });

  it("reports cross-method snapshot drift through the validation-error path", async () => {
    const h = harness();
    h.controller.replace(client({
      permissionLevelGet: vi.fn(async (): Promise<PermissionLevelState> => ({
        level: "strict",
        policyGeneration: 1,
        registryRevision: 1,
      })),
    }));
    await flush();
    expect(h.events.at(-1)).toMatchObject({
      kind: "loadFailed",
      value: {
        name: "PermissionSnapshotValidationError",
        message: "Core returned inconsistent permission snapshots",
      },
    });
  });

  it("never replays a mutation on replacement and suppresses its late completion", async () => {
    const pending = deferred<PermissionLevelState>();
    const first = client({ permissionLevelSet: vi.fn(() => pending.promise) });
    const second = client();
    const h = harness();
    h.controller.replace(first);
    await flush();
    const mutation = h.controller.setLevel("relaxed", 1);
    h.controller.replace(second);
    pending.resolve({ level: "relaxed", policyGeneration: 2, registryRevision: 1 });
    await mutation;
    await flush();
    expect(first.permissionLevelSet).toHaveBeenCalledTimes(1);
    expect(second.permissionLevelSet).not.toHaveBeenCalled();
    const saved = h.events.filter((event) => event.kind === "loaded" && JSON.stringify(event.value).includes("saved"));
    expect(saved).toHaveLength(0);
  });

  it("enforces one global policy mutation in flight", async () => {
    const pending = deferred<PermissionLevelState>();
    const active = client({ permissionLevelSet: vi.fn(() => pending.promise), permissionCellSet: vi.fn() });
    const h = harness();
    h.controller.replace(active);
    await flush();
    const first = h.controller.setLevel("relaxed", 1);
    await h.controller.setCell({ key: "screenshot", level: "standard", posture: "auto" }, 1);
    expect(active.permissionCellSet).not.toHaveBeenCalled();
    pending.resolve({ level: "relaxed", policyGeneration: 2, registryRevision: 1 });
    await first;
  });

  it("reports a stale conflict and performs one explicit refetch without replay", async () => {
    let reads = 0;
    const active = client({
      permissionCellSet: vi.fn(async () => Promise.reject({ data: { code: "POLICY_CONFLICT", currentPolicyGeneration: 3 } })),
      permissionLevelGet: vi.fn(async (): Promise<PermissionLevelState> => reads === 0
        ? { level: "standard", policyGeneration: 1, registryRevision: 1 }
        : { level: "strict", policyGeneration: 3, registryRevision: 1 }),
      permissionCellsGet: vi.fn(async () => {
        const result = reads === 0 ? snapshot(1) : { ...snapshot(3), level: "strict" as const };
        reads += 1;
        return result;
      }),
    });
    const h = harness();
    h.controller.replace(active);
    await flush();
    await h.controller.setCell({ key: "screenshot", level: "standard", posture: null }, 1);
    expect(active.permissionCellSet).toHaveBeenCalledTimes(1);
    expect(active.permissionCellsGet).toHaveBeenCalledTimes(2);
    expect(h.events.at(-1)).toMatchObject({ kind: "loaded", value: { feedback: { kind: "conflict" } } });
  });

  it("sends the exact cell, level, posture and confirmation with the captured policy generation", async () => {
    const active = client({
      permissionLevelGet: vi.fn(async (): Promise<PermissionLevelState> => ({ level: "standard", policyGeneration: 7, registryRevision: 1 })),
      permissionCellsGet: vi.fn(async () => snapshot(7)),
    });
    const h = harness();
    h.controller.replace(active);
    await flush();
    await h.controller.setCell({ key: "exec:blocked", level: "standard", posture: "auto", secondConfirm: true }, 7);
    expect(active.permissionCellSet).toHaveBeenCalledWith({
      key: "exec:blocked",
      level: "standard",
      posture: "auto",
      secondConfirm: true,
      expectedPolicyGeneration: 7,
    });
  });

  it("does not replay a timed-out mutation whose remote outcome is unknown", async () => {
    const active = client({
      permissionLevelSet: vi.fn(async () => Promise.reject(new RpcDeadlineExceededError(
        "permission.levelSet",
        15_000,
        { class: "interactive", timing: "interactiveRpcMs", timeoutOutcome: "unknown" },
      ))),
    });
    const h = harness();
    h.controller.replace(active);
    await flush();
    await h.controller.setLevel("relaxed", 1);
    expect(active.permissionLevelSet).toHaveBeenCalledTimes(1);
    expect(active.permissionLevelGet).toHaveBeenCalledTimes(1);
    expect(h.events.at(-1)).toMatchObject({ kind: "mutationFailed" });
  });
});
