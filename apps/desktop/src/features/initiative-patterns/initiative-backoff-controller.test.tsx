import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { InitiativeBackoffChanged, InitiativeBackoffStatus } from "@taki/shared";
import type { WsClient } from "@/lib/ws-client.js";
import { INITIAL_BACKOFF_STATE, InitiativeBackoffController, type InitiativeBackoffState } from "./initiative-backoff-controller.ts";
import { InitiativeBackoffView } from "./initiative-backoff-view.tsx";
import { deferred } from "./pattern-test-fixtures.ts";

const snapshot: InitiativeBackoffStatus = { stage: "double", qualifiedWeakCount: 3, spacingMultiplier: 2, dailyJudgments: 1,
  nextEligibleAt: "2026-09-28T12:30:00.000Z", refusal: "backoff-spacing", lastResetAt: null, lastResetReason: null,
  windowSince: "2026-09-21T12:00:00.000Z", observedAt: "2026-09-28T12:00:00.000Z" };
const resetSnapshot: InitiativeBackoffStatus = { ...snapshot, stage: "normal", qualifiedWeakCount: 0, spacingMultiplier: 1,
  nextEligibleAt: null, refusal: null, lastResetAt: snapshot.observedAt, lastResetReason: "operator" };

function client() {
  const listeners = new Set<(event: InitiativeBackoffChanged) => void>();
  return {
    initiativeBackoffRead: vi.fn<WsClient["initiativeBackoffRead"]>(async () => snapshot),
    initiativeBackoffReset: vi.fn<WsClient["initiativeBackoffReset"]>(async () => resetSnapshot),
    onInitiativeBackoffChanged: (listener: (event: InitiativeBackoffChanged) => void) => {
      listeners.add(listener); return () => { listeners.delete(listener); };
    },
    changed: (characterId = "taki") => listeners.forEach((listener) => listener({ characterId })),
  };
}

function fixture() {
  let state: InitiativeBackoffState = INITIAL_BACKOFF_STATE;
  const publish = vi.fn((next: InitiativeBackoffState) => { state = next; });
  const controller = new InitiativeBackoffController(publish);
  return { controller, publish, state: () => state };
}

