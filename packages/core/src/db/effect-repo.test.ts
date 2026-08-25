import { describe, expect, it } from "vitest";
import { createEffectRepo } from "./effect-repo.ts";
import { createRunEventRepo } from "./run-event-repo.ts";
import { openDatabase } from "./sqlite.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";

function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
  db.exec(`INSERT INTO run_snapshots (snapshot_id,run_id,schema_version,manifest_json,manifest_digest,captured_at,created_at) VALUES ('s','r','harness.v1','{}','${"a".repeat(64)}','2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z');
    INSERT INTO runs (run_id,character_id,trigger_request_id,idempotency_key,request_hash,initiator,provenance_json,delivery_class,state,state_version,snapshot_id,active_attempt_id,queued_at,operation_phase,created_at,updated_at) VALUES ('r','c','t','i','h','primary','{}','class_a','running',1,'s','a','2026-08-24T00:00:00.000Z','executing','2026-08-24T00:00:00.000Z','2026-08-24T00:00:00.000Z');
    INSERT INTO run_attempts (attempt_id,run_id,ordinal,state,state_version,provider,model_id,snapshot_id) VALUES ('a','r',1,'effect_running',1,'p','m','s');`);
  return { db, repo: createEffectRepo(db, createRunEventRepo(db)) };
}

