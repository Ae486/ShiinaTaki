import { describe, expect, it, vi } from "vitest";
import { INITIATIVE_SETUP_METHODS, INITIATIVE_WAKE_METHODS, INTERACTION_PATTERN_METHODS, INITIATIVE_BACKOFF_METHODS } from "@taki/shared";
import { createWsClient, type WsClient } from "./ws-client.ts";
import type { WsTransport } from "./ws-transport.ts";
import { definition, pattern, setupStatus } from "@/features/initiative-patterns/pattern-test-fixtures.js";
import { rpcMethodPolicy } from "./rpc-deadline.ts";

function harness() {
  const messages: Array<(data: string) => void> = [], opened: Array<() => void> = [], closed: Array<() => void> = [];
  const sent: string[] = [];
  const transport: WsTransport = {
    send: (payload) => { sent.push(payload); }, close: vi.fn(),
    onMessage: (handler) => { messages.push(handler); }, onOpen: (handler) => { opened.push(handler); }, onClose: (handler) => { closed.push(handler); },
  };
  const deliver = (value: unknown) => messages.forEach((handler) => handler(JSON.stringify(value)));
  const client = createWsClient({ transport }); opened.forEach((handler) => handler());
  return { client, transport, sent, deliver, closed: () => closed.forEach((handler) => handler()),
    request: () => JSON.parse(sent.at(-1) ?? "{}") as { id: number; method: string; params: unknown },
    reply(result: unknown) { deliver({ jsonrpc: "2.0", id: this.request().id, result }); },
  };
}

const row = pattern();
const scope = { characterId: "taki", patternId: row.patternId };
const command = { ...scope, expectedVersion: row.version, commandId: "opaque-command" };
const mutation = { status: "applied", pattern: row };
const policy = { characterId: "taki", cursor: 19, since: "2026-09-28T10:00:00Z", recent: [], counters: [] };
const backoff = { stage: "normal", qualifiedWeakCount: 0, spacingMultiplier: 1, dailyJudgments: 1,
  nextEligibleAt: null, refusal: null, lastResetAt: null, lastResetReason: null,
  windowSince: "2026-09-21T12:00:00.000Z", observedAt: "2026-09-28T12:00:00.000Z" };
const cases: Array<{ method: string; params: unknown; result: unknown; invoke(client: WsClient): Promise<unknown> }> = [
  { method: INTERACTION_PATTERN_METHODS.list, params: { characterId: "taki", after: null, limit: 100 }, result: { patterns: [row], nextAfter: null },
    invoke: (client) => client.initiativePatternsList({ characterId: "taki", after: null, limit: 100 }) },
  { method: INTERACTION_PATTERN_METHODS.get, params: scope, result: { pattern: row }, invoke: (client) => client.initiativePatternRead(scope) },
  { method: INTERACTION_PATTERN_METHODS.history, params: { ...scope, before: null, limit: 100 }, result: { revisions: [row.candidateRevision], nextBefore: null },
    invoke: (client) => client.initiativePatternHistory({ ...scope, before: null, limit: 100 }) },
  { method: INTERACTION_PATTERN_METHODS.propose, params: { ...command, definition: definition() }, result: mutation,
    invoke: (client) => client.initiativePatternPropose({ ...command, definition: definition() }) },
  { method: INTERACTION_PATTERN_METHODS.confirm, params: { ...command, candidateRevisionId: "opaque-revision" }, result: mutation,
    invoke: (client) => client.initiativePatternConfirm({ ...command, candidateRevisionId: "opaque-revision" }) },
  { method: INTERACTION_PATTERN_METHODS.changeState, params: { ...command, action: "pause" }, result: mutation,
    invoke: (client) => client.initiativePatternChangeState({ ...command, action: "pause" }) },
  { method: INTERACTION_PATTERN_METHODS.rollback, params: { ...command, revisionId: "accepted-revision" }, result: mutation,
    invoke: (client) => client.initiativePatternRollback({ ...command, revisionId: "accepted-revision" }) },
  { method: INITIATIVE_SETUP_METHODS.read, params: { characterId: "taki" }, result: setupStatus(), invoke: (client) => client.initiativeSetupRead({ characterId: "taki" }) },
  { method: INITIATIVE_SETUP_METHODS.installSkill, params: { characterId: "taki" }, result: { status: "refused", reason: "package-disabled", setup: setupStatus() },
    invoke: (client) => client.initiativeSetupInstallSkill({ characterId: "taki" }) },
  { method: INITIATIVE_SETUP_METHODS.proposeSeed, params: { characterId: "taki", commandId: "seed-command", seedId: "evening-reflection" }, result: mutation,
    invoke: (client) => client.initiativeSetupProposeSeed({ characterId: "taki", commandId: "seed-command", seedId: "evening-reflection" }) },
  { method: INITIATIVE_WAKE_METHODS.read, params: { characterId: "taki" }, result: policy, invoke: (client) => client.initiativeWakePolicy({ characterId: "taki" }) },
  { method: INITIATIVE_BACKOFF_METHODS.read, params: { characterId: "taki" }, result: backoff, invoke: (client) => client.initiativeBackoffRead({ characterId: "taki" }) },
  { method: INITIATIVE_BACKOFF_METHODS.reset, params: { characterId: "taki" }, result: backoff, invoke: (client) => client.initiativeBackoffReset({ characterId: "taki" }) },
];

