import { describe, expect, it, vi } from "vitest";
import type { CoWatchingChanged, CoWatchingControlResult, CoWatchingReadResult } from "@taki/shared";
import type { ReadSubscriptionSupport } from "@/lib/ws-read-subscriptions.js";
import { createCoWatchingController, INITIAL_CO_WATCHING_STATE, type CoWatchingState } from "./co-watching-controller.ts";

const DATA: CoWatchingReadResult = { characterId: "taki", enabled: true, sources: [], analyses: [], session: null };
const selection = { sourceRef: "source", analysisId: "analysis", lifetimeMinutes: 120 };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture() {
  let state: CoWatchingState = INITIAL_CO_WATCHING_STATE;
  const states: CoWatchingState[] = [];
  const controller = createCoWatchingController("taki", (next) => { state = next; states.push(next); });
  const handlers = new Set<(event: CoWatchingChanged) => void>();
  const client = { coWatchingRead: vi.fn(async () => DATA),
    coWatchingStart: vi.fn(async (): Promise<CoWatchingControlResult> => ({ accepted: false, reason: "not_ready" })),
    coWatchingStop: vi.fn(async (): Promise<CoWatchingControlResult> => ({ accepted: false, reason: "not_found" })),
    subscribeCoWatching: vi.fn(async (): Promise<ReadSubscriptionSupport> => "supported"),
    onCoWatchingChanged: vi.fn((handler: (event: CoWatchingChanged) => void) => { handlers.add(handler); return () => { handlers.delete(handler); }; }) };
  return { controller, client, states, state: () => state, change: (revision: number, characterId = "taki") =>
    handlers.forEach((handler) => handler({ characterId, revision })) };
}

describe("Co-Watching observation and command lifetimes", () => {
  it("installs the handler before subscribe and absorbs pre-ACK hints into one baseline", async () => {
    const f = fixture(); const setup = deferred<ReadSubscriptionSupport>();
    f.client.subscribeCoWatching.mockImplementation(() => { expect(f.client.onCoWatchingChanged).toHaveBeenCalledTimes(1); return setup.promise; });
    f.controller.replace(f.client); const read = f.controller.refresh(); f.change(1); f.change(2);
    expect(f.client.coWatchingRead).not.toHaveBeenCalled(); setup.resolve("supported"); await read;
    expect(f.client.coWatchingRead).toHaveBeenCalledTimes(1); expect(f.state().stale).toBe(false);
    f.change(2); f.change(9, "other"); await flush(); expect(f.client.coWatchingRead).toHaveBeenCalledTimes(1);
  });
  it("does no reads or rendering while hidden and rejects a retired late response", async () => {
    const f = fixture(); f.controller.replace(f.client); await f.controller.refresh();
    const pending = deferred<CoWatchingReadResult>(); f.client.coWatchingRead.mockReturnValueOnce(pending.promise);
    const read = f.controller.refresh(); f.controller.setVisible(false); const count = f.states.length;
    f.change(1); f.change(2); pending.resolve({ ...DATA, enabled: false }); await read;
    expect(f.states).toHaveLength(count); expect(f.client.coWatchingRead).toHaveBeenCalledTimes(2);
    f.controller.setVisible(true); await f.controller.refresh(); expect(f.state().data?.enabled).toBe(true);
    expect(f.client.coWatchingRead).toHaveBeenCalledTimes(3);
  });
  it("fences old client success and failure and preserves interrupted-command uncertainty", async () => {
    const f = fixture(); f.controller.replace(f.client); await f.controller.refresh();
    const pending = deferred<CoWatchingControlResult>(); f.client.coWatchingStart.mockReturnValueOnce(pending.promise);
    const command = f.controller.start(selection); f.controller.replace(null);
    const second = fixture(); f.controller.replace(second.client); await f.controller.refresh();
    pending.resolve({ accepted: false, reason: "busy" }); await command;
    expect(f.state().commandError).toContain("上次操作结果尚未确认"); expect(second.client.coWatchingStart).not.toHaveBeenCalled();
    expect(f.state().pending).toBe(false);
  });
  it("keeps one mutation lock through hide/show and a retired covering read", async () => {
    const f = fixture(); f.controller.replace(f.client); await f.controller.refresh();
    const pending = deferred<CoWatchingControlResult>(); f.client.coWatchingStart.mockReturnValueOnce(pending.promise);
    const command = f.controller.start(selection); f.controller.setVisible(false); f.controller.setVisible(true);
    await f.controller.start(selection); expect(f.client.coWatchingStart).toHaveBeenCalledTimes(1);
    const covering = deferred<CoWatchingReadResult>(); f.client.coWatchingRead.mockReturnValueOnce(covering.promise);
    pending.resolve({ accepted: false, reason: "not_ready" }); await flush();
    f.controller.setVisible(false); f.controller.setVisible(true); await f.controller.start(selection);
    expect(f.client.coWatchingStart).toHaveBeenCalledTimes(1); covering.resolve(DATA); await command;
    expect(f.state()).toMatchObject({ pending: false, stale: false, data: DATA });
    expect(f.client.coWatchingRead).toHaveBeenCalledTimes(3);
  });
  it("coalesces bursts during a read and retains an actionable read failure without retry loops", async () => {
    const f = fixture(); f.controller.replace(f.client); await f.controller.refresh();
    const pending = deferred<CoWatchingReadResult>(); f.client.coWatchingRead.mockReturnValueOnce(pending.promise);
    f.change(1); f.change(2); f.change(3); pending.resolve({ ...DATA, enabled: false }); await flush();
    expect(f.client.coWatchingRead).toHaveBeenCalledTimes(3); expect(f.state().data).toBe(DATA);
    f.client.coWatchingRead.mockRejectedValueOnce(new Error("read failed")); f.change(4); await flush();
    expect(f.state()).toMatchObject({ error: "read failed", stale: true, data: DATA });
    expect(f.client.coWatchingRead).toHaveBeenCalledTimes(4);
    await f.controller.refresh(); expect(f.state().error).toBeNull();
  });
});
