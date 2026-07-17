/**
 * INPUT:  a fake WsTransport (no real WebSocket) fed hand-built JSON-RPC frames.
 * OUTPUT: assertions that inbound frames route to the right handler (chat stream, avatar push, connect outcome) and
 *         that invalid frames are dropped without throwing — the zod boundary contract.
 * POS:    unit test for the operator WS client (F1). Node-safe via the injected transport. Exempt from size caps.
 */

import { describe, expect, it } from "vitest";
import { AVATAR_METHODS, CHARACTER_METHODS, CHAT_METHODS, CONNECT_METHOD, JSON_RPC_APP_ERROR, MEDIA_METHODS, TIMELINE_METHODS } from "@taki/shared";
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
  it("streams chat deltas (with the turn's messageId) to the active turn and settles on complete", async () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    h.open();
    const deltas: string[] = [];
    const messageIds: string[] = [];
    let completed = false;
    const turn = client.chat(
      { characterId: "taki", message: "hi" },
      {
        onDelta: (delta, messageId) => {
          deltas.push(delta);
          messageIds.push(messageId);
        },
        onComplete: () => (completed = true),
      },
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
    expect(messageIds).toEqual(["m1", "m1"]);
    expect(completed).toBe(true);
  });

  it("timelineHistory requests a page and parses the newest-first result", async () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    h.open();
    const page = client.timelineHistory({ characterId: "taki", limit: 50 });
    await flush();
    expect(JSON.parse(h.sent[h.sent.length - 1] ?? "{}").method).toBe(TIMELINE_METHODS.history);
    h.deliver({ jsonrpc: "2.0", id: lastRequestId(h.sent), result: { entries: [], nextBefore: null } });
    expect(await page).toEqual({ entries: [], nextBefore: null });
  });

  it("mediaGet fetches attachment bytes for the given ref and parses the result", async () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    h.open();
    const got = client.mediaGet("attachments/abc.png");
    await flush();
    const sent = JSON.parse(h.sent[h.sent.length - 1] ?? "{}");
    expect(sent.method).toBe(MEDIA_METHODS.get);
    expect(sent.params).toEqual({ ref: "attachments/abc.png" });
    h.deliver({ jsonrpc: "2.0", id: lastRequestId(h.sent), result: { mediaType: "image/png", dataBase64: "AAAA" } });
    expect(await got).toEqual({ mediaType: "image/png", dataBase64: "AAAA" });
  });

  it("importCharacter uploads the archive and parses the costumes + warnings result (#18)", async () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    h.open();
    const done = client.importCharacter({ sourceKind: "zst", archiveBase64: "AAAA", fileName: "taki.zst" });
    await flush();
    const sent = JSON.parse(h.sent[h.sent.length - 1] ?? "{}");
    expect(sent.method).toBe(CHARACTER_METHODS.import);
    expect(sent.params).toEqual({ sourceKind: "zst", archiveBase64: "AAAA", fileName: "taki.zst" });
    h.deliver({
      jsonrpc: "2.0",
      id: lastRequestId(h.sent),
      result: {
        characterId: "taki",
        costumes: ["arbeit"],
        defaultCostume: "arbeit",
        settingsFilesByCostume: { arbeit: "model.json" },
        warnings: [],
      },
    });
    expect((await done).characterId).toBe("taki");
  });

  it("characterCostumes requests one character's costumes + settings filenames (#18)", async () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    h.open();
    const got = client.characterCostumes("taki");
    await flush();
    const sent = JSON.parse(h.sent[h.sent.length - 1] ?? "{}");
    expect(sent.method).toBe(CHARACTER_METHODS.costumes);
    expect(sent.params).toEqual({ characterId: "taki" });
    h.deliver({
      jsonrpc: "2.0",
      id: lastRequestId(h.sent),
      result: { costumes: ["arbeit", "live_01"], defaultCostume: "arbeit", settingsFilesByCostume: { arbeit: "model.json", live_01: "x.model3.json" } },
    });
    expect(await got).toEqual({
      costumes: ["arbeit", "live_01"],
      defaultCostume: "arbeit",
      settingsFilesByCostume: { arbeit: "model.json", live_01: "x.model3.json" },
    });
  });

  it("costumeResolution requests one costume's external-ref map (resolved + null entries, #18)", async () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    h.open();
    const got = client.costumeResolution("taki", "casual");
    await flush();
    const sent = JSON.parse(h.sent[h.sent.length - 1] ?? "{}");
    expect(sent.method).toBe(CHARACTER_METHODS.costumeResolution);
    expect(sent.params).toEqual({ characterId: "taki", costume: "casual" });
    const resolution = { "../_mtn_emp/taki/hit.mtn": "taki/arbeit/hit.mtn", "../_mtn_emp/sakiko/gone.mtn": null };
    h.deliver({ jsonrpc: "2.0", id: lastRequestId(h.sent), result: { resolution } });
    expect(await got).toEqual({ resolution });
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

  it("routes a timeline.removed push to the registered handler (cancel-retract, zod-validated)", () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    const received: unknown[] = [];
    client.onTimelineRemoved((ref) => received.push(ref));
    h.open();
    h.deliver({ jsonrpc: "2.0", method: TIMELINE_METHODS.removed, params: { characterId: "taki", seq: 12 } });
    expect(received).toEqual([{ characterId: "taki", seq: 12 }]);
  });

  it("threads the retracted flag from chat.error to onError (cancel-before-reply)", async () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    h.open();
    let errored: { code: string; message: string; retracted?: boolean } | null = null;
    const turn = client.chat(
      { characterId: "taki", message: "oops" },
      {
        onDelta: () => undefined,
        onError: (code, message, retracted) => (errored = { code, message, retracted }),
      },
    );
    await flush();
    h.deliver({ jsonrpc: "2.0", id: lastRequestId(h.sent), result: { messageId: "m1" } });
    h.deliver({
      jsonrpc: "2.0",
      method: CHAT_METHODS.error,
      params: {
        messageId: "m1",
        characterId: "taki",
        code: "PROVIDER_ERROR",
        message: "cancelled before reply; message retracted",
        retracted: true,
      },
    });
    await turn;
    expect(errored).toEqual({
      code: "PROVIDER_ERROR",
      message: "cancelled before reply; message retracted",
      retracted: true,
    });
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
