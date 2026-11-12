import { describe, expect, it, vi } from "vitest";
import type { ModelProfilesChanged, ModelProfilesResult } from "@taki/shared";
import { createModelProfilesController, INITIAL_MODEL_PROFILES } from "./model-profiles-controller.ts";

const flush = () => new Promise((done) => setImmediate(done));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; }
function fixture() {
  let change: (value: ModelProfilesChanged) => void = () => undefined;
  const order: string[] = [];
  const client = { modelProfiles: vi.fn(async (): Promise<ModelProfilesResult> => { order.push("read"); return { profiles: [] }; }),
    subscribeModelProfiles: vi.fn(async () => { order.push("subscribe"); }),
    onModelProfilesChanged: (handler: (value: ModelProfilesChanged) => void) => { order.push("handler"); change = handler; return vi.fn(); } };
  let state = INITIAL_MODEL_PROFILES;
  const controller = createModelProfilesController((next) => { state = next; });
  controller.setVisible(false); controller.replace(client);
  return { client, order, controller, state: () => state, change: () => change({ slots: ["main"] }) };
}

describe("profile read lifetime", () => {
  it("subscribes before reads, refreshes only on demand/push, and coalesces invalidations", async () => {
    const f = fixture(); expect(f.client.modelProfiles).not.toHaveBeenCalled();
    f.controller.setVisible(true); await flush();
    expect(f.order).toEqual(["handler", "subscribe", "read"]);
    const held = deferred<ModelProfilesResult>(); f.client.modelProfiles.mockReturnValueOnce(held.promise);
    f.change(); await flush(); f.change(); f.change(); held.resolve({ profiles: [] }); await flush();
    expect(f.client.modelProfiles).toHaveBeenCalledTimes(3);
    expect(f.state().fresh).toBe(true);
  });
  it("retains snapshots and hidden invalidations, fencing late old-generation responses", async () => {
    const f = fixture(); f.controller.setVisible(true); await flush();
    f.controller.setVisible(false); f.change(); expect(f.state().fresh).toBe(false);
    expect(f.client.modelProfiles).toHaveBeenCalledTimes(1);
    const held = deferred<ModelProfilesResult>(); f.client.modelProfiles.mockReturnValueOnce(held.promise);
    f.controller.setVisible(true); await flush(); f.controller.replace(null);
    held.resolve({ profiles: [] }); await flush();
    expect(f.state()).toMatchObject({ data: { profiles: [] }, fresh: false, pending: false, observation: 1 });
  });
  it("does not read after failed subscription and exposes recovery without polling", async () => {
    const f = fixture(); f.client.subscribeModelProfiles.mockRejectedValueOnce(new Error("offline"));
    f.controller.setVisible(true); await flush();
    expect(f.client.modelProfiles).not.toHaveBeenCalled(); expect(f.state().error).not.toBeNull();
    await f.controller.refresh(); expect(f.state().fresh).toBe(true);
  });
});
