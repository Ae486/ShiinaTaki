import { describe, expect, it, vi } from "vitest";
import type { ExtensionChanged, SkillPackageView } from "@taki/shared";
import { createSkillsController, type SkillClient, type SkillsState } from "./skills-controller.ts";
const ROW: SkillPackageView = { packageId: "11111111-1111-4111-8111-111111111111", skillName: "demo", description: "demo", ownerHostId: "22222222-2222-4222-8222-222222222222", contentHash: null, enabled: false, configRevision: 1, sourceKind: "directory", sourceLocator: "browser-directory", trust: "operator-local", scanVersion: "v1", scanVerdict: "passed", scanFindings: [], lifecycleState: "active", runtimeState: "disabled", catalogGeneration: null, createdAt: "2026-08-18T00:00:00.000Z", updatedAt: "2026-08-18T00:00:00.000Z", failureReason: null };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason?: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function inspected(files: string[], packageView = ROW) { return { package: packageView, metadata: null, files }; }
function client(list = Promise.resolve({ packages: [ROW], catalogGeneration: 1 })): SkillClient { return { subscribeExtensions: vi.fn(async () => "supported" as const), onExtensionChanged: vi.fn(() => () => undefined), skillList: vi.fn(() => list), skillInspect: vi.fn(async () => inspected(["references/a.txt"])), skillImport: vi.fn(async () => ({ package: ROW })), skillEnable: vi.fn(async () => ({ package: ROW })), skillDisable: vi.fn(async () => ({ package: ROW })), skillRemove: vi.fn(async () => ({ status: "removed" as const, packageId: ROW.packageId })), skillReconcile: vi.fn(async () => ({ checked: 1, invalidated: 0, catalogGeneration: 1 })) }; }

