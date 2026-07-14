/**
 * INPUT:  a fake WsTransport (no real WebSocket) fed hand-built JSON-RPC frames.
 * OUTPUT: assertions that inbound frames route to the right handler (chat stream, avatar push, connect outcome) and
 *         that invalid frames are dropped without throwing — the zod boundary contract.
 * POS:    unit test for the operator WS client (F1). Node-safe via the injected transport. Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import { AVATAR_METHODS, CHAT_METHODS, CONNECT_METHOD, JSON_RPC_APP_ERROR } from "@taki/shared";
import { createWsClient } from "./ws-client.ts";
import type { WsTransport } from "./ws-transport.ts";

interface Harness {
  transport: WsTransport;
  sent: string[];
  deliver: (frame: unknown) => void;
  open: () => void;
}

function harness(): Harness {
  const messageHandlers: Array<(data: string) => void> = [];
  const openHandlers: Array<() => void> = [];
  const sent: string[] = [];
  return {
    transport: {
      send: (payload) => sent.push(payload),
      close: () => undefined,
      onMessage: (handler) => messageHandlers.push(handler),
      onOpen: (handler) => openHandlers.push(handler),
      onClose: () => undefined,
    },
    sent,
    deliver: (frame) => messageHandlers.forEach((handler) => handler(JSON.stringify(frame))),
    open: () => openHandlers.forEach((handler) => handler()),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function lastRequestId(sent: string[]): number | string {
  return JSON.parse(sent[sent.length - 1] ?? "{}").id;
}

describe("createWsClient inbound routing", () => {
  it("streams chat deltas to the active turn and settles on complete", async () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    h.open();
    const deltas: string[] = [];
    let completed = false;
    const turn = client.chat(
      { characterId: "taki", message: "hi" },
      { onDelta: (delta) => deltas.push(delta), onComplete: () => (completed = true) },
    );
    await flush();
    const id = lastRequestId(h.sent);
    h.deliver({ jsonrpc: "2.0", id, result: { messageId: "m1" } });
    for (const delta of ["Hel", "lo"]) {
      h.deliver({ jsonrpc: "2.0", method: CHAT_METHODS.delta, params: { messageId: "m1", characterId: "taki", delta } });
    }
    h.deliver({ jsonrpc: "2.0", method: CHAT_METHODS.complete, params: { messageId: "m1", characterId: "taki" } });
    await turn;
    expect(deltas).toEqual(["Hel", "lo"]);
    expect(completed).toBe(true);
  });

  it("routes an avatar.command push to the registered handler (zod-validated)", () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    const received: unknown[] = [];
    client.onAvatarCommand((command) => received.push(command));
    h.open();
    h.deliver({
      jsonrpc: "2.0",
      method: AVATAR_METHODS.command,
      params: { characterId: "taki", kind: "expression", name: "smile01" },
    });
    expect(received).toEqual([{ characterId: "taki", kind: "expression", name: "smile01" }]);
  });

  it("drops an invalid inbound frame without throwing", () => {
    const h = harness();
    createWsClient({ transport: h.transport });
    h.open();
    expect(() => h.deliver({ not: "a jsonrpc frame" })).not.toThrow();
  });

  it("connect returns ok and exposes a freshly issued token", async () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    h.open();
    const outcome = client.connect({ deviceId: "d", deviceName: "pet", role: "operator", capabilities: [] });
    await flush();
    expect(JSON.parse(h.sent[h.sent.length - 1] ?? "{}").method).toBe(CONNECT_METHOD);
    h.deliver({ jsonrpc: "2.0", id: lastRequestId(h.sent), result: { status: "ok", token: "tok" } });
    expect(await outcome).toEqual({ ok: true, token: "tok" });
  });

  it("connect surfaces PAIRING_REQUIRED from an app-error response", async () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    h.open();
    const outcome = client.connect({ deviceId: "d", deviceName: "pet", role: "operator", capabilities: [] });
    await flush();
    h.deliver({
      jsonrpc: "2.0",
      id: lastRequestId(h.sent),
      error: { code: JSON_RPC_APP_ERROR, message: "pairing required", data: { code: "PAIRING_REQUIRED" } },
    });
    expect(await outcome).toEqual({ ok: false, code: "PAIRING_REQUIRED", message: "pairing required" });
  });
});
