/**
 * INPUT: delayed native registration and effective visibility changes against the real shared controller.
 * OUTPUT: generation/cleanup and hidden-content regression coverage without another DOM library.
 * POS: Home QQ native lifecycle tests; no Core, live QQ, files or application credentials.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManagementTransport } from "@qqmm/management-client";
import { observeQqmmSession, type QqmmView } from "./qqmm-session.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const calls: string[] = [];
  const transport = { request: vi.fn(async (command: string) => { calls.push(command); throw new Error("offline fixture"); }), subscribe: () => () => {}, close: vi.fn(async () => { calls.push("close"); }) } as unknown as ManagementTransport & { close(): Promise<void> };
  return { transport, calls };
}

const disposers: (() => void)[] = [];
afterEach(async () => { for (const dispose of disposers.splice(0)) dispose(); await new Promise((done) => setTimeout(done, 0)); });

describe("QQ native lifecycle", () => {
  it("serializes retired async registration cleanup before the successor opens", async () => {
    const first = fixture(); const second = fixture();
    const pending = deferred<typeof first.transport>();
    const order: string[] = [];
    const firstClose = vi.spyOn(first.transport, "close").mockImplementation(async () => { order.push("close retired"); });
    const oldPublish = vi.fn();
    const retire = observeQqmmSession({ open: () => { order.push("open retired"); return pending.promise; }, visible: () => true, observeVisibility: () => () => {}, publish: oldPublish });
    await Promise.resolve(); retire();
    disposers.push(observeQqmmSession({ open: async () => { order.push("open successor"); return second.transport; }, visible: () => false, observeVisibility: () => () => {}, publish: vi.fn() }));
    pending.resolve(first.transport);
    await vi.waitFor(() => expect(order).toEqual(["open retired", "close retired", "open successor"]));
    expect(oldPublish).not.toHaveBeenCalled(); expect(firstClose).toHaveBeenCalledOnce();
  });

  it("observes actual route/document visibility and cancels shared polling when hidden", async () => {
    const { transport, calls } = fixture();
    let visible = false; let change = () => {}; let view: QqmmView | null = null;
    const remove = vi.fn();
    disposers.push(observeQqmmSession({ open: async () => transport, visible: () => visible, observeVisibility: (handler) => { change = handler; return remove; }, publish: (next) => { view = next; } }));
    await vi.waitFor(() => expect(view).not.toBeNull());
    expect(calls).toEqual([]);
    visible = true; change(); await vi.waitFor(() => expect(calls).toContain("attach"));
    const controller = view!.controller!;
    const hide = vi.spyOn(controller, "setVisible");
    visible = false; change(); expect(hide).toHaveBeenCalledWith(false);
    expect(controller.getState().records).toEqual([]); expect(controller.getState().detail).toBeNull();
    change(); expect(hide).toHaveBeenCalledTimes(1);
    disposers.pop()!(); expect(remove).toHaveBeenCalledOnce();
  });
});