describe("actual WsClient initiative facade", () => {
  it.each(cases)("sends exact Shared request bindings and parses $method", async (entry) => {
    const h = harness(); const result = entry.invoke(h.client);
    expect(h.request()).toMatchObject({ method: entry.method, params: entry.params });
    h.reply(entry.result); await expect(result).resolves.toEqual(entry.result);
    expect(h.sent).toHaveLength(1); h.client.close();
  });

  it.each(cases)("rejects schema-invalid $method responses without retrying", async (entry) => {
    const h = harness(); const result = entry.invoke(h.client);
    h.reply({ invalid: "private-server-payload" }); await expect(result).rejects.toThrow();
    expect(h.sent).toHaveLength(1); h.client.close();
  });

  it("preserves domain conflict/current results without treating them as success or replaying", async () => {
    const h = harness(), refused = { status: "refused", reason: "conflict", current: row };
    const result = h.client.initiativePatternConfirm({ ...command, candidateRevisionId: "opaque-revision" });
    h.reply(refused); await expect(result).resolves.toEqual(refused); expect(h.sent).toHaveLength(1); h.client.close();
  });

  it("routes only strict invalidations, isolates observers, unsubscribes and retires all callbacks on close", () => {
    const h = harness(), patterns = vi.fn(), setup = vi.fn(), wake = vi.fn(), changedBackoff = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    h.client.onInitiativePatternsChanged(() => { throw new Error("private-observer-error"); });
    const remove = h.client.onInitiativePatternsChanged(patterns);
    h.client.onInitiativeSetupChanged(setup); h.client.onInitiativeWakePolicyChanged(wake);
    h.client.onInitiativeBackoffChanged(() => { throw new Error("private-backoff-observer"); });
    const removeBackoff = h.client.onInitiativeBackoffChanged(changedBackoff);
    const changed = (method: string, params: unknown = { characterId: "taki" }) => h.deliver({ jsonrpc: "2.0", method, params });
    try {
      for (const method of [INTERACTION_PATTERN_METHODS.changed, INITIATIVE_SETUP_METHODS.changed, INITIATIVE_WAKE_METHODS.changed, INITIATIVE_BACKOFF_METHODS.changed]) {
        changed(method, { characterId: "taki", privateField: "private-payload" }); changed(method, {}); changed(method);
      }
      expect(patterns).toHaveBeenCalledExactlyOnceWith({ characterId: "taki" });
      expect(setup).toHaveBeenCalledExactlyOnceWith({ characterId: "taki" });
      expect(wake).toHaveBeenCalledExactlyOnceWith({ characterId: "taki" });
      expect(changedBackoff).toHaveBeenCalledExactlyOnceWith({ characterId: "taki" });
      expect(h.sent).toHaveLength(0);
      remove(); changed(INTERACTION_PATTERN_METHODS.changed); expect(patterns).toHaveBeenCalledTimes(1);
      removeBackoff(); changed(INITIATIVE_BACKOFF_METHODS.changed); expect(changedBackoff).toHaveBeenCalledTimes(1);
      h.client.onInitiativeBackoffChanged(changedBackoff);
      h.closed(); changed(INITIATIVE_SETUP_METHODS.changed); changed(INITIATIVE_WAKE_METHODS.changed);
      expect(setup).toHaveBeenCalledTimes(1); expect(wake).toHaveBeenCalledTimes(1);
      changed(INITIATIVE_BACKOFF_METHODS.changed); expect(changedBackoff).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls.flat().join(" ")).not.toMatch(/private-observer-error|private-payload/);
    } finally { warn.mockRestore(); h.client.close(); }
  });

  it.each(["socket", "explicit"] as const)("never replays a backoff reset after %s close or a late reply", async (kind) => {
    const h = harness(); const pending = h.client.initiativeBackoffReset({ characterId: "taki" });
    const rejected = expect(pending).rejects.toThrow("connection closed");
    if (kind === "socket") h.closed(); else h.client.close();
    await rejected; h.reply(backoff); expect(h.sent).toHaveLength(1); h.client.close();
  });

  it("classifies backoff reads as retryable reads and reset timeouts as unknown mutations", () => {
    expect(rpcMethodPolicy(INITIATIVE_BACKOFF_METHODS.read)).toMatchObject({ class: "interactive", timeoutOutcome: "read-only" });
    expect(rpcMethodPolicy(INITIATIVE_BACKOFF_METHODS.reset)).toMatchObject({ class: "interactive", timeoutOutcome: "unknown" });
  });

  it.each(["socket", "explicit"] as const)("rejects in-flight mutations on %s close and ignores a late success", async (kind) => {
    const h = harness();
    const pending = h.client.initiativePatternConfirm({ ...command, candidateRevisionId: "opaque-revision" });
    const rejected = expect(pending).rejects.toThrow("connection closed");
    if (kind === "socket") h.closed(); else h.client.close();
    await rejected;
    h.reply(mutation);
    expect(h.sent).toHaveLength(1);
    h.client.close();
  });
});
