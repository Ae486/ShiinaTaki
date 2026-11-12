import { JSONRPCErrorException } from "json-rpc-2.0";
import { describe, expect, it, vi } from "vitest";
import { CO_WATCHING_METHODS, CO_WATCHING_INVITATION_METHODS, JSON_RPC_ERROR_CODES, type CoWatchingChanged } from "@taki/shared";
import { coWatchingMethods } from "./ws-client-co-watching.ts";
import { createWsClient } from "./ws-client.ts";
import type { WsTransport } from "./ws-transport.ts";

describe("Co-Watching wire facade", () => {
  it("validates invitation read and command replies instead of treating malformed acknowledgements as consent", async () => {
    const requests = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async () => ({ characterId: "taki", invitation: null }));
    const methods = coWatchingMethods(<T>(method: string, params: unknown) => requests(method, params) as Promise<T>);
    expect(await methods.coWatchingInvitationRead("taki")).toEqual({ characterId: "taki", invitation: null });
    expect(requests).toHaveBeenCalledWith(CO_WATCHING_INVITATION_METHODS.read, { characterId: "taki" });
    requests.mockResolvedValueOnce({ status: "applied", action: "accept", session: null });
    await expect(methods.coWatchingInvitationRespond({ characterId: "taki", invitationId: "11111111-1111-4111-8111-111111111111",
      expectedVersion: 0, commandId: "22222222-2222-4222-8222-222222222222", action: "accept" })).rejects.toThrow();
  });
  it("shares Character setup, retries invalid ACKs and recognizes only exact missing-method support", async () => {
    const requests = vi.fn<(method: string, params: unknown) => Promise<unknown>>(async () => ({ ok: true }));
    const methods = coWatchingMethods(<T>(method: string, params: unknown) => requests(method, params) as Promise<T>);
    const first = methods.subscribeCoWatching("taki");
    expect(methods.subscribeCoWatching("taki")).toBe(first); expect(await first).toBe("supported");
    expect(requests).toHaveBeenCalledTimes(1);
    requests.mockResolvedValueOnce({ ok: false });
    await expect(methods.subscribeCoWatching("other")).rejects.toThrow();
    expect(await methods.subscribeCoWatching("other")).toBe("supported");
    requests.mockRejectedValueOnce(new JSONRPCErrorException("missing", JSON_RPC_ERROR_CODES.METHOD_NOT_FOUND));
    expect(await methods.subscribeCoWatching("old-core")).toBe("unsupported");
    requests.mockRejectedValueOnce(new Error("connection closed"));
    await expect(methods.subscribeCoWatching("closed")).rejects.toThrow("connection closed");
  });

  it("routes verified hints through the one inbound seam and retires them with the physical client", async () => {
    let message: (value: string) => void = () => undefined;
    const closeHandlers: Array<() => void> = [];
    const transport: WsTransport = { send() {}, close() {}, onOpen() {}, onMessage: (handler) => { message = handler; },
      onClose: (handler) => { closeHandlers.push(handler); } };
    const client = createWsClient({ transport }); const changes: CoWatchingChanged[] = [];
    client.onCoWatchingChanged((value) => changes.push(value));
    const deliver = (params: unknown) => message(JSON.stringify({ jsonrpc: "2.0", method: CO_WATCHING_METHODS.changed, params }));
    deliver({ characterId: "taki", revision: 1 }); await new Promise((resolve) => setImmediate(resolve));
    expect(changes).toEqual([{ characterId: "taki", revision: 1 }]);
    deliver({ characterId: "taki" }); await new Promise((resolve) => setImmediate(resolve));
    expect(changes).toHaveLength(1);
    closeHandlers.forEach((handler) => handler());
    deliver({ characterId: "taki", revision: 2 }); await new Promise((resolve) => setImmediate(resolve));
    expect(changes).toHaveLength(1);
  });
});
