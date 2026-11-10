import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { unknownAuxiliaryUsage } from "../observability/auxiliary-usage-normalization.ts";
import { rmTempDir } from "../testing/rm-temp.ts";
import { createAuxiliaryUsageRepo } from "./auxiliary-usage-repo.ts";
import { createCacheUsageRepo } from "./cache-usage-repo.ts";
import { createCompactionOperationRepo } from "./compaction-operation-repo.ts";
import { createSummaryRepo } from "./summary-repo.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";

const cleanup: Array<() => void> = [];
afterEach(() => { for (const close of cleanup.splice(0).reverse()) close(); });
const NOW = "2026-11-01T12:00:00.000Z";
const BEFORE = "2026-11-01T11:00:00.000Z";
const AFTER = "2026-11-01T13:00:00.000Z";
const DIGEST = "a".repeat(64);

function open(path = ":memory:", old: boolean | number = false) {
  const db = openDatabase({ path, migrations: old ? MIGRATIONS.filter((m) => m.version < (typeof old === "number" ? old : 66)) : MIGRATIONS });
  cleanup.push(() => db.close());
  return db;
}
function file() {
  const root = mkdtempSync(join(tmpdir(), "taki-cache-window-"));
  cleanup.push(() => rmTempDir(root));
  return join(root, "state.db");
}
function seedRun(db: Database) {
  db.exec(`INSERT INTO run_snapshots (snapshot_id,run_id,schema_version,manifest_json,manifest_digest,captured_at,created_at)
    VALUES ('s','r','harness.v1','{}','${DIGEST}','${BEFORE}','${BEFORE}');
    INSERT INTO runs (run_id,character_id,trigger_request_id,idempotency_key,request_hash,initiator,provenance_json,
      delivery_class,state,state_version,snapshot_id,active_attempt_id,queued_at,operation_phase,created_at,updated_at)
    VALUES ('r','taki','t','i','h','primary','{}','class_a','running',1,'s','a','${BEFORE}','executing','${BEFORE}','${BEFORE}');
    INSERT INTO run_attempts (attempt_id,run_id,ordinal,state,state_version,provider,model_id,snapshot_id)
    VALUES ('a','r',1,'effect_running',1,'custom-alias','m','s');`);
}
function primary(db: Database, input: { input?: number; cache?: number; observed?: boolean; at?: string; old?: boolean } = {}) {
  const id = randomUUID(); const at = input.at ?? NOW;
  db.prepare(`INSERT INTO run_effects (effect_id,run_id,attempt_id,schema_version,kind,state,state_version,
    source_ref_json,replay_posture,created_at,updated_at) VALUES (:id,'r','a','effect.v1','model','terminal',1,'{}','never',:at,:at)`)
    .run({ id, at });
  db.prepare(`INSERT INTO run_usage (usage_id,run_id,attempt_id,effect_id,schema_version,provider,model_id,quality,
    input_tokens,cache_read_tokens,recorded_at${input.old ? "" : ",cache_read_observed"})
    VALUES (:id,'r','a',:id,'effect.v1','custom-alias','m','reported',:input,:cache,:at${input.old ? "" : ",:observed"})`)
    .run({ id, input: input.input ?? null, cache: input.cache ?? null, at,
      ...(input.old ? {} : { observed: input.observed === undefined ? null : Number(input.observed) }) });
  return id;
}
function auxiliary(db: Database, values: { input?: number; cache?: number; label?: string; status?: "completed" | "failed" | "cancelled"; at?: string | null } = {}) {
  const repo = createAuxiliaryUsageRepo(db); const callId = randomUUID();
  const label = values.label ?? "episodic";
  // Historical fixtures emulate their original writer, without requiring future columns.
  if (!db.prepare("PRAGMA table_info(auxiliary_model_calls)").all().some((column) => column.name === "operation_json")) {
    db.prepare(`INSERT INTO auxiliary_model_calls (call_id,source,label,provider,model_id,started_at,updated_at,status)
      VALUES (:callId,'utility',:label,'custom-alias','m',:at,:at,'started')`).run({ callId, label, at: BEFORE });
    return { callId, settle: () => db.prepare(`UPDATE auxiliary_model_calls SET status=:status,finished_at=:at,
      input_tokens=:input,cache_read_tokens=:cache WHERE call_id=:callId`).run({ callId,
      status: values.status ?? "completed", at: values.at === undefined ? NOW : values.at,
      input: values.input ?? null, cache: values.cache ?? null }) };
  }
  repo.start({ callId, taskId: null, source: "utility", label, provider: "custom-alias", modelId: "m", startedAt: BEFORE });
  const settle = () => repo.settle({ callId, status: values.status ?? "completed", finishedAt: values.at === undefined ? NOW : values.at,
    responseId: null, usage: { ...unknownAuxiliaryUsage(), inputTokens: values.input ?? null, cacheReadTokens: values.cache ?? null } });
  return { callId, settle };
}
function begin(db: Database, revision = 0, notify?: () => void) {
  const repo = createCompactionOperationRepo(db, { onSummaryCommitted: notify });
  const result = repo.begin({ operationId: randomUUID(), characterId: "taki", reason: "pressure",
    selectedFromSeq: revision * 6 + 1, selectedThroughSeq: (revision + 1) * 6, capturedTailSeq: (revision + 1) * 6 + 4,
    expectedSummaryRevision: revision, expectedSummaryThrough: revision * 6, sourceDigest: DIGEST,
    beforeTokens: 90, provider: "custom-alias", modelId: "m", owner: "generation", now: NOW, expiresAt: AFTER });
  if (result.status !== "started") throw new Error("expected lease");
  return { repo, lease: result.lease, commit: () => repo.commitSummary({ lease: result.lease, text: "retained facts", sourceDigest: DIGEST, now: NOW }) };
}

