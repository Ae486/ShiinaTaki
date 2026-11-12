/**
 * INPUT: explicit temporary SQLite path and production Pattern authority modules.
 * OUTPUT: isolated scripted WS transport using the real PatternService/CAS/history implementation.
 * POS: native QA fixture; Timeline/setup facts are scripted, no model or production profile is used.
 */
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { URL } from "node:url";
import { openDatabase } from "../../../packages/core/src/db/sqlite.ts";
import { MIGRATIONS } from "../../../packages/core/src/db/migrations/index-list.ts";
import { interactionPatternsMigration052 } from "../../../packages/core/src/db/migrations/052-interaction-patterns.ts";
import { createInteractionPatternService } from "../../../packages/core/src/initiative/patterns/pattern-service.ts";
import { InitiativeSetupStatusSchema } from "../../../packages/shared/src/index.ts";
const { WebSocketServer } = createRequire(new URL("../../../packages/core/package.json", import.meta.url))("ws");
const operator = { kind: "operator", operatorId: "isolated-native-operator" };

export function testDefinition(purpose = "晚饭后一起回顾今天") {
  return { title: "晚间回顾", purpose, conditions: { all: [
    { kind: "local_time_window", start: "19:00", end: "21:00", daysOfWeek: [1, 2, 3, 4, 5, 6, 7] }, { kind: "presence_present" },
  ] }, contextSelectors: ["memory_character"], allowedOutcomes: ["silent", "speak"],
  timing: { minimumGapMinutes: 60, chance: 0.25 }, lifetime: { startsAt: null, expiresAt: null } };
}

function settings() {
  const values = { TAKI_INITIATIVE_ENABLED: false, TAKI_INITIATIVE_MODEL_HOUR_LIMIT: 4,
    TAKI_INITIATIVE_UTTERANCE_HOUR_LIMIT: 2, TAKI_INITIATIVE_UTTERANCE_DAY_LIMIT: 8,
    TAKI_INITIATIVE_UTTERANCE_GAP_MS: 600000, TAKI_INITIATIVE_MODEL_CADENCE_MS: 900000,
    TAKI_INITIATIVE_JITTER_RATIO: 0.2, TAKI_INITIATIVE_BUSY_MAX_WAIT_MS: 90000,
    TAKI_INITIATIVE_OUTPUT_TTL_MS: 600000, TAKI_INITIATIVE_QUIET_START: "23:00", TAKI_INITIATIVE_QUIET_END: "08:00" };
  return Object.entries(values).map(([key, value]) => ({ key, value, default: value, stored: false,
    envLocked: false, apply: "live", secret: false, secretSet: false,
    input: { kind: typeof value === "boolean" ? "boolean" : typeof value === "number" ? "number" : "string" }, description: "Isolated native fixture" }));
}

export async function createPatternFixture(path, port = 0) {
  const fixture = new PatternFixture(path, port);
  await once(fixture.server, "listening");
  return fixture;
}

