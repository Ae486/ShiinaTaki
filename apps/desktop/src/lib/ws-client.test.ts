/**
 * INPUT:  a fake WsTransport (no real WebSocket) fed hand-built JSON-RPC frames.
 * OUTPUT: assertions that inbound frames route to the right handler (chat stream, avatar push, connect outcome) and
 *         that invalid frames are dropped without throwing — the zod boundary contract.
 * POS:    unit test for the operator WS client (F1). Node-safe via the injected transport. Exempt from size caps.
 */

import { JSONRPCClient, JSONRPCServer, JSONRPCServerAndClient } from "json-rpc-2.0";
import { describe, expect, it, vi } from "vitest";
import {
  AVATAR_METHODS,
  APPROVAL_METHODS,
  CHARACTER_METHODS,
  CHAT_METHODS,
  CONFIG_METHODS,
  CONNECT_METHOD,
  JSON_RPC_APP_ERROR,
  MEDIA_METHODS,
  PERMISSION_METHODS,
  TIMELINE_METHODS,
  TIMING_POLICY_DEVELOPMENT_DEFAULTS,
} from "@taki/shared";
import { createTimingPolicyStore } from "./timing-policy.ts";
import { createWsClient } from "./ws-client.ts";
import { addConfigChangedHandler, bindTransport, createRoutes, installRoutes } from "./ws-client-routes.ts";
import type { WsTransport } from "./ws-transport.ts";

interface Harness {
  transport: WsTransport;
  sent: string[];
  deliver: (frame: unknown) => void;
  open: () => void;
  closeSocket: () => void;
}

