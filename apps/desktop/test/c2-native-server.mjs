/**
 * INPUT: isolated native fixture WebSockets and explicit test Timeline/settings state
 * OUTPUT: bounded scripted protocol responses and captured, Shared-validated producer facts
 * POS: native QA only — server acceptance is a fixture, not Core policy or a model/provider test
 */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { URL } from "node:url";
import { PresenceReportParamsSchema, TimelinePresentationReportParamsSchema } from "../../../packages/shared/src/index.ts";
const { WebSocketServer } = createRequire(new URL("../../../packages/core/package.json", import.meta.url))("ws");

export async function createFixtureServer() {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const state = { clients: new Set(), reports: [], calls: [], rows: [], next: 0,
    timezone: { timezone: "UTC", mode: "fixed", authorityDeviceId: null, revision: 1,
      updatedAt: new Date().toISOString(), confirmedAt: null, source: "bootstrap", sourceDeviceId: null }, source: null };
  server.on("connection", (socket) => {
    const connection = { socket, id: ++state.next, name: null, deviceId: null, timeline: false };
    state.clients.add(connection);
    socket.on("message", (payload) => receive(state, connection, JSON.parse(payload.toString())));
    socket.on("close", () => state.clients.delete(connection));
  });
  return { state, port: server.address().port,
    append(text) {
      const row = { seq: state.rows.length + 1, id: randomUUID(), characterId: "taki", role: "assistant", content: text,
        createdAt: new Date().toISOString() };
      state.rows.push(row);
      for (const client of state.clients) if (client.timeline) client.socket.send(JSON.stringify({ jsonrpc: "2.0", method: "timeline.appended", params: row }));
      return row;
    },
    disconnect(name) { for (const client of state.clients) if (client.name === name) client.socket.close(); },
    async close() { for (const client of state.clients) client.socket.terminate(); await new Promise((done) => server.close(done)); },
  };
}

function receive(state, connection, request) {
  if (request.id === undefined) return;
  state.calls.push({ connection: connection.id, method: request.method, at: Date.now() });
  try {
    const result = response(state, connection, request);
    connection.socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
  } catch (cause) {
    connection.socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: String(cause) } }));
  }
}

function response(state, connection, { method, params = {} }) {
  if (method === "connect") {
    connection.name = params.deviceName; connection.deviceId = params.deviceId;
    return { status: "ok", approvalCommandDisclosureRevision: 1 };
  }
  if (method === "presence.report" || method === "timeline.presentation.report") {
    const data = (method === "presence.report" ? PresenceReportParamsSchema : TimelinePresentationReportParamsSchema).parse(params);
    state.reports.push({ connection: connection.id, name: connection.name, method, params: data, at: Date.now() });
    return { status: "accepted", leaseMs: 30_000 };
  }
  if (method === "timeline.subscribe") { connection.timeline = true; return { status: "ok" }; }
  if (method === "timeline.history") return { entries: state.rows.filter((row) => !params.before || row.seq < params.before).toReversed().slice(0, params.limit ?? 50), nextBefore: null };
  if (method === "chat.activity.read") return { status: "idle", characterId: "taki" };
  if (method === "config.list") return { entries: [] };
  if (method === "config.subscribe" || method === "avatar.report" || method === "avatar.subscribe") return { status: "ok" };
  if (method.startsWith("user-timezone.")) return timezone(state, connection, { method, params });
  throw new Error(`Unsupported fixture method: ${method}`);
}

function timezone(state, connection, { method, params }) {
  if (method === "user-timezone.read") {
    if (params.claimReportSource) state.source = { id: randomUUID(), connection: connection.id };
    return { state: state.timezone, reportStatus: state.timezone.mode === "fixed" ? "fixed" : state.source ? "current" : "unavailable",
      ...(params.claimReportSource ? { reportSourceId: state.source.id } : {}) };
  }
  if (params.expectedRevision !== state.timezone.revision) return { status: "refused", reason: "revision-conflict", state: state.timezone };
  const at = new Date().toISOString();
  if (method === "user-timezone.update") {
    state.timezone = { ...state.timezone, ...params, authorityDeviceId: params.authorityDeviceId ?? null,
      revision: state.timezone.revision + 1, updatedAt: at };
    delete state.timezone.expectedRevision; state.source = null;
    if (params.mode === "fixed") Object.assign(state.timezone, { confirmedAt: at, source: "operator", sourceDeviceId: connection.deviceId });
  } else {
    if (state.source?.connection !== connection.id || state.source.id !== params.reportSourceId) return { status: "refused", reason: "stale-source", state: state.timezone };
    Object.assign(state.timezone, { timezone: params.timezone, revision: state.timezone.revision + 1,
      updatedAt: at, confirmedAt: at, source: "device", sourceDeviceId: connection.deviceId });
  }
  return { status: "accepted", state: state.timezone };
}
