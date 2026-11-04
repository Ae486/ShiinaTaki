import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTEXT_CATEGORIES, RequestCompositionSchema, type ContextRequestMeasuredPayload } from "@taki/shared";
import { openDatabase, type Database } from "./sqlite.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { createRunEventRepo } from "./run-event-repo.ts";
import { createRequestAttributionRepo } from "./request-attribution-repo.ts";
import { createTimelineRepo } from "./timeline-repo.ts";
import { rmTempDir } from "../testing/rm-temp.ts";
import { projectEvent } from "../observability/observability-event-projection.ts";
import { inspectEvent } from "../observability/observability-inspector.ts";

const at = "2026-11-02T12:00:00.000Z";
const later = "2026-11-02T13:00:00.000Z";
const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
function open(path = ":memory:") {
  const db = openDatabase({ path, migrations: MIGRATIONS }); cleanup.push(() => db.close()); return db;
}
function source(db: Database, seq: number, initiator = "primary") {
  const run = `r${seq}`, attempt = `a${seq}`;
  db.prepare(`INSERT INTO run_snapshots (snapshot_id,run_id,schema_version,manifest_json,manifest_digest,captured_at,created_at)
    VALUES (:run,:run,'harness.v1','{}',:digest,:at,:at)`).run({ run, digest: "a".repeat(64), at });
  db.prepare(`INSERT INTO runs (run_id,character_id,trigger_request_id,idempotency_key,request_hash,initiator,provenance_json,
    delivery_class,state,snapshot_id,active_attempt_id,queued_at,created_at,updated_at)
    VALUES (:run,'taki',:run,:run,'h',:initiator,'{}','class_a','running',:run,:attempt,:at,:at,:at)`).run({ run, attempt, initiator, at });
  db.prepare(`INSERT INTO run_attempts (attempt_id,run_id,ordinal,state,provider,model_id,snapshot_id)
    VALUES (:attempt,:run,1,'effect_running','p','m',:run)`).run({ run, attempt });
  if (initiator === "primary") db.prepare(`INSERT INTO primary_conversation_sources
    (source_id,character_id,original_user_id,original_user_seq,original_user_digest,run_id,state,created_at)
    VALUES (:id,'taki',:user,:seq,:digest,:run,'open',:at)`).run({ id: randomUUID(), user: randomUUID(), seq, digest: "a".repeat(64), run, at });
  return { db, run, attempt, seq };
}
type Source = ReturnType<typeof source>;
function effect(src: Source, id: string, options: { input?: number | null; outcome?: string; settledAt?: string; terminal?: boolean; intent?: boolean; responseModelId?: string } = {}) {
  const db = src.db;
  const sourceRef = { type: "model" as const, provider: "p", modelId: "m" };
  db.prepare(`INSERT INTO run_effects (effect_id,run_id,attempt_id,schema_version,kind,state,source_ref_json,replay_posture,
    started_at,settled_at,outcome,created_at,updated_at)
    VALUES (:id,:run,:attempt,'effect.v1','model',:state,:source,'never',:at,:settled,:outcome,:at,:at)`)
    .run({ id, run: src.run, attempt: src.attempt, source: JSON.stringify(sourceRef), state: options.terminal === false ? "intent_committed" : "terminal",
      at, settled: options.terminal === false ? null : options.settledAt ?? at, outcome: options.terminal === false ? null : options.outcome ?? "completed" });
  if (options.intent !== false) createRunEventRepo(db).append({ runId: src.run, attemptId: src.attempt, schemaVersion: "run-event.v1", category: "effect",
    kind: "effect.intent_committed", occurredAt: at, source: "core.effect-lifecycle",
    payload: { kind: "effect.intent_committed", state: "intent_committed", effectId: id, effectKind: "model", sourceRef, replayPosture: "never" } });
  if (options.input !== undefined) db.prepare(`INSERT INTO run_usage (usage_id,run_id,attempt_id,effect_id,schema_version,provider,model_id,quality,input_tokens,recorded_at)
    VALUES (:id,:run,:attempt,:id,'usage.v1','p',:model,'reported',:input,:at)`)
    .run({ id, run: src.run, attempt: src.attempt, model: options.responseModelId ?? "m", input: options.input, at: options.settledAt ?? at });
}
function measurement(src: Source, id: string, override: Partial<ContextRequestMeasuredPayload> = {}) {
  const db = src.db;
  const composition = RequestCompositionSchema.parse({ estimator: "heuristic-v1", totalUnits: 9,
    categories: Object.fromEntries(CONTEXT_CATEGORIES.map((category) => [category, 1])),
    origins: Object.fromEntries(CONTEXT_CATEGORIES.map((category) => [category, { builtin: 1, mcp: 0, skill: 0, unknown: 0 }])),
    coverage: { status: "complete", unestimatedParts: 0, unknownOriginUnits: 0, hasHeuristicMedia: false } });
  return createRunEventRepo(db).append({ runId: src.run, attemptId: src.attempt, schemaVersion: "context-request.v1",
    category: "context", kind: "context.request.measured", occurredAt: at, source: "core.context-observer",
    payload: { kind: "context.request.measured", state: "captured", effectId: id, provider: "p", modelId: "m",
      population: "primary", primaryInputSeq: src.seq, stepNumber: 0, dispatchedAt: at,
      window: { declaredRealTokens: 100, effectiveRealTokens: 80, estimatorWindowUnits: 40, factor: 2 }, composition, ...override } });
}
describe("latest terminal primary request from canonical storage", () => {
  it("refuses a terminal model Effect with missing intent order instead of falling back to old success", () => {
    const db = open(); const src = source(db, 1); effect(src, "good", { input: 10 }); measurement(src, "good");
    effect(src, "unknown-order", { input: 20, intent: false });
    expect(createRequestAttributionRepo(db).read("taki")).toMatchObject({ status: "unavailable", reason: "data-inconsistent", request: null });
  });
  it("selects input then physical dispatch order, regardless of completion and measurement order", () => {
    const db = open(); const first = source(db, 1); const second = source(db, 2);
    effect(first, "old", { input: 100, settledAt: later }); effect(second, "new", { input: 20 });
    measurement(second, "new"); measurement(first, "old");
    expect(createRequestAttributionRepo(db).read("taki", at)).toMatchObject({ status: "ready", request: { effectId: "new", inputTokens: 20 } });
    effect(second, "loop", { input: 30 }); measurement(second, "loop", { stepNumber: 1 });
    measurement(second, "new");
    expect(createRequestAttributionRepo(db).read("taki").request).toMatchObject({ effectId: "loop", stepNumber: 1, inputTokens: 30 });
  });
  it("does not replace primary with background completions, a newer in-flight input or summary revisions", () => {
    const db = open(); const primary = source(db, 1); const background = source(db, 2, "heartbeat"); const inflight = source(db, 3);
    effect(primary, "main", { input: 10 }); measurement(primary, "main");
    effect(background, "background", { input: 500, settledAt: later }); measurement(background, "background", { population: "initiative" });
    effect(inflight, "pending", { terminal: false });
    const repo = createRequestAttributionRepo(db); const before = repo.read("taki", at);
    db.exec(`INSERT INTO conversation_summary (character_id,text,through_seq,revision,updated_at) VALUES ('taki','summary',1,1,'${later}')`);
    expect(repo.read("taki", at)).toEqual(before);
    expect(before.request?.effectId).toBe("main");
  });
  it("shows newest missing measurement or usage instead of a previous successful request, preserving zero and failed outcomes", () => {
    const db = open(); const src = source(db, 1);
    effect(src, "good", { input: 10 }); measurement(src, "good");
    effect(src, "missing-sample", { input: 0, outcome: "failed" });
    expect(createRequestAttributionRepo(db).read("taki")).toMatchObject({ status: "partial", reason: "measurement-missing",
      request: { effectId: "missing-sample", inputTokens: 0, composition: null, outcome: "failed" } });
    effect(src, "missing-usage", { outcome: "cancelled" }); measurement(src, "missing-usage");
    expect(createRequestAttributionRepo(db).read("taki")).toMatchObject({ status: "partial", reason: "usage-missing",
      request: { effectId: "missing-usage", inputTokens: null, outcome: "cancelled" } });
  });
  it("includes retracted sources and rebuilds the identical projection after file reopen", () => {
    const root = mkdtempSync(join(tmpdir(), "taki-attribution-")); cleanup.push(() => rmTempDir(root));
    const path = join(root, "state.db"); const db = open(path); const src = source(db, 1);
    effect(src, "failed", { input: 7, outcome: "failed", responseModelId: "served-model" }); measurement(src, "failed");
    db.exec(`UPDATE primary_conversation_sources SET state='retracted',closed_at='${later}' WHERE original_user_seq=1`);
    const before = createRequestAttributionRepo(db).read("taki", at); cleanup.pop()!();
    expect(before).toMatchObject({ status: "ready", request: { outcome: "failed", modelId: "m", responseModelId: "served-model", inputTokens: 7 } });
    const reopened = open(path); expect(createRequestAttributionRepo(reopened).read("taki", at)).toEqual(before);
  });
  it("accepts an identical duplicate once and distinguishes conflicts and bounded exhaustion", () => {
    const db = open(); const src = source(db, 1); effect(src, "main", { input: 10 });
    measurement(src, "main"); measurement(src, "main");
    expect(createRequestAttributionRepo(db).read("taki").request?.inputTokens).toBe(10);
    measurement(src, "main");
    expect(createRequestAttributionRepo(db).read("taki")).toMatchObject({ status: "unavailable", reason: "scan-exhausted" });
    const db2 = open(); const second = source(db2, 1); effect(second, "m", { input: 10 });
    measurement(second, "m"); measurement(second, "m", { stepNumber: 2 });
    expect(createRequestAttributionRepo(db2).read("taki")).toMatchObject({ status: "unavailable", reason: "data-inconsistent" });
  });
  it("keeps requested and response model names on the same Effect without rewriting either record", () => {
    const db = open(); const src = source(db, 1);
    effect(src, "renamed-response", { input: 10, responseModelId: "served-model" }); measurement(src, "renamed-response");
    expect(createRequestAttributionRepo(db).read("taki", at)).toMatchObject({ status: "ready", reason: null, request: {
      effectId: "renamed-response", provider: "p", modelId: "m", responseModelId: "served-model", inputTokens: 10,
      window: { effectiveRealTokens: 80 }, composition: { totalUnits: 9, coverage: { status: "complete" } },
    } });
    expect(JSON.parse(String(db.prepare("SELECT source_ref_json FROM run_effects WHERE effect_id='renamed-response'").get()?.source_ref_json)))
      .toMatchObject({ modelId: "m" });
    expect(db.prepare("SELECT model_id FROM run_usage WHERE effect_id='renamed-response'").get()?.model_id).toBe("served-model");
  });
  it("refuses cross-associated source, population, requested-model and provider identities", () => {
    for (const override of [{ primaryInputSeq: 9 }, { population: "worker" as const }, { modelId: "another" }, { provider: "another" }]) {
      const db = open(); const src = source(db, 1); effect(src, "m", { input: 0 }); measurement(src, "m", override);
      expect(createRequestAttributionRepo(db).read("taki").reason).toBe("data-inconsistent");
    }
    const db = open(); const src = source(db, 1); effect(src, "m", { input: 0 }); measurement(src, "m");
    db.exec("UPDATE run_usage SET provider='wrong' WHERE effect_id='m'");
    expect(createRequestAttributionRepo(db).read("taki").reason).toBe("data-inconsistent");
  });
  it.each(["run_id", "attempt_id"])("refuses usage from a different %s even when its Effect and provider match", (column) => {
    const db = open(); const src = source(db, 1); source(db, 2);
    effect(src, "main", { input: 10, responseModelId: "served-model" }); measurement(src, "main");
    db.prepare(`UPDATE run_usage SET ${column}=:identity WHERE effect_id='main'`)
      .run({ identity: column === "run_id" ? "r2" : "a2" });
    expect(createRequestAttributionRepo(db).read("taki")).toMatchObject({ status: "unavailable", reason: "data-inconsistent", request: null });
  });
  it("refuses a measurement recorded under another Attempt even when its Effect and model match", () => {
    const db = open(); const src = source(db, 1);
    db.exec(`INSERT INTO run_attempts (attempt_id,run_id,ordinal,state,provider,model_id,snapshot_id)
      VALUES ('another-attempt','r1',2,'effect_running','p','m','r1')`);
    effect(src, "main", { input: 10 }); measurement({ ...src, attempt: "another-attempt" }, "main");
    expect(createRequestAttributionRepo(db).read("taki")).toMatchObject({ status: "unavailable", reason: "data-inconsistent", request: null });
  });
  it("distinguishes no data, malformed measurement and read failure", () => {
    const db = open(); expect(createRequestAttributionRepo(db).read("taki").status).toBe("empty");
    const src = source(db, 1); effect(src, "m", { input: 10 });
    db.prepare(`INSERT INTO run_events (event_id,run_id,attempt_id,seq,schema_version,category,kind,occurred_at,source,payload_json)
      VALUES ('bad',:run,:attempt,2,'context-request.v1','context','context.request.measured',:at,'core.context-observer','malformed')`)
      .run({ run: src.run, attempt: src.attempt, at });
    expect(createRequestAttributionRepo(db).read("taki").reason).toBe("data-inconsistent");
    vi.spyOn(db, "prepare").mockImplementation(() => { throw new Error("private DB detail"); });
    expect(createRequestAttributionRepo(db).read("taki")).toMatchObject({ reason: "read-failed", request: null });
  });
  it("round-trips new events through the strict ledger and semantic Monitor projections", () => {
    const db = open(); const src = source(db, 1); effect(src, "effect-private-id", { input: 10 });
    const event = measurement(src, "effect-private-id");
    expect(createRunEventRepo(db).get(src.run, event.eventId)).toEqual(event);
    expect(projectEvent(event)).toMatchObject({ kind: "context", modelEffectId: "effect-private-id", label: "请求上下文测量" });
    expect(JSON.stringify(inspectEvent(event, "FULL_LOCAL"))).not.toContain("effect-private-id");
  });
  it("never relabels historical estimated or unknown input as provider-reported usage", () => {
    for (const quality of ["estimated", "unknown"]) {
      const db = open(); const src = source(db, 1); effect(src, "m", { input: 15 }); measurement(src, "m");
      db.prepare("UPDATE run_usage SET quality=:quality WHERE effect_id='m'").run({ quality });
      expect(createRequestAttributionRepo(db).read("taki")).toMatchObject({ status: "partial", reason: "usage-missing", request: { inputTokens: null } });
    }
  });
  it("bounds sparse primary-source scans and reports exhaustion instead of false empty data", () => {
    const db = open();
    for (let seq = 1; seq <= 257; seq++) source(db, seq);
    const prepare = vi.spyOn(db, "prepare");
    expect(createRequestAttributionRepo(db).read("taki").reason).toBe("scan-exhausted");
    const effectQueries = prepare.mock.calls.filter(([sql]) => sql.includes("FROM run_effects e"));
    expect(effectQueries).toHaveLength(256);
    const query = effectQueries[0]![0];
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${query}`).all({ runId: "r257" });
    expect(plan.map((row) => row.detail).join(" ")).toMatch(/SEARCH e USING INDEX \S+ \(run_id=\?\)/);
    expect(plan.map((row) => row.detail).join(" ")).toMatch(/SEARCH ev USING INDEX \S+ \(run_id=\?\)/);
  });
  it("preserves contextOrigin through tool-call input scrubbing and tool-result JSON", () => {
    const db = open(); const timeline = createTimelineRepo(db);
    timeline.append({ characterId: "taki", role: "assistant", content: "tool", parts: [
      { type: "tool-call", toolCallId: "c", toolName: "extension_call", contextOrigin: "builtin", input: { secret: "private" } },
      { type: "tool-result", toolCallId: "c", toolName: "extension_call", contextOrigin: "skill", output: { type: "json", value: { title: "loaded" } } },
    ] });
    const entry = timeline.latestAscending("taki", 1)[0]!;
    expect(entry.parts).toMatchObject([{ contextOrigin: "builtin" }, { contextOrigin: "skill" }]);
    expect(entry.parts?.[0]).not.toHaveProperty("input");
    expect(JSON.stringify(entry)).not.toContain("private");
  });
});