function harness(): Harness {
  const messageHandlers: Array<(data: string) => void> = [];
  const openHandlers: Array<() => void> = [];
  const closeHandlers: Array<() => void> = [];
  const sent: string[] = [];
  return {
    transport: {
      send: (payload) => sent.push(payload),
      close: () => undefined,
      onMessage: (handler) => messageHandlers.push(handler),
      onOpen: (handler) => openHandlers.push(handler),
      onClose: (handler) => closeHandlers.push(handler),
    },
    sent,
    deliver: (frame) => messageHandlers.forEach((handler) => handler(JSON.stringify(frame))),
    open: () => openHandlers.forEach((handler) => handler()),
    closeSocket: () => closeHandlers.forEach((handler) => handler()),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function lastRequestId(sent: string[]): number | string {
  return JSON.parse(sent[sent.length - 1] ?? "{}").id;
}

describe("createWsClient inbound routing", () => {
  it("routes canonical Approval request/closed pushes and isolates failing handlers", () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    const received: unknown[] = [];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      client.onApproval(() => { throw new Error("SENTINEL_RAW_INPUT"); });
      client.onApproval((event) => received.push(event));
      h.open();
      const approvalId = "11111111-1111-4111-8111-111111111111";
      h.deliver({
      jsonrpc: "2.0",
      method: APPROVAL_METHODS.request,
      params: {
        approvalId,
        expiresAt: "2026-08-14T00:01:00.000Z",
        policyGeneration: 3,
        approvalGeneration: 4,
        binding: {
          bindingRevision: 1,
          identity: { capabilityId: "mcp.tool.call", ownerHostId: "33333333-3333-4333-8333-333333333333" },
          descriptorRevision: 1,
          classifierId: "mcp.tool.call.v1",
          classifierRevision: 1,
          cellKey: "mcp-tool-call",
          decisionScopeDigest: "a".repeat(64),
        },
        allowedChoices: ["allow_once", "deny"],
        presentation: {
          revision: 1,
          title: "Run MCP tool",
          capabilityLabel: "MCP tool",
          riskSummary: "This tool can change external state.",
          sections: [{ title: "Target", fields: [{ label: "Tool", value: "redacted-tool" }] }],
        },
      },
    });
      h.deliver({
      jsonrpc: "2.0",
      method: APPROVAL_METHODS.closed,
      params: { approvalId, reason: "expired", approvalGeneration: 4 },
    });
      expect(received).toMatchObject([
        { type: "request", request: { approvalId } },
        { type: "closed", closed: { approvalId, reason: "expired" } },
      ]);
      expect(warn.mock.calls.flat().join(" ")).not.toContain("SENTINEL_RAW_INPUT");
    } finally {
      warn.mockRestore();
    }
  });

  it("retires every Approval handler before a queued old-generation push can dispatch", () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    const received: unknown[] = [];
    client.onApproval((event) => received.push(event));
    h.open();
    h.closeSocket();
    h.deliver({
      jsonrpc: "2.0",
      method: APPROVAL_METHODS.closed,
      params: {
        approvalId: "11111111-1111-4111-8111-111111111111",
        reason: "operator_disconnected",
        approvalGeneration: 4,
      },
    });
    expect(received).toEqual([]);
  });

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

  it("parses all four permission operator method results through the shared strict schemas", async () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    h.open();
    const level = { level: "standard", policyGeneration: 4, registryRevision: 1 };
    const cell = {
      key: "screenshot", level: "standard", capabilityId: "screenshot", descriptorRevision: 1,
      factoryPosture: "ask", overridePosture: null, effectivePosture: "ask",
      approvalMemory: "rememberable", overrideMode: "ordinary",
    };
    const cases = [
      [() => client.permissionLevelGet(), PERMISSION_METHODS.levelGet, {}, level],
      [() => client.permissionLevelSet({ level: "relaxed", expectedPolicyGeneration: 4 }), PERMISSION_METHODS.levelSet,
        { level: "relaxed", expectedPolicyGeneration: 4 }, { ...level, level: "relaxed", policyGeneration: 5 }],
      [() => client.permissionCellsGet(), PERMISSION_METHODS.cellsGet, {}, { ...level, cells: [cell] }],
      [() => client.permissionCellSet({ key: "screenshot", level: "standard", posture: "auto", expectedPolicyGeneration: 4 }),
        PERMISSION_METHODS.cellSet,
        { key: "screenshot", level: "standard", posture: "auto", expectedPolicyGeneration: 4 },
        { policyGeneration: 5, registryRevision: 1, cell: { ...cell, overridePosture: "auto", effectivePosture: "auto" } }],
    ] as const;

    for (const [start, method, params, result] of cases) {
      const promise = start();
      await flush();
      const sent = JSON.parse(h.sent[h.sent.length - 1] ?? "{}");
      expect(sent).toMatchObject({ method, params });
      h.deliver({ jsonrpc: "2.0", id: sent.id, result });
      await expect(promise).resolves.toEqual(result);
    }
  });

  it("rejects malformed permission results instead of admitting drifted Core state", async () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    h.open();
    const pending = client.permissionCellsGet();
    await flush();
    h.deliver({
      jsonrpc: "2.0",
      id: lastRequestId(h.sent),
      result: { level: "standard", policyGeneration: 1, registryRevision: 1, cells: [], unexpected: true },
    });
    await expect(pending).rejects.toThrow();
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

  it("ignores a queued old-generation push after the transport has closed", () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    const received: unknown[] = [];
    client.onAvatarCommand((command) => received.push(command));
    h.open();
    h.closeSocket();
    h.deliver({
      jsonrpc: "2.0",
      method: AVATAR_METHODS.command,
      params: { characterId: "taki", kind: "expression", name: "late" },
    });
    expect(received).toEqual([]);
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

describe("createWsClient disconnect handling (D29)", () => {
  it("rejects connect when the socket closes before open", async () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    const connecting = client.connect({ deviceId: "d", deviceName: "pet", role: "operator", capabilities: [] });
    h.closeSocket();
    await expect(connecting).rejects.toThrow("连接已断开");
    expect(h.sent).toEqual([]);
  });

  it("bounds a socket that never opens with the bootstrap open/auth policy", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      const timingPolicy = createTimingPolicyStore({ ...TIMING_POLICY_DEVELOPMENT_DEFAULTS, openAuthMs: 10 });
      const client = createWsClient({ transport: h.transport, timingPolicy });
      const connecting = client.connect({ deviceId: "d", deviceName: "pet", role: "operator", capabilities: [] });
      const rejection = expect(connecting).rejects.toMatchObject({ name: "WsOpenDeadlineExceededError", timeoutMs: 10 });
      await vi.advanceTimersByTimeAsync(10);
      await rejection;
      expect(h.sent).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shares one open/auth budget instead of restarting the deadline after open", async () => {
    vi.useFakeTimers();
    try {
      const h = harness();
      const timingPolicy = createTimingPolicyStore({ ...TIMING_POLICY_DEVELOPMENT_DEFAULTS, openAuthMs: 10 });
      const client = createWsClient({ transport: h.transport, timingPolicy });
      const connecting = client.connect({ deviceId: "d", deviceName: "pet", role: "operator", capabilities: [] });
      await vi.advanceTimersByTimeAsync(6);
      h.open();
      await Promise.resolve();
      const rejection = expect(connecting).rejects.toMatchObject({ name: "RpcDeadlineExceededError", timeoutMs: 4 });
      await vi.advanceTimersByTimeAsync(4);
      await rejection;
      expect(JSON.parse(h.sent[0] ?? "{}").method).toBe(CONNECT_METHOD);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not start authentication when a delayed open callback resumes after the total budget", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(0));
      const h = harness();
      const timingPolicy = createTimingPolicyStore({ ...TIMING_POLICY_DEVELOPMENT_DEFAULTS, openAuthMs: 10 });
      const client = createWsClient({ transport: h.transport, timingPolicy });
      const connecting = client.connect({ deviceId: "d", deviceName: "pet", role: "operator", capabilities: [] });
      vi.setSystemTime(new Date(11));
      h.open();
      const rejection = expect(connecting).rejects.toMatchObject({ name: "WsOpenDeadlineExceededError", timeoutMs: 10 });
      await vi.advanceTimersByTimeAsync(1);
      await rejection;
      expect(h.sent).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles an in-flight turn with a structured error when the socket dies mid-turn", async () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    h.open();
    let errored: { code: string; message: string } | null = null;
    const turn = client.chat(
      { characterId: "taki", message: "hi" },
      { onDelta: () => undefined, onError: (code, message) => (errored = { code, message }) },
    );
    await flush();
    h.deliver({ jsonrpc: "2.0", id: lastRequestId(h.sent), result: { messageId: "m1" } });
    h.deliver({ jsonrpc: "2.0", method: CHAT_METHODS.delta, params: { messageId: "m1", characterId: "taki", delta: "He" } });
    h.closeSocket();
    await turn; // the defect was an await that never resolved
    expect(errored).not.toBeNull();
    expect(errored!.code).toBe("INTERNAL_ERROR");
  });

  it("rejects a chat started after the socket closed instead of hanging", async () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    h.open();
    h.closeSocket();
    await expect(client.chat({ characterId: "taki", message: "hi" }, { onDelta: () => undefined })).rejects.toThrow();
  });

  it("still rejects pending JSON-RPC requests on close, and a close with no turn is harmless", async () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    h.open();
    const page = client.timelineHistory({ characterId: "taki", limit: 50 });
    await flush();
    expect(() => h.closeSocket()).not.toThrow();
    await expect(page).rejects.toThrow();
  });

  it("retires one generation idempotently when close is delivered more than once", async () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    h.open();
    let errors = 0;
    const turn = client.chat(
      { characterId: "taki", message: "hi" },
      { onDelta: () => undefined, onError: () => errors++ },
    );
    await flush();
    h.deliver({ jsonrpc: "2.0", id: lastRequestId(h.sent), result: { messageId: "m1" } });
    h.closeSocket();
    h.closeSocket();
    await turn;
    expect(errors).toBe(1);
  });

  it("retires synchronously on caller close while preserving the real transport close callback", async () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    const configChanges: unknown[] = [];
    let closeEvents = 0;
    let turnErrors = 0;
    client.onConfigChanged((changed) => configChanges.push(changed));
    client.onClose(() => closeEvents++);
    h.open();
    const pendingPage = client.timelineHistory({ characterId: "taki", limit: 50 });
    const turn = client.chat(
      { characterId: "taki", message: "hi" },
      { onDelta: () => undefined, onError: () => turnErrors++ },
    );
    await flush();
    h.deliver({ jsonrpc: "2.0", id: lastRequestId(h.sent), result: { messageId: "m1" } });

    client.close();
    h.deliver({ jsonrpc: "2.0", method: CONFIG_METHODS.changed, params: { key: "TAKI_LOG_LEVEL", value: "debug" } });

    await expect(pendingPage).rejects.toThrow("connection closed");
    await turn;
    expect(turnErrors).toBe(1);
    expect(configChanges).toEqual([]);
    expect(closeEvents).toBe(0);

    h.closeSocket();
    expect(closeEvents).toBe(1);
  });
});