describe("global primary-summary cache window", () => {
  it("excludes only tidy and compact calls while retaining their ledger and the successful summary boundary", () => {
    const db = open(); seedRun(db);
    primary(db, { input: 100, cache: 80, observed: true });
    auxiliary(db, { input: 100, cache: 20 }).settle();
    const repo = createCacheUsageRepo(db);
    const before = repo.read("taki", NOW);
    expect(before).toMatchObject({ scope: "regular-model-requests", inputTokens: 200, cacheReadTokens: 100,
      observedRequests: 2, ratio: 0.5 });
    auxiliary(db, { label: "tidy", input: 100_000, cache: 90_000 }).settle();
    auxiliary(db, { label: "compact", input: 100_000, cache: 0, status: "failed" }).settle();
    expect(repo.read("taki", NOW)).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) AS n FROM auxiliary_model_calls").get()?.n).toBe(3);
    begin(db).commit();
    expect(repo.read("taki", NOW)).toMatchObject({ status: "empty", summaryRevision: 1, boundary: "captured" });
  });

  it("weights the same eligible pairs, includes explicit zero and failed calls, and discloses unknown/legacy zero", () => {
    const db = open(); seedRun(db);
    primary(db, { input: 100, cache: 90 });
    primary(db, { input: 100, cache: 0 });
    primary(db, { input: 100, cache: 0, observed: true });
    primary(db, { input: 100, cache: 50, observed: false });
    primary(db, { input: 0, cache: 0, observed: true });
    primary(db, { input: 100, cache: 101, observed: true });
    primary(db, { input: Number.MAX_SAFE_INTEGER + 1, cache: 20, observed: true });
    auxiliary(db, { input: 800, cache: 400, status: "failed" }).settle();
    auxiliary(db, { input: 100, cache: 0, status: "cancelled" }).settle();
    auxiliary(db);
    expect(createCacheUsageRepo(db).read("taki", AFTER)).toMatchObject({ status: "ready", boundary: "before-first-summary",
      summaryRevision: 0, summaryCommittedAt: null, observedRequests: 9, pairedRequests: 4,
      inputTokens: 1100, cacheReadTokens: 490, ratio: 490 / 1100 });
  });

  it("captures exact commit order with equal timestamps, crossing calls, duplicate settlement and duplicate summary", () => {
    const db = open(); seedRun(db); const repo = createCacheUsageRepo(db); const notify = vi.fn();
    primary(db, { input: 100, cache: 80, observed: true });
    auxiliary(db, { input: 500, cache: 400 }).settle(); // Regular auxiliary work settles before the summary commit.
    const crossing = auxiliary(db, { input: 100, cache: 10 });
    const summary = begin(db, 0, notify);
    expect(summary.commit()).toBe("committed");
    expect(repo.read("taki", NOW)).toMatchObject({ status: "empty", boundary: "captured", summaryRevision: 1,
      observedRequests: 0, pairedRequests: 0, inputTokens: 0, cacheReadTokens: 0, ratio: null });
    primary(db, { input: 100, cache: 0, observed: true }); crossing.settle(); crossing.settle();
    expect(summary.commit()).toBe("duplicate");
    expect(notify).toHaveBeenCalledOnce();
    expect(repo.read("taki", NOW)).toMatchObject({ status: "ready", observedRequests: 2, pairedRequests: 2,
      inputTokens: 200, cacheReadTokens: 10, ratio: 0.05 });
  });

  it("persists the captured window unchanged across a real SQLite reopen", () => {
    const path = file(); const db = open(path); seedRun(db);
    primary(db, { input: 100, cache: 80, observed: true }); begin(db).commit();
    auxiliary(db, { input: 300, cache: 150 }).settle();
    const before = createCacheUsageRepo(db).read("taki", AFTER); db.close();
    expect(createCacheUsageRepo(open(path)).read("taki", AFTER)).toEqual(before);
  });

  it("defers notifications until outer commit and preserves both old summary and baseline on rollback", () => {
    const db = open(); const notify = vi.fn(); begin(db).commit();
    auxiliary(db, { input: 100, cache: 20 }).settle();
    const repo = createCacheUsageRepo(db); const before = repo.read("taki", NOW); const next = begin(db, 1, notify);
    expect(() => db.transaction(() => { expect(next.commit()).toBe("committed"); expect(notify).not.toHaveBeenCalled();
      throw new Error("rollback"); })).toThrow("rollback");
    expect(repo.read("taki", NOW)).toEqual(before); expect(notify).not.toHaveBeenCalled();
    expect(next.commit()).toBe("committed"); expect(notify).toHaveBeenCalledOnce();
    expect(repo.read("taki", NOW).status).toBe("empty");
  });

  it("leaves a valid summary committed if optional baseline storage or its callback fails", () => {
    const db = open(); begin(db).commit();
    db.exec("CREATE TRIGGER fail_cache_capture BEFORE UPDATE ON cache_usage_baselines BEGIN SELECT RAISE(ABORT,'metric unavailable'); END");
    const next = begin(db, 1, () => { throw new Error("observer failed"); });
    expect(next.commit()).toBe("committed");
    expect(createSummaryRepo(db).getCheckpoint("taki")?.revision).toBe(2);
    expect(createCacheUsageRepo(db).read("taki", NOW)).toMatchObject({ status: "unavailable", reason: "boundary-unknown", summaryRevision: 2 });
  });

  it("does not reset for generated, failed, cancelled or stale compaction and refuses compatibility overwrite", () => {
    const db = open(); begin(db).commit(); auxiliary(db, { input: 10, cache: 2 }).settle();
    const repo = createCacheUsageRepo(db); const before = repo.read("taki", NOW);
    const generated = begin(db, 1); generated.repo.recordSummaryGenerated({ lease: generated.lease, outputChars: 10, now: NOW });
    expect(repo.read("taki", NOW)).toEqual(before);
    generated.repo.fail({ lease: generated.lease, code: "SUMMARY_GENERATION_FAILED", now: NOW });
    expect(generated.commit()).toBe("stale"); expect(repo.read("taki", NOW)).toEqual(before);
    const cancelled = begin(db, 1); cancelled.repo.cancelActive({ characterId: "taki", now: NOW });
    expect(cancelled.commit()).toBe("stale"); expect(repo.read("taki", NOW)).toEqual(before);
    createSummaryRepo(db).upsert({ characterId: "taki", throughSeq: 12, text: "compatibility" });
    expect(repo.read("taki", NOW)).toMatchObject({ status: "unavailable", reason: "boundary-unknown" });
  });

  it("marks unsupported ledger deletion and unsafe sums inconsistent rather than inventing zero", () => {
    const db = open(); seedRun(db); const id = primary(db, { input: 100, cache: 80, observed: true }); begin(db).commit();
    db.prepare("DELETE FROM run_usage WHERE usage_id=:id").run({ id });
    expect(createCacheUsageRepo(db).read("taki", NOW)).toMatchObject({ status: "unavailable", reason: "data-inconsistent" });
    primary(db, { input: Number.MAX_SAFE_INTEGER, cache: 80, observed: true });
    primary(db, { input: Number.MAX_SAFE_INTEGER, cache: 80, observed: true });
    expect(createCacheUsageRepo(db).read("taki", NOW)).toMatchObject({ status: "unavailable", reason: "data-inconsistent" });
  });

  it("counts unknown settled usage without synthesizing a zero percentage and returns a read-failure state", () => {
    const db = open(); auxiliary(db).settle();
    expect(createCacheUsageRepo(db).read("taki", NOW)).toMatchObject({ status: "empty", observedRequests: 1,
      pairedRequests: 0, inputTokens: 0, cacheReadTokens: 0, ratio: null });
    db.exec("DROP TABLE auxiliary_model_calls");
    expect(createCacheUsageRepo(db).read("taki", NOW)).toMatchObject({ status: "unavailable", reason: "read-failed" });
    db.close();
    expect(createCacheUsageRepo(db).read("taki", NOW)).toMatchObject({ status: "unavailable", reason: "read-failed" });
  });
});