describe("Skills producer-driven list reads", () => {
  it("settles a failed write once and reconciles accepted hints without reopening an inspection", async () => {
    const active = client();
    const handlers = new Set<(event: ExtensionChanged) => void>();
    active.onExtensionChanged = (handler) => { handlers.add(handler); return () => { handlers.delete(handler); }; };
    const states: SkillsState[] = [];
    const controller = createSkillsController((state) => states.push(state));
    controller.bind(active);
    await controller.refresh();
    await controller.inspect(ROW.packageId);
    controller.setInspectionOpen(false);
    const write = deferred<{ package: SkillPackageView }>();
    vi.mocked(active.skillEnable).mockReturnValue(write.promise);
    const done = controller.setEnabled(ROW);
    for (const revision of [1, 2, 2]) for (const handler of handlers) handler({ revision, targets: ["skills"] });
    expect(active.skillList).toHaveBeenCalledTimes(1);
    vi.mocked(active.skillList).mockResolvedValue({ packages: [{ ...ROW, configRevision: 2 }], catalogGeneration: 2 });
    write.reject(new Error("partial operation failed"));
    expect(await done).toBe(false);
    expect(active.skillList).toHaveBeenCalledTimes(2);
    expect(active.skillEnable).toHaveBeenCalledTimes(1);
    expect(active.skillInspect).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toMatchObject({ pending: null, inspectOpen: false, inspectStale: true, message: "partial operation failed" });
    controller.bind(null);
    expect(handlers.size).toBe(0);
  });

  it("holds a failed setup without hidden or event retries and exposes a deliberate recovery", async () => {
    const active = client();
    const handlers = new Set<(event: ExtensionChanged) => void>();
    active.onExtensionChanged = (handler) => { handlers.add(handler); return () => { handlers.delete(handler); }; };
    vi.mocked(active.subscribeExtensions).mockRejectedValueOnce(new Error("setup lost"));
    const states: SkillsState[] = [];
    const controller = createSkillsController((state) => states.push(state));
    controller.bind(active);
    await controller.refresh();
    expect(states.at(-1)).toMatchObject({ kind: "failure", observation: "failure", readError: "setup lost" });
    controller.setVisible(false);
    const publications = states.length;
    for (let revision = 0; revision < 5; revision += 1) for (const handler of handlers) handler({ revision, targets: ["skills"] });
    await controller.refresh();
    expect(active.subscribeExtensions).toHaveBeenCalledTimes(1);
    expect(active.skillList).not.toHaveBeenCalled();
    expect(states).toHaveLength(publications);
    controller.setVisible(true);
    await controller.refresh();
    expect(active.subscribeExtensions).toHaveBeenCalledTimes(2);
    expect(active.skillList).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toMatchObject({ observation: "live", kind: "ready", readError: null });
    controller.bind(null);
  });
});
describe("Skills controller", () => {
  it("ignores retired-client reads and publishes only the current generation", async () => { const first = deferred<{ packages: []; catalogGeneration: number }>(); const states: SkillsState[] = []; const controller = createSkillsController((state) => states.push(state)); controller.bind(client(first.promise)); await new Promise((accept) => setImmediate(accept)); const second = client(); controller.bind(second); await controller.refresh(); first.resolve({ packages: [], catalogGeneration: 1 }); await new Promise((accept) => setImmediate(accept)); expect(states.at(-1)?.packages).toEqual([ROW]); });
  it("takes the mutation lock synchronously and never replays an unknown write", async () => { const write = deferred<{ package: typeof ROW }>(); const active = client(); vi.mocked(active.skillImport).mockReturnValue(write.promise); const controller = createSkillsController(() => undefined); controller.bind(active); await Promise.resolve(); const params = { source: { kind: "directory" as const, files: [{ path: "demo/SKILL.md", contentBase64: "eA==" }] } }; const first = controller.importPackage(params); const second = controller.importPackage(params); expect(await second).toBe(false); expect(active.skillImport).toHaveBeenCalledTimes(1); write.reject(new Error("unknown outcome")); expect(await first).toBe(false); expect(active.skillImport).toHaveBeenCalledTimes(1); });
  it("suppresses a mutation completion after the client retires", async () => { const write = deferred<{ package: typeof ROW }>(); const active = client(); vi.mocked(active.skillDisable).mockReturnValue(write.promise); const states: SkillsState[] = []; const controller = createSkillsController((state) => states.push(state)); controller.bind(active); await controller.refresh(); const pending = controller.setEnabled({ ...ROW, enabled: true, runtimeState: "available" }); controller.bind(client()); write.resolve({ package: ROW }); expect(await pending).toBe(false); await controller.refresh(); expect(states.at(-1)?.packages).toEqual([ROW]); });
  it("prevents older same-client refresh and inspect results from overwriting newer truth", async () => { const oldList = deferred<{ packages: SkillPackageView[]; catalogGeneration: number }>(); const fresh = { ...ROW, description: "fresh", configRevision: 2 }; const active = client(); const states: SkillsState[] = []; const controller = createSkillsController((state) => states.push(state)); controller.bind(active); await controller.refresh(); vi.mocked(active.skillList).mockReturnValueOnce(oldList.promise).mockResolvedValue({ packages: [fresh], catalogGeneration: 2 }); const staleRefresh = controller.refresh(); expect(await controller.setEnabled(ROW)).toBe(true); oldList.resolve({ packages: [], catalogGeneration: 1 }); await staleRefresh; expect(states.at(-1)?.packages).toEqual([fresh]); const oldInspect = deferred<{ package: SkillPackageView; metadata: null; files: string[] }>(); vi.mocked(active.skillInspect).mockReturnValueOnce(oldInspect.promise).mockResolvedValueOnce(inspected(["fresh.txt"], fresh)); const staleInspect = controller.inspect(ROW.packageId); controller.setInspectionOpen(false); await controller.inspect(ROW.packageId); oldInspect.resolve(inspected(["stale.txt"])); await staleInspect; expect(states.at(-1)?.inspected?.files).toEqual(["fresh.txt"]); });
});