describe("same-Monitor backoff read and explicit reset", () => {
  it("does no disabled/hidden reads, restores on entry and preserves last-good evidence after failure", async () => {
    const f = fixture(), source = client(); f.controller.bind(source); source.changed(); await f.controller.refresh();
    expect(source.initiativeBackoffRead).not.toHaveBeenCalled();
    f.controller.setActive(true); await f.controller.refresh(); expect(f.state().data).toEqual(snapshot);
    source.changed("other"); expect(source.initiativeBackoffRead).toHaveBeenCalledTimes(1);
    source.initiativeBackoffRead.mockRejectedValueOnce(new Error("private-read-error"));
    await f.controller.refresh(); expect(f.state()).toMatchObject({ data: snapshot, stale: true, loading: false });
    expect(f.state().error).toContain("无法读取"); expect(f.state().error).not.toContain("private");
    await f.controller.reset(); expect(source.initiativeBackoffReset).not.toHaveBeenCalled();
    f.controller.setActive(false); source.changed(); expect(source.initiativeBackoffRead).toHaveBeenCalledTimes(2);
    f.controller.setActive(true); await f.controller.refresh(); expect(f.state().stale).toBe(false);
  });

  it("coalesces a finite invalidation burst and publishes only its covering response", async () => {
    const f = fixture(), source = client(), first = deferred<InitiativeBackoffStatus>();
    source.initiativeBackoffRead.mockReturnValueOnce(first.promise).mockResolvedValue(resetSnapshot);
    f.controller.setActive(true); f.controller.bind(source);
    source.changed(); source.changed(); source.changed();
    expect(source.initiativeBackoffRead).toHaveBeenCalledTimes(1);
    const completed = f.controller.refresh(); first.resolve(snapshot); await completed;
    expect(source.initiativeBackoffRead).toHaveBeenCalledTimes(2);
    expect(f.state().data).toEqual(resetSnapshot);
    expect(f.publish.mock.calls.some(([state]) => state.data === snapshot)).toBe(false);
  });

  it.each(["success", "failure"] as const)("ignores an old-client read %s after replacement", async (outcome) => {
    const f = fixture(), first = client(), slow = deferred<InitiativeBackoffStatus>();
    first.initiativeBackoffRead.mockReturnValueOnce(slow.promise);
    f.controller.setActive(true); f.controller.bind(first);
    const replacement = client(); replacement.initiativeBackoffRead.mockResolvedValue(resetSnapshot);
    f.controller.bind(replacement); await f.controller.refresh();
    if (outcome === "success") slow.resolve(snapshot); else slow.reject(new Error("private-old-error"));
    await Promise.resolve(); await Promise.resolve();
    expect(f.state()).toMatchObject({ data: resetSnapshot, stale: false, error: null });
  });

  it("keeps an accepted reset echo distinct from failed refresh and never claims that refresh succeeded", async () => {
    const f = fixture(), source = client(); f.controller.setActive(true); f.controller.bind(source); await f.controller.refresh();
    source.initiativeBackoffRead.mockRejectedValueOnce(new Error("refresh refused"));
    await f.controller.reset();
    expect(source.initiativeBackoffReset).toHaveBeenCalledExactlyOnceWith({ characterId: "taki" });
    expect(f.state()).toMatchObject({ data: resetSnapshot, pending: false, stale: true, feedback: { tone: "ok" } });
    expect(f.state().feedback?.message).toContain("已重置"); expect(f.state().error).toContain("无法读取");
    await f.controller.reset(); expect(source.initiativeBackoffReset).toHaveBeenCalledTimes(1);
    source.initiativeBackoffRead.mockResolvedValue(resetSnapshot); await f.controller.refresh();
    expect(f.state()).toMatchObject({ data: resetSnapshot, error: null, stale: false });
  });

  it("does not lose the covering refresh failure when reset invalidation starts a read before its echo", async () => {
    const f = fixture(), source = client(); f.controller.setActive(true); f.controller.bind(source); await f.controller.refresh();
    const beforeEcho = deferred<InitiativeBackoffStatus>(), afterEcho = deferred<InitiativeBackoffStatus>();
    source.initiativeBackoffRead.mockReturnValueOnce(beforeEcho.promise).mockReturnValueOnce(afterEcho.promise);
    source.initiativeBackoffReset.mockImplementationOnce(async () => { source.changed(); return resetSnapshot; });
    const pending = f.controller.reset();
    await vi.waitFor(() => expect(source.initiativeBackoffRead).toHaveBeenCalledTimes(3));
    beforeEcho.reject(new Error("superseded read failure")); afterEcho.reject(new Error("current read failure"));
    await pending;
    expect(f.state()).toMatchObject({ data: resetSnapshot, stale: true, pending: false, loading: false, feedback: { tone: "ok" } });
    expect(f.state().error).toContain("暂时无法读取退避状态");
    expect(source.initiativeBackoffReset).toHaveBeenCalledTimes(1);
    expect(source.initiativeBackoffRead).toHaveBeenCalledTimes(3);
  });

  it.each(["success", "failure"] as const)("retires a stale reset %s across null/replacement without replay or false success", async (outcome) => {
    const f = fixture(), first = client(), slow = deferred<InitiativeBackoffStatus>();
    f.controller.setActive(true); f.controller.bind(first); await f.controller.refresh();
    first.initiativeBackoffReset.mockReturnValueOnce(slow.promise); const pending = f.controller.reset();
    await f.controller.reset(); expect(first.initiativeBackoffReset).toHaveBeenCalledTimes(1);
    f.controller.bind(null); const next = client(); f.controller.bind(next); await f.controller.refresh();
    expect(f.state().feedback?.message).toContain("尚未确认");
    if (outcome === "success") slow.resolve(resetSnapshot); else slow.reject(new Error("late-private-error"));
    await pending;
    expect(next.initiativeBackoffReset).not.toHaveBeenCalled();
    expect(f.state()).toMatchObject({ data: snapshot, pending: false, feedback: { tone: "warn" } });
    expect(f.state().feedback?.message).not.toContain("已重置");
  });

  it("retains unknown reset outcome after a successful read and subsequent reconnect", async () => {
    const f = fixture(), source = client(); f.controller.setActive(true); f.controller.bind(source); await f.controller.refresh();
    source.initiativeBackoffReset.mockRejectedValueOnce(new Error("private-timeout")); await f.controller.reset();
    expect(f.state()).toMatchObject({ data: snapshot, stale: false, error: null, feedback: { tone: "warn" } });
    f.controller.bind(null); const next = client(); f.controller.bind(next); await f.controller.refresh();
    expect(f.state().feedback?.message).toContain("未能确认");
    expect(f.state().feedback?.message).not.toContain("private-timeout"); expect(next.initiativeBackoffReset).not.toHaveBeenCalled();
  });

  it("retains the mutation lock while hidden and reconciles once when shown after settlement", async () => {
    const f = fixture(), source = client(), slow = deferred<InitiativeBackoffStatus>();
    f.controller.setActive(true); f.controller.bind(source); await f.controller.refresh();
    source.initiativeBackoffReset.mockReturnValueOnce(slow.promise); const pending = f.controller.reset();
    f.controller.setActive(false); f.publish.mockClear(); source.changed();
    await f.controller.reset(); expect(source.initiativeBackoffReset).toHaveBeenCalledTimes(1);
    slow.resolve(resetSnapshot); await pending; expect(f.publish).not.toHaveBeenCalled();
    expect(source.initiativeBackoffRead).toHaveBeenCalledTimes(1);
    source.initiativeBackoffRead.mockResolvedValue(resetSnapshot); f.controller.setActive(true); await f.controller.refresh();
    expect(source.initiativeBackoffRead).toHaveBeenCalledTimes(2);
    expect(f.state()).toMatchObject({ data: resetSnapshot, pending: false, stale: false, feedback: { tone: "ok" } });
  });

  it("renders unknown separately from real zero and disables unavailable, stale or pending reset", () => {
    const actions = { refresh: vi.fn(), reset: vi.fn() };
    const cold = renderToStaticMarkup(<InitiativeBackoffView state={INITIAL_BACKOFF_STATE} available={false} {...actions} />);
    expect(cold.match(/未知/g)).toHaveLength(4); expect(cold).not.toContain("0 次");
    expect(cold).not.toContain("正常（1 倍间隔）"); expect(cold.match(/disabled=""/g)).toHaveLength(2);
    const state = { ...INITIAL_BACKOFF_STATE, data: resetSnapshot, stale: false };
    const known = renderToStaticMarkup(<InitiativeBackoffView state={state} available {...actions} />);
    expect(known).toContain("0 次"); expect(known).toContain("1 次判断"); expect(known).toContain("当前无退避等待");
    expect(known).not.toContain('disabled=""');
    for (const change of [{ stale: true }, { pending: true }, { loading: true }]) {
      const blocked = renderToStaticMarkup(<InitiativeBackoffView state={{ ...state, ...change }} available {...actions} />);
      expect(blocked).toMatch(/<button[^>]*disabled=""[^>]*>重置互动退避/);
    }
    for (const hidden of ["backoff-spacing", "qualifiedWeakCount", "lastResetReason", "characterId"]) expect(known).not.toContain(hidden);
  });
});
