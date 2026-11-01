import { describe, expect, it, vi } from "vitest";
import { CACHE_USAGE_METHODS, type CacheUsageUpdate } from "@taki/shared";
import { createWsClient } from "./ws-client.ts";
import type { WsTransport } from "./ws-transport.ts";
import { rpcMethodPolicy } from "./rpc-deadline.ts";

const update: CacheUsageUpdate = { revision: 4, snapshot: {
  scope: "all-observed-model-requests", characterId: "taki", summaryRevision: 6,
  summaryCommittedAt: "2026-11-01T10:00:00.000Z", boundary: "captured", status: "ready",
  computedAt: "2026-11-01T11:00:00.000Z", observedRequests: 3, pairedRequests: 2,
  inputTokens: 100, cacheReadTokens: 80, ratio: 0.8, reason: null,
} };

function harness() {
  const messages: Array<(data: string) => void> = [];
  const closed: Array<() => void> = [];
  const sent: string[] = [];
  const transport: WsTransport = {
    send: (payload) => { sent.push(payload); }, close: vi.fn(), onOpen: (handler) => { handler(); },
    onMessage: (handler) => { messages.push(handler); }, onClose: (handler) => { closed.push(handler); },
  };
  const client = createWsClient({ transport });
  const deliver = (value: unknown) => messages.forEach((handler) => handler(JSON.stringify(value)));
  const request = () => JSON.parse(sent.at(-1) ?? "{}") as { id: number; method: string; params: unknown };
  return { client, sent, deliver, request,
    reply: (result: unknown) => deliver({ jsonrpc: "2.0", id: request().id, result }),
    closed: () => closed.forEach((handler) => handler()),
  };
}

describe("cache aggregate WS boundary", () => {
  it("validates initial snapshots and explicit unsubscribe acknowledgements", async () => {
    const h = harness();
    const subscribing = h.client.subscribeCacheUsage({ characterId: "taki" });
    expect(h.request()).toMatchObject({ method: CACHE_USAGE_METHODS.subscribe, params: { characterId: "taki" } });
    h.reply(update);
    await expect(subscribing).resolves.toEqual(update);
    const unsubscribing = h.client.unsubscribeCacheUsage();
    expect(h.request()).toMatchObject({ method: CACHE_USAGE_METHODS.unsubscribe, params: {} });
    h.reply({ status: "ok" });
    await expect(unsubscribing).resolves.toBeUndefined();
    const invalid = h.client.subscribeCacheUsage({ characterId: "taki" });
    h.reply({ ...update, snapshot: { ...update.snapshot, ratio: 0.6 } });
    await expect(invalid).rejects.toThrow();
    h.client.close();
  });

  it("rejects unexpected fields in unsubscribe responses", async () => {
    const h = harness();
    const pending = h.client.unsubscribeCacheUsage();
    h.reply({ status: "ok", privatePayload: "must-not-enter-ui" });
    await expect(pending).rejects.toThrow();
    h.client.close();
  });

  it("validates pushes, isolates observers and retires all handlers on close", () => {
    const h = harness();
    const good = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      h.client.onCacheUsageChanged(() => { throw new Error("private-error"); });
      const remove = h.client.onCacheUsageChanged(good);
      const push = (params: unknown) => h.deliver({ jsonrpc: "2.0", method: CACHE_USAGE_METHODS.changed, params });
      push(update);
      expect(good).toHaveBeenCalledWith(update);
      push({ ...update, unexpected: "private-payload" });
      expect(good).toHaveBeenCalledTimes(1);
      remove(); push(update);
      expect(good).toHaveBeenCalledTimes(1);
      h.client.onCacheUsageChanged(good);
      h.closed(); push(update);
      expect(good).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls.flat().join(" ")).not.toMatch(/private-error|private-payload/);
    } finally { warn.mockRestore(); h.client.close(); }
  });

  it("treats membership deadlines as read-only and never replays an in-flight subscription", async () => {
    expect(rpcMethodPolicy(CACHE_USAGE_METHODS.subscribe)).toMatchObject({ class: "interactive", timeoutOutcome: "read-only" });
    expect(rpcMethodPolicy(CACHE_USAGE_METHODS.unsubscribe)).toMatchObject({ timeoutOutcome: "read-only" });
    const h = harness();
    const pending = h.client.subscribeCacheUsage({ characterId: "taki" });
    const rejected = expect(pending).rejects.toThrow("connection closed");
    h.closed(); await rejected;
    h.reply(update);
    expect(h.sent).toHaveLength(1);
    h.client.close();
  });
});