describe("Skills demand and detail retirement", () => {
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it("restores after hide/show retires an accepted mutation's in-flight list reconciliation", async () => {
    const active = client();
    const pending = deferred<{ packages: SkillPackageView[]; catalogGeneration: number }>();
    vi.mocked(active.skillList).mockResolvedValueOnce({ packages: [ROW], catalogGeneration: 1 })
      .mockReturnValueOnce(pending.promise).mockResolvedValue({ packages: [ROW], catalogGeneration: 2 });
    const controller = createSkillsController(() => undefined);
    controller.bind(active);
    await controller.refresh();
    const done = controller.setEnabled(ROW);
    await flush();
    controller.setVisible(false);
    controller.setVisible(true);
    pending.resolve({ packages: [], catalogGeneration: 1 });
    await done;
    expect(active.skillList).toHaveBeenCalledTimes(3);
    expect(active.skillEnable).toHaveBeenCalledTimes(1);
  });

  it("joins duplicate list demand and coalesces an invalidation burst", async () => {
    const old = deferred<{ packages: SkillPackageView[]; catalogGeneration: number }>();
    const active = client(old.promise);
    vi.mocked(active.skillList).mockReturnValueOnce(old.promise).mockResolvedValue({ packages: [ROW], catalogGeneration: 2 });
    const states: SkillsState[] = [];
    const controller = createSkillsController((state) => states.push(state));
    controller.bind(active);
    const done = controller.refresh();
    void controller.refresh();
    await flush();
    expect(active.skillList).toHaveBeenCalledTimes(1);
    void controller.invalidate();
    void controller.invalidate();
    old.resolve({ packages: [], catalogGeneration: 1 });
    await done;
    expect(active.skillList).toHaveBeenCalledTimes(2);
    expect(states.filter((state) => state.kind === "ready").map((state) => state.packages)).toEqual([[ROW]]);
  });

  it("retains a valid inspection over unrelated list changes and collapse/reopen makes zero requests", async () => {
    const active = client();
    const states: SkillsState[] = [];
    const controller = createSkillsController((state) => states.push(state));
    controller.bind(active);
    await controller.refresh();
    await controller.inspect(ROW.packageId);
    controller.setInspectionOpen(false);
    vi.mocked(active.skillList).mockResolvedValue({ packages: [ROW, { ...ROW, packageId: "33333333-3333-4333-8333-333333333333" }], catalogGeneration: 2 });
    await controller.refresh();
    expect(states.at(-1)).toMatchObject({ inspectOpen: false, inspectStale: false });
    controller.setInspectionOpen(true);
    expect(active.skillInspect).toHaveBeenCalledTimes(1);
    await controller.inspect(ROW.packageId);
    expect(active.skillInspect).toHaveBeenCalledTimes(2);
  });

  it("ignores both success and failure from a closed inspection and waits for actual demand", async () => {
    for (const fail of [false, true]) {
      const active = client();
      const pending = deferred<ReturnType<typeof inspected>>();
      vi.mocked(active.skillInspect).mockReturnValue(pending.promise);
      const states: SkillsState[] = [];
      const controller = createSkillsController((state) => states.push(state));
      controller.bind(active);
      await controller.refresh();
      const done = controller.inspect(ROW.packageId);
      controller.setInspectionOpen(false);
      if (fail) pending.reject(new Error("late"));
      else pending.resolve(inspected(["late.txt"]));
      await done;
      expect(states.at(-1)).toMatchObject({ inspected: null, inspectOpen: false, inspectPending: null, inspectError: null });
      expect(active.skillInspect).toHaveBeenCalledTimes(1);
    }
  });

  it("invalidates only the changed package inspection and never inspects automatically", async () => {
    const active = client();
    const states: SkillsState[] = [];
    const controller = createSkillsController((state) => states.push(state));
    controller.bind(active);
    await controller.refresh();
    await controller.inspect(ROW.packageId);
    controller.setInspectionOpen(false);
    vi.mocked(active.skillList).mockResolvedValue({ packages: [{ ...ROW, configRevision: 2 }], catalogGeneration: 2 });
    await controller.refresh();
    expect(states.at(-1)).toMatchObject({ inspectStale: true, inspectOpen: false });
    controller.setInspectionOpen(true);
    expect(active.skillInspect).toHaveBeenCalledTimes(1);
  });

  it("retires an inspection when its selection or package identity changes", async () => {
    const active = client();
    const old = deferred<ReturnType<typeof inspected>>();
    vi.mocked(active.skillInspect).mockReturnValueOnce(old.promise);
    const states: SkillsState[] = [];
    const controller = createSkillsController((state) => states.push(state));
    controller.bind(active);
    await controller.refresh();
    const done = controller.inspect(ROW.packageId);
    vi.mocked(active.skillList).mockResolvedValue({ packages: [{ ...ROW, configRevision: 2 }], catalogGeneration: 2 });
    await controller.refresh();
    old.resolve(inspected(["retired.txt"]));
    await done;
    expect(states.at(-1)).toMatchObject({ inspected: null, inspectPending: null });
  });

  it("keeps a running mutation owned while hidden and reconciles once on return", async () => {
    const active = client();
    const write = deferred<{ package: SkillPackageView }>();
    vi.mocked(active.skillEnable).mockReturnValue(write.promise);
    const states: SkillsState[] = [];
    const controller = createSkillsController((state) => states.push(state));
    controller.bind(active);
    await controller.refresh();
    const done = controller.setEnabled(ROW);
    controller.setVisible(false);
    const hiddenPublications = states.length;
    await controller.invalidate();
    expect(await controller.setEnabled(ROW)).toBe(false);
    expect(active.skillEnable).toHaveBeenCalledTimes(1);
    write.resolve({ package: ROW });
    expect(await done).toBe(true);
    expect(states).toHaveLength(hiddenPublications);
    expect(active.skillList).toHaveBeenCalledTimes(1);
    controller.setVisible(true);
    expect(states.at(-1)?.pending).toBeNull();
    await flush();
    expect(active.skillList).toHaveBeenCalledTimes(2);
    expect(active.skillEnable).toHaveBeenCalledTimes(1);
  });
});