describe("createWsClient config methods", () => {
  it("configList round-trips the knob entries", async () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    h.open();
    const got = client.configList();
    await flush();
    expect(JSON.parse(h.sent[h.sent.length - 1] ?? "{}").method).toBe(CONFIG_METHODS.list);
    const entry = {
      key: "TAKI_LOG_LEVEL",
      value: "info",
      stored: false,
      envLocked: false,
      default: "info",
      apply: "restart",
      secret: false,
      secretSet: false,
      input: { kind: "enum", options: ["info", "debug"] },
      description: "log level",
    };
    h.deliver({ jsonrpc: "2.0", id: lastRequestId(h.sent), result: { entries: [entry] } });
    expect((await got).entries).toEqual([entry]);
  });

  it("configSet sends the key/value pair and parses the apply verdict", async () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    h.open();
    const done = client.configSet({ key: "TAKI_LOG_LEVEL", value: "debug" });
    await flush();
    const sent = JSON.parse(h.sent[h.sent.length - 1] ?? "{}");
    expect(sent.method).toBe(CONFIG_METHODS.set);
    expect(sent.params).toEqual({ key: "TAKI_LOG_LEVEL", value: "debug" });
    h.deliver({
      jsonrpc: "2.0",
      id: lastRequestId(h.sent),
      result: { status: "ok", key: "TAKI_LOG_LEVEL", value: "debug", apply: "restart" },
    });
    expect(await done).toEqual({ status: "ok", key: "TAKI_LOG_LEVEL", value: "debug", apply: "restart" });
  });

  it("fans out config.changed to independent handlers and supports per-consumer cleanup", () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    const first: unknown[] = [];
    const second: unknown[] = [];
    const unsubscribe = client.onConfigChanged((changed) => first.push(changed));
    client.onConfigChanged((changed) => second.push(changed));
    h.open();
    h.deliver({ jsonrpc: "2.0", method: CONFIG_METHODS.changed, params: { key: "TAKI_LOG_LEVEL", value: "debug" } });
    unsubscribe();
    h.deliver({ jsonrpc: "2.0", method: CONFIG_METHODS.changed, params: { key: "TAKI_LOG_LEVEL", value: "info" } });
    expect(first).toEqual([{ key: "TAKI_LOG_LEVEL", value: "debug" }]);
    expect(second).toEqual([
      { key: "TAKI_LOG_LEVEL", value: "debug" },
      { key: "TAKI_LOG_LEVEL", value: "info" },
    ]);
  });

  it("does not deliver a queued config.changed push after route retirement", async () => {
    const h = harness();
    const rpc = new JSONRPCServerAndClient(
      new JSONRPCServer(),
      new JSONRPCClient(() => undefined),
    );
    const state = createRoutes();
    installRoutes(rpc, state);
    const binding = bindTransport(h.transport, rpc, state);
    const received: unknown[] = [];
    addConfigChangedHandler(state, (changed) => received.push(changed));
    h.open();
    binding.retire();
    await rpc.receiveAndSend({
      jsonrpc: "2.0",
      method: CONFIG_METHODS.changed,
      params: { key: "TAKI_LOG_LEVEL", value: "debug" },
    });
    expect(received).toEqual([]);
  });

  it("sends at most one config.subscribe request per client generation", async () => {
    const h = harness();
    const client = createWsClient({ transport: h.transport });
    h.open();
    const first = client.subscribeConfig();
    const second = client.subscribeConfig();
    await flush();
    expect(h.sent.map((payload) => JSON.parse(payload).method)).toEqual([CONFIG_METHODS.subscribe]);
    h.deliver({ jsonrpc: "2.0", id: lastRequestId(h.sent), result: { status: "ok" } });
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
  });
});