describe("EffectRepo", () => {
  it("commits intent before settlement and couples usage", () => {
    const { db, repo } = fixture();
    const effect = repo.prepareIntent({ runId: "r", attemptId: "a", kind: "model", sourceRef: { type: "model", provider: "p", modelId: "m" }, replayPosture: "never" });
    expect(effect.state).toBe("intent_committed");
    const settled = repo.settle({ effectId: effect.effectId, runId: "r", attemptId: "a", expectedVersion: 0, outcome: "completed", usage: { provider: "p", modelId: "m", quality: "reported", inputTokens: 2, outputTokens: 3, totalTokens: 5 } });
    expect(settled.effect?.outcome).toBe("completed");
    expect(db.prepare("SELECT count(*) AS n FROM run_usage").get()?.n).toBe(1);
    expect(repo.settle({ effectId: effect.effectId, runId: "r", attemptId: "a", expectedVersion: 1, outcome: "completed" }).duplicate).toBe(true);
    db.close();
  });

  it("atomically reserves one captured budget unit per effect intent and fails closed at the limit", () => {
    const { db, repo } = fixture();
    db.prepare("UPDATE runs SET budget_limit=1 WHERE run_id='r'").run();
    const first = repo.prepareIntent({ runId: "r", attemptId: "a", kind: "tool", sourceRef: { type: "tool", toolName: "x" }, replayPosture: "never" });
    expect(first.effectId).toBeTruthy();
    expect(db.prepare("SELECT budget_used FROM runs WHERE run_id='r'").get()?.budget_used).toBe(1);
    expect(() => repo.prepareIntent({ runId: "r", attemptId: "a", kind: "tool", sourceRef: { type: "tool", toolName: "y" }, replayPosture: "never" })).toThrow("RUN_BUDGET_EXHAUSTED");
    expect(db.prepare("SELECT budget_used FROM runs WHERE run_id='r'").get()?.budget_used).toBe(1);
    db.close();
  });

  it("rejects stale callbacks without mutation", () => {
    const { db, repo } = fixture();
    const effect = repo.prepareIntent({ runId: "r", attemptId: "a", kind: "tool", sourceRef: { type: "tool", toolName: "x" }, replayPosture: "safe" });
    expect(repo.settle({ effectId: effect.effectId, runId: "r", attemptId: "a", expectedVersion: 9, outcome: "failed" }).stale).toBe(true);
    expect(repo.get(effect.effectId)?.state).toBe("intent_committed");
    expect(repo.settle({ effectId: effect.effectId, runId: "wrong-run", attemptId: "a", expectedVersion: 0, outcome: "failed" }).stale).toBe(true);
    db.close();
  });

  it("classifies callbacks for an unknown effect as stale", () => {
    const { db, repo } = fixture();
    expect(repo.settle({ effectId: "missing", runId: "r", attemptId: "a", expectedVersion: 0, outcome: "failed" })).toMatchObject({ stale: true, duplicate: false });
    db.close();
  });

  it("writes unknown usage for a terminal model failure when provider counts are absent", () => {
    const { db, repo } = fixture();
    const effect = repo.prepareIntent({ runId: "r", attemptId: "a", kind: "model", sourceRef: { type: "model", provider: "p", modelId: "m" }, replayPosture: "never" });
    const result = repo.settle({ effectId: effect.effectId, runId: "r", attemptId: "a", expectedVersion: 0, outcome: "failed" });
    expect(result.usage?.quality).toBe("unknown");
    expect(db.prepare("SELECT quality FROM run_usage WHERE effect_id=:effectId").get({ effectId: effect.effectId })?.quality).toBe("unknown");
    expect(db.prepare("SELECT count(*) AS n FROM run_events WHERE kind='usage.settled'").get()?.n).toBe(1);
    db.close();
  });

  it("redacts raw provider content and preserves intent/effect/usage order", () => {
    const { db, repo } = fixture();
    const effect = repo.prepareIntent({ runId: "r", attemptId: "a", kind: "model", sourceRef: { type: "model", provider: "secret-provider", modelId: "model" }, replayPosture: "never" });
    repo.settle({ effectId: effect.effectId, runId: "r", attemptId: "a", expectedVersion: 0, outcome: "failed", summary: "provider failed", errorCode: "provider_error", usage: { provider: "secret-provider", modelId: "model", quality: "unknown" } });
    const rows = db.prepare("SELECT kind,payload_json FROM run_events ORDER BY seq").all().map((row) => `${row.kind}:${row.payload_json}`);
    expect(rows.map((row) => row.split(":")[0])).toEqual(["effect.intent_committed", "effect.settled", "usage.settled"]);
    expect(rows.join(" ")).not.toContain("raw prompt");
    expect(rows.join(" ")).not.toContain("Bearer secret");
    expect(db.prepare("SELECT summary,error_code FROM run_effects WHERE effect_id=:effectId").get({ effectId: effect.effectId })).toEqual({ summary: "provider failed", error_code: "provider_error" });
    expect(db.prepare("SELECT provider,model_id,quality FROM run_usage WHERE effect_id=:effectId").get({ effectId: effect.effectId })).toEqual({ provider: "secret-provider", model_id: "model", quality: "unknown" });
    db.close();
  });

  it("does not roll back durable settlement when live publication fails", () => {
    const { db } = fixture();
    const throwingBus = { publish: () => { throw new Error("observer failed"); }, subscribe: () => ({ cursor: 0, overflowed: false, close: () => undefined }) };
    const repo = createEffectRepo(db, createRunEventRepo(db), throwingBus);
    const effect = repo.prepareIntent({ runId: "r", attemptId: "a", kind: "model", sourceRef: { type: "model", provider: "p", modelId: "m" }, replayPosture: "never" });
    expect(() => repo.settle({ effectId: effect.effectId, runId: "r", attemptId: "a", expectedVersion: 0, outcome: "completed", usage: { provider: "p", modelId: "m", quality: "reported", inputTokens: 1, outputTokens: 1, totalTokens: 2 } })).not.toThrow();
    expect(repo.get(effect.effectId)?.state).toBe("terminal");
    expect(db.prepare("SELECT count(*) AS n FROM run_usage").get()?.n).toBe(1);
    db.close();
  });

  it("rejects Approval wait creation after the Attempt becomes terminal", () => {
    const { db, repo } = fixture();
    db.prepare("UPDATE run_attempts SET state='cancelled',state_version=state_version+1 WHERE attempt_id='a' AND run_id='r'").run();
    expect(() => repo.prepareWaiting({ runId: "r", attemptId: "a", kind: "tool", sourceRef: { type: "tool", toolName: "x" }, replayPosture: "never", approvalRef: { approvalId: "approval-1", policyGeneration: 1, approvalGeneration: 1, bindingDigest: "a".repeat(64) } })).toThrow("EFFECT_ATTEMPT_NOT_ACTIVE");
    expect(db.prepare("SELECT count(*) AS n FROM run_effects").get()?.n).toBe(0);
    expect(db.prepare("SELECT count(*) AS n FROM run_events").get()?.n).toBe(0);
    db.close();
  });

  it("classifies late Approval allow and deny callbacks as stale after Attempt termination", () => {
    const { db, repo } = fixture();
    const waiting = repo.prepareWaiting({ runId: "r", attemptId: "a", kind: "tool", sourceRef: { type: "tool", toolName: "x" }, replayPosture: "never", approvalRef: { approvalId: "approval-2", policyGeneration: 1, approvalGeneration: 1, bindingDigest: "b".repeat(64) } });
    const before = db.prepare("SELECT state_version FROM run_attempts WHERE attempt_id='a'").get()?.state_version;
    db.prepare("UPDATE run_attempts SET state='cancelled',state_version=state_version+1 WHERE attempt_id='a' AND run_id='r'").run();
    const allow = repo.commitIntent({ effectId: waiting.effectId, runId: "r", attemptId: "a", expectedVersion: waiting.version });
    const deny = repo.settleWaiting({ effectId: waiting.effectId, runId: "r", attemptId: "a", expectedVersion: waiting.version, outcome: "failed", errorCode: "approval_denied" });
    expect(allow).toMatchObject({ stale: true, duplicate: false });
    expect(deny).toMatchObject({ stale: true, duplicate: false });
    expect(repo.get(waiting.effectId)).toMatchObject({ state: "waiting", version: waiting.version });
    expect(db.prepare("SELECT state_version FROM run_attempts WHERE attempt_id='a'").get()?.state_version).toBe(Number(before) + 1);
    expect(db.prepare("SELECT kind FROM run_events ORDER BY seq").all().map((row) => row.kind)).toEqual(["effect.waiting"]);
    db.close();
  });

  it("rolls back terminal Effect writes when the Attempt is inactive at settlement", () => {
    const { db, repo } = fixture();
    const effect = repo.prepareIntent({ runId: "r", attemptId: "a", kind: "tool", sourceRef: { type: "tool", toolName: "x" }, replayPosture: "never" });
    db.prepare("UPDATE run_attempts SET state='cancelled',state_version=state_version+1 WHERE attempt_id='a' AND run_id='r'").run();
    const result = repo.settle({ effectId: effect.effectId, runId: "r", attemptId: "a", expectedVersion: effect.version, outcome: "completed" });
    expect(result).toMatchObject({ stale: true, duplicate: false });
    expect(repo.get(effect.effectId)).toMatchObject({ state: "intent_committed", version: effect.version });
    expect(db.prepare("SELECT count(*) AS n FROM run_events").get()?.n).toBe(1);
    expect(db.prepare("SELECT count(*) AS n FROM run_usage").get()?.n).toBe(0);
    db.close();
  });
});