describe("migration 066 historical baseline", () => {
  it("does not block migration when historical eligible sums exceed safe integer capacity", () => {
    const path = file(); const old = open(path, true); seedRun(old);
    primary(old, { input: Number.MAX_SAFE_INTEGER, cache: 80, at: BEFORE, old: true });
    primary(old, { input: Number.MAX_SAFE_INTEGER, cache: 80, at: BEFORE, old: true });
    begin(old).commit(); old.close(); const db = open(path);
    expect(db.prepare("SELECT max(version) AS v FROM migrations").get()?.v).toBe(72);
    expect(createCacheUsageRepo(db).read("taki", AFTER)).toMatchObject({ status: "unavailable", reason: "boundary-unknown" });
  });

  it("preserves old values and uses original completion times rather than auxiliary import updated_at", () => {
    const path = file(); const old = open(path, true); seedRun(old);
    primary(old, { input: 100, cache: 80, at: BEFORE, old: true });
    primary(old, { input: 100, cache: 30, at: AFTER, old: true });
    primary(old, { input: 100, cache: 0, at: AFTER, old: true });
    auxiliary(old, { input: 100, cache: 60, at: BEFORE }).settle();
    auxiliary(old, { input: 100, cache: 0, at: AFTER }).settle(); begin(old).commit();
    old.exec(`UPDATE auxiliary_model_calls SET updated_at='2026-11-02T00:00:00.000Z'`);
    const prior = old.prepare("SELECT * FROM run_usage ORDER BY usage_id").all(); old.close();
    const migrated = open(path); const repo = createCacheUsageRepo(migrated);
    expect(migrated.prepare("SELECT * FROM run_usage ORDER BY usage_id").all())
      .toEqual(prior.map((row) => ({ ...row, cache_read_observed: null })));
    const expected = repo.read("taki", AFTER);
    expect(expected).toMatchObject({ status: "ready", boundary: "historical", observedRequests: 3, pairedRequests: 2,
      inputTokens: 200, cacheReadTokens: 30, ratio: 0.15 }); migrated.close();
    expect(createCacheUsageRepo(open(path)).read("taki", AFTER)).toEqual(expected);
  });

  it.each([NOW, null])("keeps ambiguous historical completion %s unavailable until a natural new summary", (at) => {
    const path = file(); const old = open(path, true); auxiliary(old, { input: 100, cache: 80, at }).settle();
    begin(old).commit(); old.close(); const db = open(path);
    expect(createCacheUsageRepo(db).read("taki", AFTER)).toMatchObject({ status: "unavailable", reason: "boundary-unknown" });
    begin(db, 1).commit();
    expect(createCacheUsageRepo(db).read("taki", AFTER)).toMatchObject({ status: "empty", boundary: "captured", summaryRevision: 2 });
  });
});

