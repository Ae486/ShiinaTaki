import { describe, expect, it, vi } from "vitest";
import { CO_WATCHING_METHODS, CO_WATCHING_INVITATION_METHODS } from "@taki/shared";
import type { ViewingInvitationSource } from "../../co-watching/viewing-invitation-source.ts";
import type { CoWatchingRuntime } from "../../co-watching/runtime.ts";
import type { CoWatchingCatalog } from "../../co-watching/analysis-catalog.ts";
import { createConnectionRegistry } from "../connection-registry.ts";
import { createMethodRegistry, type MethodContext } from "../method-registry.ts";
import { createCoWatchingSubscriptions, registerCoWatchingMethods } from "./co-watching-methods.ts";

function fixture() {
  const connections = createConnectionRegistry(); const registry = createMethodRegistry();
  const subscriptions = createCoWatchingSubscriptions();
  const runtime: CoWatchingRuntime = { read: vi.fn((characterId) => ({ characterId, enabled: false, sources: [], analyses: [], session: null })),
    context: () => "", yieldToPrimary: vi.fn(), invite: vi.fn(() => ({ accepted: false, reason: "not_ready" } as const)),
    start: vi.fn(() => ({ accepted: false, reason: "not_ready" } as const)), stop: vi.fn(() => ({ accepted: false, reason: "not_found" } as const)),
    revise: vi.fn(() => ({ accepted: false, reason: "not_found" } as const)), playbackChanged: vi.fn(), released: vi.fn(), close: async () => undefined };
  const catalog: CoWatchingCatalog = { list: () => [], get: () => undefined, request: () => undefined,
    reserve: () => { throw new Error("unused"); }, bind: () => { throw new Error("unused"); }, remove: vi.fn(), register: () => { throw new Error("unused"); } };
  const invitations: ViewingInvitationSource = { facts: () => [], isCurrent: () => true, admitted: () => true,
    prepareInput: async () => undefined, read: vi.fn((characterId) => ({ characterId, invitation: null })),
    respond: vi.fn(() => ({ status: "refused", reason: "not_found" } as const)), changed: vi.fn(), close: vi.fn() };
  registerCoWatchingMethods(registry, { connections, subscriptions, runtime, catalog, invitations });
  function peer(role: "operator" | "node" = "operator") {
    const connection = connections.create(); connections.authenticate(connection, { deviceId: "same", role, capabilities: [] });
    const notify = vi.fn(); const closes: Array<() => void> = [];
    const ctx: MethodContext = { connection, notify, close() {}, onClose: (cb) => { closes.push(cb); } };
    return { ctx, notify, closes };
  }
  const read = { jsonrpc: "2.0" as const, id: 1, method: CO_WATCHING_METHODS.read, params: { characterId: "taki" } };
  return { registry, connections, subscriptions, runtime, invitations, peer, read };
}
describe("operator-only Co-Watching methods", () => {
  it("refuses Node, copied identity and retired operator before runtime access", async () => {
    const f = fixture(); const node = f.peer("node"); const operator = f.peer();
    expect(await f.registry.dispatch(f.read, node.ctx)).toMatchObject({ error: { data: { code: "FORBIDDEN" } } });
    expect(await f.registry.dispatch(f.read, { ...operator.ctx, connection: { ...operator.ctx.connection } }))
      .toMatchObject({ error: { data: { code: "FORBIDDEN" } } });
    f.connections.remove(operator.ctx.connection);
    expect(await f.registry.dispatch(f.read, operator.ctx)).toMatchObject({ error: { data: { code: "FORBIDDEN" } } });
    expect(f.runtime.read).not.toHaveBeenCalled();
  });
  it("subscribes once, emits monotonically versioned Character hints and cleans up on close", async () => {
    const f = fixture(); const operator = f.peer();
    const request = { ...f.read, method: CO_WATCHING_METHODS.subscribe };
    await f.registry.dispatch(request, operator.ctx); await f.registry.dispatch(request, operator.ctx);
    expect(operator.closes).toHaveLength(1); expect(operator.notify).not.toHaveBeenCalled();
    f.subscriptions.publish("taki"); f.subscriptions.publish("*");
    expect(operator.notify.mock.calls).toEqual([[CO_WATCHING_METHODS.changed, { characterId: "taki", revision: 1 }],
      [CO_WATCHING_METHODS.changed, { characterId: "taki", revision: 2 }]]);
    operator.closes[0]!(); f.subscriptions.publish("taki"); expect(operator.notify).toHaveBeenCalledTimes(2);
  });
  it("binds invitation consent to the actual live operator socket and rejects Node/copied/retired callers", async () => {
    const f = fixture(); const operator = f.peer(); const node = f.peer("node");
    const request = { ...f.read, method: CO_WATCHING_INVITATION_METHODS.respond, params: {
      characterId: "taki", invitationId: "11111111-1111-4111-8111-111111111111", expectedVersion: 0,
      commandId: "22222222-2222-4222-8222-222222222222", action: "accept" } };
    expect(await f.registry.dispatch(request, node.ctx)).toMatchObject({ error: { data: { code: "FORBIDDEN" } } });
    expect(await f.registry.dispatch(request, { ...operator.ctx, connection: { ...operator.ctx.connection } }))
      .toMatchObject({ error: { data: { code: "FORBIDDEN" } } });
    expect(f.invitations.respond).not.toHaveBeenCalled();
    await f.registry.dispatch(request, operator.ctx);
    expect(f.invitations.respond).toHaveBeenCalledWith(request.params, { connection: operator.ctx.connection });
    f.connections.remove(operator.ctx.connection); await f.registry.dispatch(request, operator.ctx);
    expect(f.invitations.respond).toHaveBeenCalledTimes(1);
  });
});