class PatternFixture {
  constructor(path, port) {
    this.calls = []; this.clients = new Set(); this.rows = []; this.held = [];
    this.holdList = false; this.failList = false; this.dropConfirm = false; this.connectionCount = 0;
    this.entries = settings(); this.skillState = "missing";
    this.server = new WebSocketServer({ host: "127.0.0.1", port });
    this.db = openDatabase({ path, migrations: [...MIGRATIONS.filter((item) => item.version < 52), interactionPatternsMigration052] });
    this.service = createInteractionPatternService({ db: this.db, onChanged: (params) => this.notify("interaction-pattern.changed", params) });
    this.server.on("connection", (socket) => {
      const connection = { socket, name: null, timeline: false, id: ++this.connectionCount };
      this.clients.add(connection);
      socket.on("message", (payload) => this.receive(connection, JSON.parse(payload.toString())));
      socket.on("close", () => this.clients.delete(connection));
    });
  }
  get port() { return this.server.address().port; }
  notify(method, params = { characterId: "taki" }) {
    for (const connection of this.clients) connection.socket.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
  }
  propose(definition = testDefinition(), base = null) {
    const result = this.service.propose({ characterId: "taki", commandId: randomUUID(), patternId: base?.patternId ?? null,
      expectedVersion: base?.version ?? 0, definition }, operator);
    if (result.status === "refused") throw new Error(`Fixture proposal refused: ${result.reason}`);
    return result.pattern;
  }
  current(patternId) { return this.service.get({ characterId: "taki", patternId }); }
  append(text) {
    const row = { seq: this.rows.length + 1, id: randomUUID(), characterId: "taki", role: "assistant", content: text, createdAt: new Date().toISOString() };
    this.rows.push(row);
    for (const connection of this.clients) if (connection.timeline) connection.socket.send(JSON.stringify({ jsonrpc: "2.0", method: "timeline.appended", params: row }));
  }
  disconnectHome() { for (const connection of this.clients) if (connection.name === "taki-home") connection.socket.close(); }
  release() { this.holdList = false; this.held.splice(0).forEach((send) => send()); }
  async close() {
    for (const connection of this.clients) connection.socket.terminate();
    await new Promise((done) => this.server.close(done)); this.db.close();
  }
  receive(connection, request) {
    if (request.id === undefined) return;
    this.calls.push({ method: request.method, connection: connection.id });
    const send = () => {
      try {
        if (this.failList && request.method === "interaction-pattern.list") { this.failList = false; throw new Error("isolated read failure"); }
        const result = this.response(connection, request);
        if (request.method === "interaction-pattern.confirm" && this.dropConfirm) {
          this.dropConfirm = false; connection.socket.close(); return;
        }
        connection.socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
      } catch (cause) { connection.socket.send(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: String(cause) } })); }
    };
    if (this.holdList && request.method === "interaction-pattern.list") this.held.push(send); else send();
  }
  response(connection, { method, params = {} }) {
    if (method === "connect") { connection.name = params.deviceName; return { status: "ok", approvalCommandDisclosureRevision: 1 }; }
    if (method === "presence.report" || method === "timeline.presentation.report") return { status: "accepted", leaseMs: 30000 };
    if (method === "timeline.subscribe") { connection.timeline = true; return { status: "ok" }; }
    if (method === "timeline.history") return { entries: this.rows.filter((row) => !params.before || row.seq < params.before).toReversed().slice(0, params.limit ?? 50), nextBefore: null };
    if (method === "chat.activity.read") return { status: "idle", characterId: "taki" };
    if (method === "config.list") return { entries: this.entries };
    if (method === "config.subscribe" || method === "avatar.subscribe") return { status: "ok" };
    if (method === "config.set") return this.setConfig(params);
    if (method === "user-timezone.read") return timezone();
    if (method.startsWith("interaction-pattern.")) return this.patternMethod(method, params);
    if (method === "initiative.setup.read") return this.setup();
    if (method === "initiative.setup.install-skill") { this.skillState = "ready"; return { status: "installed", reason: null, setup: this.setup() }; }
    if (method === "initiative.setup.propose-seed") return { status: "applied", pattern: this.propose() };
    throw new Error(`Unsupported fixture method: ${method}`);
  }
  patternMethod(method, params) {
    if (method === "interaction-pattern.list") return this.service.list(params);
    if (method === "interaction-pattern.get") return { pattern: this.service.get(params) };
    if (method === "interaction-pattern.history") return this.service.history(params);
    if (method === "interaction-pattern.propose") return this.service.propose(params, operator);
    if (method === "interaction-pattern.confirm") return this.service.confirm(params, operator);
    if (method === "interaction-pattern.change-state") return this.service.changeState(params, operator);
    if (method === "interaction-pattern.rollback") return this.service.rollback(params, operator);
    throw new Error("Unknown Pattern method");
  }
  setConfig({ key, value }) {
    const entry = this.entries.find((row) => row.key === key);
    if (!entry) throw new Error("Unknown fixture config");
    entry.value = value; this.notify("config.changed", { key, value });
    return { status: "ok", key, value, apply: "live" };
  }
  setup() {
    return InitiativeSetupStatusSchema.parse({ characterId: "taki", targetCharacterId: "taki", targetReady: true,
      settings: this.entries, timezone: "Asia/Shanghai", timezoneConfirmed: true,
      sources: { activityAvailable: false, application: null, presence: "unknown", intentionAvailable: false }, completions: [],
      skill: { state: this.skillState, packageId: this.skillState === "ready" ? "opaque-fixture-package" : null, configRevision: this.skillState === "ready" ? 12345 : null }, seeds: [] });
  }
}

function timezone() {
  return { state: { timezone: "Asia/Shanghai", mode: "fixed", authorityDeviceId: null, revision: 1,
    updatedAt: "2026-09-28T00:00:00Z", confirmedAt: "2026-09-28T00:00:00Z", source: "operator", sourceDeviceId: "fixture-device" }, reportStatus: "fixed" };
}
