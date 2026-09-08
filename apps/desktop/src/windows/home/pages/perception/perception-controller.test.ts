import { describe, expect, it, vi } from "vitest";
import type { PerceptionCard, PerceptionPauseState, PerceptionChanged } from "@taki/shared";
import type { ReadSubscriptionSupport } from "@/lib/ws-read-subscriptions.js";
import { createPerceptionController, INITIAL_PERCEPTION_STATE, type PerceptionState } from "./perception-controller.ts";

const CARD: PerceptionCard = { current: null, recent: [], samplingStatus: { foreground: true, ambientScreen: false }, pauseState: { paused: false, until: null } };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (cause: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture() {
  let state: PerceptionState = INITIAL_PERCEPTION_STATE;
  const states: PerceptionState[] = [];
  const controller = createPerceptionController((next) => { state = next; states.push(next); });
  const handlers = new Set<(event: PerceptionChanged) => void>();
  const client = {
    perceptionCard: vi.fn(async () => CARD), perceptionPauseSet: vi.fn(async (): Promise<PerceptionPauseState> => ({ paused: true, until: null })),
    subscribePerception: vi.fn(async (): Promise<ReadSubscriptionSupport> => "supported"),
    onPerceptionChanged: vi.fn((handler: (event: PerceptionChanged) => void) => { handlers.add(handler); return () => { handlers.delete(handler); }; }),
  };
  return { controller, client, state: () => state, states, change: (revision: number) => { for (const handler of handlers) handler({ revision }); } };
}

describe("Perception producer observation", () => {
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  it("retains a populated activity snapshot throughout a deferred invalidation and commits the next snapshot directly", async () => {
    const f = fixture();
    const populated: PerceptionCard = { ...CARD,
      current: { processName: "Code.exe", windowTitle: "main.ts", startedAt: 1, durationMs: 60_000, samples: 2, idle: false },
      recent: [{ processName: "Browser.exe", windowTitle: "Earlier", startedAt: 0, durationMs: 60_000, samples: 2, idle: false }],
    };
    f.client.perceptionCard.mockResolvedValue(populated);
    f.controller.replace(f.client);
    await f.controller.refresh();
    const before = f.states.length;
    const pending = deferred<PerceptionCard>();
    f.client.perceptionCard.mockReturnValueOnce(pending.promise);
    const done = f.controller.invalidate();
    expect(f.state()).toMatchObject({ kind: "loading", stale: true });
    expect(f.state().card).toBe(populated);
    const next: PerceptionCard = { ...populated, current: { ...populated.current!, durationMs: 120_000 } };
    pending.resolve(next);
    await done;
    expect(f.states.slice(before).every((state) => state.card === populated || state.card === next)).toBe(true);
    expect(f.state()).toMatchObject({ kind: "ready", card: next, stale: false });
    f.controller.dispose();
  });

  it("waits for subscribed membership and folds all pre-baseline hints into one coherent read", async () => {
    const f = fixture();
    const setup = deferred<ReadSubscriptionSupport>();
    f.client.subscribePerception.mockReturnValue(setup.promise);
    f.controller.replace(f.client);
    const baseline = f.controller.refresh();
    expect(f.client.onPerceptionChanged).toHaveBeenCalledTimes(1);
    expect(f.client.perceptionCard).not.toHaveBeenCalled();
    f.change(1);
    f.change(2);
    setup.resolve("supported");
    await baseline;
    expect(f.client.subscribePerception).toHaveBeenCalledTimes(1);
    expect(f.client.perceptionCard).toHaveBeenCalledTimes(1);
    expect(f.state()).toMatchObject({ observation: "live", stale: false, pause: CARD.pauseState });
  });

  it("does no hidden setup-completion or hint work, then restores one card with fresh pause evidence", async () => {
    const f = fixture();
    const setup = deferred<ReadSubscriptionSupport>();
    f.client.subscribePerception.mockReturnValue(setup.promise);
    f.controller.replace(f.client);
    f.controller.setVisible(false);
    const publications = f.states.length;
    setup.resolve("supported");
    await flush();
    f.change(1);
    f.change(2);
    expect(f.states).toHaveLength(publications);
    expect(f.client.perceptionCard).not.toHaveBeenCalled();
    f.controller.setVisible(true);
    await f.controller.refresh();
    expect(f.client.perceptionCard).toHaveBeenCalledTimes(1);
    f.controller.setVisible(false);
    f.controller.setVisible(true);
    expect(f.state()).toMatchObject({ stale: true, pause: null });
    await f.controller.refresh();
    expect(f.client.perceptionCard).toHaveBeenCalledTimes(2);
  });

  it("leaves refused setup retryable without allowing notifications to trigger a retry loop", async () => {
    const f = fixture();
    f.client.subscribePerception.mockRejectedValueOnce(new Error("forbidden"));
    f.controller.replace(f.client);
    await f.controller.refresh();
    expect(f.state()).toMatchObject({ kind: "failure", observation: "failure", error: "forbidden", pause: null });
    for (let revision = 0; revision < 10; revision += 1) f.change(revision);
    expect(f.client.subscribePerception).toHaveBeenCalledTimes(1);
    expect(f.client.perceptionCard).not.toHaveBeenCalled();
    await f.controller.refresh();
    expect(f.client.subscribePerception).toHaveBeenCalledTimes(2);
    expect(f.client.perceptionCard).toHaveBeenCalledTimes(1);
    expect(f.state()).toMatchObject({ observation: "live", error: null });
  });

  it("qualifies older-Core manual coverage and reads only on explicit entry or refresh", async () => {
    const f = fixture();
    f.client.subscribePerception.mockResolvedValue("unsupported");
    f.controller.replace(f.client);
    await f.controller.refresh();
    await flush();
    expect(f.state().observation).toBe("unsupported");
    expect(f.client.perceptionCard).toHaveBeenCalledTimes(1);
    f.controller.setVisible(false);
    await f.controller.refresh();
    expect(f.client.perceptionCard).toHaveBeenCalledTimes(1);
    f.controller.setVisible(true);
    await f.controller.refresh();
    expect(f.client.perceptionCard).toHaveBeenCalledTimes(2);
  });

  it("coalesces own-write hints and ignores older or duplicate producer revisions", async () => {
    const f = fixture();
    f.controller.replace(f.client);
    await f.controller.refresh();
    const write = deferred<PerceptionPauseState>();
    f.client.perceptionPauseSet.mockReturnValue(write.promise);
    const done = f.controller.setPause({ paused: true });
    f.change(3);
    f.change(4);
    expect(f.client.perceptionCard).toHaveBeenCalledTimes(1);
    f.client.perceptionCard.mockResolvedValue({ ...CARD, pauseState: { paused: true, until: null } });
    write.resolve({ paused: true, until: null });
    await done;
    expect(f.client.perceptionCard).toHaveBeenCalledTimes(2);
    f.change(4);
    f.change(3);
    await flush();
    expect(f.client.perceptionCard).toHaveBeenCalledTimes(2);
    expect(f.state()).toMatchObject({ stale: false, pending: false, pause: { paused: true } });
  });

  it("reconciles an uncovered producer change after a failed pause attempt without losing its error", async () => {
    const f = fixture();
    f.controller.replace(f.client);
    await f.controller.refresh();
    const write = deferred<PerceptionPauseState>();
    f.client.perceptionPauseSet.mockReturnValue(write.promise);
    const done = f.controller.setPause({ paused: true });
    f.change(1);
    f.client.perceptionCard.mockResolvedValue({ ...CARD, pauseState: { paused: true, until: null } });
    write.reject(new Error("outcome unknown"));
    await done;
    expect(f.client.perceptionCard).toHaveBeenCalledTimes(2);
    expect(f.client.perceptionPauseSet).toHaveBeenCalledTimes(1);
    expect(f.state()).toMatchObject({ pending: false, stale: false, pause: { paused: true }, pauseError: "outcome unknown" });
    await f.controller.refresh();
    expect(f.state().pauseError).toBeNull();
  });
});
describe("Perception current read and pause authority", () => {
  it("restores one read when hide/show retires the reconciliation already awaiting a successful write", async () => {
    const f = fixture();
    const postWrite = deferred<PerceptionCard>();
    const paused = { ...CARD, pauseState: { paused: true, until: null } };
    f.client.perceptionCard.mockResolvedValueOnce(CARD).mockReturnValueOnce(postWrite.promise).mockResolvedValue(paused);
    f.controller.replace(f.client);
    await f.controller.refresh();
    const done = f.controller.setPause({ paused: true });
    await new Promise((resolve) => setImmediate(resolve));
    expect(f.client.perceptionCard).toHaveBeenCalledTimes(2);
    f.controller.setVisible(false);
    f.controller.setVisible(true);
    postWrite.resolve(CARD);
    await done;
    expect(f.client.perceptionCard).toHaveBeenCalledTimes(3);
    expect(f.client.perceptionPauseSet).toHaveBeenCalledTimes(1);
    expect(f.state()).toMatchObject({ pending: false, pause: paused.pauseState, stale: false });
  });

  it("removes current pause authority immediately after invalidation until a covering card arrives", async () => {
    const f = fixture();
    const paused = { ...CARD, pauseState: { paused: true, until: null } };
    f.client.perceptionCard.mockResolvedValue(paused);
    f.controller.replace(f.client);
    await f.controller.refresh();
    const pending = deferred<PerceptionCard>();
    f.client.perceptionCard.mockReturnValueOnce(pending.promise);
    const done = f.controller.invalidate();
    expect(f.state()).toMatchObject({ pause: paused.pauseState, stale: true });
    await f.controller.setPause({ paused: false });
    expect(f.client.perceptionPauseSet).not.toHaveBeenCalled();
    pending.resolve(paused);
    await done;
    expect(f.state().stale).toBe(false);
  });

  it("uses one coherent card baseline and joins coincident demand", async () => {
    const f = fixture();
    f.controller.replace(f.client);
    await f.controller.refresh();
    expect(f.client.perceptionCard).toHaveBeenCalledTimes(1);
    expect(f.state()).toMatchObject({ kind: "ready", card: CARD, pause: CARD.pauseState, stale: false });
  });

  it("coalesces an invalidation burst without publishing the older card", async () => {
    const f = fixture();
    const old = deferred<PerceptionCard>();
    const paused = { ...CARD, pauseState: { paused: true, until: null } };
    f.client.perceptionCard.mockReturnValueOnce(old.promise).mockResolvedValue(paused);
    f.controller.replace(f.client);
    const done = f.controller.refresh();
    await new Promise((resolve) => setImmediate(resolve));
    void f.controller.invalidate();
    void f.controller.invalidate();
    old.resolve(CARD);
    await done;
    expect(f.client.perceptionCard).toHaveBeenCalledTimes(2);
    expect(f.states.filter((state) => state.kind === "ready").map((state) => state.pause)).toEqual([paused.pauseState]);
  });

  it("does not restore pause from retained activity on retirement or a failed revalidation", async () => {
    const f = fixture();
    f.controller.replace(f.client);
    await f.controller.refresh();
    f.controller.replace(null);
    expect(f.state()).toMatchObject({ card: CARD, pause: null, stale: true });
    const fresh = { ...f.client, perceptionCard: vi.fn(async (): Promise<PerceptionCard> => { throw new Error("offline"); }) };
    f.controller.replace(fresh);
    await f.controller.refresh();
    expect(f.state()).toMatchObject({ kind: "failure", card: CARD, pause: null, stale: true, error: "offline" });
    fresh.perceptionCard.mockResolvedValue(CARD);
    await f.controller.refresh();
    expect(f.state()).toMatchObject({ kind: "ready", pause: CARD.pauseState, error: null });
  });

  it("retains confirmed controls during an ordinary refresh but retires hidden old success and failure", async () => {
    for (const failure of [false, true]) {
      const f = fixture();
      f.controller.replace(f.client);
      await f.controller.refresh();
      const old = deferred<PerceptionCard>();
      f.client.perceptionCard.mockReturnValueOnce(old.promise);
      const done = f.controller.refresh();
      expect(f.state().pause).toEqual(CARD.pauseState);
      f.controller.setVisible(false);
      const hiddenPublications = f.states.length;
      if (failure) old.reject(new Error("retired")); else old.resolve(CARD);
      await done;
      await f.controller.invalidate();
      expect(f.client.perceptionCard).toHaveBeenCalledTimes(2);
      expect(f.states).toHaveLength(hiddenPublications);
      f.controller.setVisible(true);
      expect(f.state()).toMatchObject({ pause: null, stale: true, error: null });
      await f.controller.refresh();
    }
  });

  it("keeps one pause write alive while hidden and reconciles once without replay", async () => {
    const f = fixture();
    const write = deferred<PerceptionPauseState>();
    f.client.perceptionPauseSet.mockReturnValue(write.promise);
    f.controller.replace(f.client);
    await f.controller.refresh();
    const done = f.controller.setPause({ paused: true });
    f.controller.setVisible(false);
    const hiddenPublications = f.states.length;
    await f.controller.setPause({ paused: false });
    await f.controller.invalidate();
    write.resolve({ paused: true, until: null });
    await done;
    expect(f.client.perceptionPauseSet).toHaveBeenCalledTimes(1);
    expect(f.client.perceptionCard).toHaveBeenCalledTimes(1);
    expect(f.states).toHaveLength(hiddenPublications);
    f.client.perceptionCard.mockResolvedValue({ ...CARD, pauseState: { paused: true, until: null } });
    f.controller.setVisible(true);
    expect(f.state()).toMatchObject({ pending: false, pause: null });
    await f.controller.refresh();
    expect(f.client.perceptionCard).toHaveBeenCalledTimes(2);
    expect(f.state().pause?.paused).toBe(true);
  });

  it("does not publish a retired pause write and clears a failed write notice only after a successful read", async () => {
    const f = fixture();
    const write = deferred<PerceptionPauseState>();
    f.client.perceptionPauseSet.mockReturnValueOnce(write.promise);
    f.controller.replace(f.client);
    await f.controller.refresh();
    const done = f.controller.setPause({ paused: true });
    f.controller.replace(null);
    write.resolve({ paused: true, until: null });
    await done;
    expect(f.state().pause).toBeNull();
    f.client.perceptionPauseSet.mockRejectedValueOnce(new Error("write failed"));
    f.controller.replace(f.client);
    await f.controller.refresh();
    await f.controller.setPause({ paused: true });
    expect(f.state()).toMatchObject({ pause: null, pauseError: "write failed", pending: false });
    await f.controller.refresh();
    expect(f.state()).toMatchObject({ pause: CARD.pauseState, pauseError: null });
  });
});
