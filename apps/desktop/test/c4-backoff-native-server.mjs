/**
 * INPUT: a fresh temporary database path and the existing C3 native transport fixture.
 * OUTPUT: Shared-validated scripted backoff/Monitor responses and follow-up Timeline parts.
 * POS: C4 presentation QA only; no real model, C2 opportunity evidence or Core backoff authority.
 */
import { randomInt, randomUUID } from "node:crypto";
import {
  INITIATIVE_BACKOFF_METHODS, InitiativeBackoffReadParamsSchema, InitiativeBackoffResetParamsSchema,
  InitiativeBackoffStatusSchema, InitiativeWakePolicyStatusSchema, MonitorStateResultSchema,
  RunMonitorListResultSchema, TimelineEntrySchema,
} from "../../../packages/shared/src/index.ts";
import { createPatternFixture } from "./c3-pattern-native-server.mjs";
const { structuredClone } = globalThis;

export async function createBackoffFixture(path) {
  // This Windows host allocates a low port-0 range that includes WebView2-blocked service ports.
  const fixture = await createPatternFixture(path, randomInt(20_000, 60_000));
  fixture.backoff = scriptedBackoff("normal", 0);
  fixture.backoffReadFailures = 1;
  fixture.holdBackoff = false;
  fixture.heldBackoff = [];
  fixture.resetMode = "normal";
  fixture.notifyBeforeResetReply = false;
  const originalReceive = fixture.receive.bind(fixture);
  const originalResponse = fixture.response.bind(fixture);
  fixture.response = (connection, request) => {
    if (request.method === "observability.state") return MonitorStateResultSchema.parse({ mode: "FULL_LOCAL", enabled: true, detail: "safe-local" });
    if (request.method === "observability.list") return RunMonitorListResultSchema.parse({ runs: [] });
    if (request.method === "observability.unsubscribe") return { status: "ok" };
    if (request.method === "observability.initiative-policy") return InitiativeWakePolicyStatusSchema.parse({
      characterId: "taki", cursor: 0, since: new Date().toISOString(), recent: [], counters: [],
    });
    return originalResponse(connection, request);
  };
  fixture.receive = (connection, request) => {
    if (![INITIATIVE_BACKOFF_METHODS.read, INITIATIVE_BACKOFF_METHODS.reset].includes(request.method)) return originalReceive(connection, request);
    if (request.id === undefined) return;
    fixture.calls.push({ method: request.method, connection: connection.id });
    const reply = (response) => {
      if (connection.socket.readyState === 1) connection.socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, ...response }));
    };
    try {
      if (request.method === INITIATIVE_BACKOFF_METHODS.read) {
        InitiativeBackoffReadParamsSchema.parse(request.params);
        const result = structuredClone(fixture.backoff);
        const send = () => {
          if (fixture.backoffReadFailures > 0) {
            fixture.backoffReadFailures -= 1; reply({ error: { code: -32603, message: "scripted private read failure" } });
          } else reply({ result });
        };
        if (fixture.holdBackoff) fixture.heldBackoff.push(send); else send();
      } else {
        InitiativeBackoffResetParamsSchema.parse(request.params);
        fixture.backoff = InitiativeBackoffStatusSchema.parse({ ...scriptedBackoff("normal", 0),
          dailyJudgments: fixture.backoff.dailyJudgments, lastResetAt: new Date().toISOString(), lastResetReason: "operator" });
        if (fixture.resetMode === "fail-refresh") fixture.backoffReadFailures = fixture.notifyBeforeResetReply ? 2 : 1;
        const drop = fixture.resetMode === "drop"; fixture.resetMode = "normal";
        if (fixture.notifyBeforeResetReply) fixture.notify(INITIATIVE_BACKOFF_METHODS.changed);
        if (drop) connection.socket.close(); else reply({ result: fixture.backoff });
      }
    } catch { reply({ error: { code: -32602, message: "Invalid isolated fixture request" } }); }
  };
  fixture.setBackoff = (stage, count) => {
    fixture.backoff = scriptedBackoff(stage, count); fixture.notify(INITIATIVE_BACKOFF_METHODS.changed);
  };
  fixture.releaseBackoff = () => { fixture.holdBackoff = false; fixture.heldBackoff.splice(0).forEach((send) => send()); };
  fixture.appendFollowUp = () => {
    const at = Date.now();
    const result = { ok: true, status: "created", state: "active", purpose: "Ask about an interview",
      notBefore: new Date(at + 60_000).toISOString(), expiresAt: new Date(at + 3_600_000).toISOString(),
      reportedEventTime: null, disposition: null };
    const row = TimelineEntrySchema.parse({ seq: fixture.rows.length + 1, id: randomUUID(), characterId: "taki",
      role: "tool", content: "", createdAt: new Date(at).toISOString(), parts: [{ type: "tool-result", toolName: "plan_follow_up",
        toolCallId: "private-follow-up-call", output: { type: "json", value: result } }] });
    fixture.rows.push(row);
    for (const connection of fixture.clients) if (connection.timeline && connection.socket.readyState === 1) {
      connection.socket.send(JSON.stringify({ jsonrpc: "2.0", method: "timeline.appended", params: row }));
    }
    return { row, result };
  };
  return fixture;
}

function scriptedBackoff(stage, count) {
  const at = Date.now();
  return InitiativeBackoffStatusSchema.parse({ stage, qualifiedWeakCount: count,
    spacingMultiplier: stage === "normal" ? 1 : stage === "double" ? 2 : 4,
    dailyJudgments: stage === "normal" ? 0 : 1,
    nextEligibleAt: stage === "normal" ? null : new Date(at + (stage === "daily" ? 86_400_000 : 3_600_000)).toISOString(),
    refusal: stage === "normal" ? null : stage === "daily" ? "backoff-daily" : "backoff-spacing",
    lastResetAt: null, lastResetReason: null, windowSince: new Date(at - 7 * 86_400_000).toISOString(), observedAt: new Date(at).toISOString() });
}