describe("migration 068 regular-call baseline", () => {
  it("rebases an old all-call window, preserves observed zero, and ignores excluded timestamp ties", () => {
    const path = file(); const old = open(path, 68); seedRun(old);
    primary(old, { input: 100, cache: 80, observed: true, at: BEFORE });
    primary(old, { input: 100, cache: 0, observed: true, at: AFTER });
    auxiliary(old, { label: "tidy", input: 90_000, cache: 80_000, at: NOW }).settle();
    auxiliary(old, { label: "compact", input: 90_000, cache: 0, at: null }).settle();
    begin(old).commit();
    old.prepare(`UPDATE cache_usage_baselines SET observed_requests=4,paired_requests=4,input_tokens=180200,cache_read_tokens=80080`).run();
    const previous = old.prepare("SELECT * FROM auxiliary_model_calls ORDER BY call_id").all(); old.close();
    const migrated = open(path);
    expect(migrated.prepare("SELECT * FROM auxiliary_model_calls ORDER BY call_id").all())
      .toEqual(previous.map((row) => ({ ...row, operation_json: null })));
    const snapshot = createCacheUsageRepo(migrated).read("taki", AFTER);
    expect(snapshot).toMatchObject({ status: "ready", boundary: "historical", observedRequests: 1,
      pairedRequests: 1, inputTokens: 100, cacheReadTokens: 0, ratio: 0, scope: "regular-model-requests" });
    migrated.close();
    expect(createCacheUsageRepo(open(path)).read("taki", AFTER)).toEqual(snapshot);
  });

  it.each([NOW, null])("refuses ambiguous included completion %s until a new summary captures exact order", (at) => {
    const path = file(); const old = open(path, 68);
    auxiliary(old, { input: 100, cache: 20, at }).settle(); begin(old).commit(); old.close();
    const db = open(path); const repo = createCacheUsageRepo(db);
    expect(repo.read("taki", AFTER)).toMatchObject({ status: "unavailable", reason: "boundary-unknown" });
    begin(db, 1).commit();
    expect(repo.read("taki", AFTER)).toMatchObject({ status: "empty", boundary: "captured", summaryRevision: 2 });
  });
});
