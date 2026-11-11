import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { rmTempDir } from "../testing/rm-temp.ts";
import { curatorTestFixture, curatorTestTarget } from "../memory/hindsight/hindsight-policy-curator-fixtures.ts";
import { proposeHindsightPolicyAssessment } from "../memory/hindsight/hindsight-policy-assessment.ts";
import { createHindsightPolicyWorkRepo, policyWorkClaim } from "./hindsight-policy-work-repo.ts";
import { policyAssessmentTarget, policyWorkValueHash, type HindsightPolicyWorkRecord } from "./hindsight-policy-work-contract.ts";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
function fixture(input: Parameters<typeof curatorTestFixture>[0] = {}) {
  const value = curatorTestFixture(input); cleanup.push(value.close); return value;
}
function path() { const root = mkdtempSync(join(tmpdir(), "taki-policy-work-")); cleanup.push(() => rmTempDir(root)); return join(root, "memory.sqlite"); }
function prepare(f: ReturnType<typeof fixture>) {
  return f.work.prepare({ scope: { ...f.banks[0]!.scope, authorityEpochId: "epoch" }, target: curatorTestTarget(f) });
}
const prompt = { promptVersion: "test-policy-prompt/v1", promptHash: policyWorkValueHash({ system: "fixture", prompt: "fixture report" }) };
function assessment(record: HindsightPolicyWorkRecord, importance = 5) {
  if (record.target.kind !== "policy") throw new Error("policy fixture required");
  const at = record.updatedAt;
  const body = proposeHindsightPolicyAssessment({ ...policyAssessmentTarget(record.key, record.target),
    policy: { layerId: "profile", importance, visibility: "retrieved", disclosure: "fixture trigger", emotionalWeight: null,
      retention: { kind: "permanent" } }, intent: "automatic", prompt, completedAt: at });
  return { kind: "assessment" as const, body, prompt, at };
}
function admitted(f: ReturnType<typeof fixture>, record = prepare(f)) {
  const claimed = f.work.claim({ key: record.key, leaseMs: 1000 })!;
  return f.work.prompt({ claim: policyWorkClaim(claimed), prompt });
}

describe("durable exact policy work claims and proposals", () => {
  it.each(["complete", "supersede"] as const)("notifies first committed saves and %s without hints for claim/prompt/replay", (terminal) => {
    const hints: string[] = [];
    const f = fixture({ onPolicyReviewChanged: (bankId) => {
      hints.push(bankId);
      expect(f.db.isTransaction).toBe(false);
    } });
    const current = admitted(f); expect(hints).toEqual([]);
    const result = assessment(current);
    const saved = f.work.saveResult({ claim: policyWorkClaim(current), result });
    expect(hints).toEqual([current.key.bankId]);
    expect(f.work.saveResult({ claim: policyWorkClaim(saved), result })).toEqual(saved);
    expect(hints).toHaveLength(1);
    f.work[terminal](policyWorkClaim(saved)); expect(hints).toEqual([current.key.bankId, current.key.bankId]);
  });
  it("guards private atomic reads at entry/exit while public reads retain admission", () => {
    const f = fixture(); const assertActive = vi.fn();
    const work = createHindsightPolicyWorkRepo({ db: f.db, now: () => f.clock.at, assertActive });
    const record = work.prepare({ scope: { ...f.banks[0]!.scope, authorityEpochId: "epoch" }, target: curatorTestTarget(f) });
    expect(assertActive).toHaveBeenCalledTimes(2); assertActive.mockClear();
    expect(work.get(record.key)).toEqual(record); expect(assertActive).toHaveBeenCalledOnce(); assertActive.mockClear();
    expect(work.claim({ key: record.key, leaseMs: 1000 })).toBeDefined(); expect(assertActive).toHaveBeenCalledTimes(2);
  });
  it("uses one stable target and command identity and returns the original preparation on retry", () => {
    const f = fixture(); const first = prepare(f); f.clock.at = "2026-09-11T08:00:01.000Z";
    expect(prepare(f)).toEqual(first); expect(first.commandRequestId).toBe(`hindsight-${first.key.workId}`);
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM hindsight_policy_work").get()?.n).toBe(1);
    const targetBytes = f.db.prepare("SELECT target_bytes FROM hindsight_policy_work").get()?.target_bytes;
    expect(targetBytes).toBeInstanceOf(Uint8Array);
    expect(f.work.get(first.key)?.target).toEqual(curatorTestTarget(f));
  });

  it("fences concurrent claims and refuses the old claimant after lease expiry and takeover", () => {
    const f = fixture(); const original = prepare(f); const first = f.work.claim({ key: original.key, leaseMs: 1000 })!;
    expect(f.work.claim({ key: original.key, leaseMs: 1000 })).toBeUndefined();
    f.clock.at = "2026-09-11T08:00:01.000Z";
    const second = f.work.claim({ key: original.key, leaseMs: 1000 })!;
    expect(second.claimToken).not.toBe(first.claimToken); expect(second.claims).toBe(2);
    expect(() => f.work.prompt({ claim: policyWorkClaim(first), prompt })).toThrow("MEMORY_REVISION_MISMATCH");
    expect(f.work.get(original.key)).toEqual(second);
    expect(f.work.prompt({ claim: policyWorkClaim(second), prompt })).toMatchObject({ prompt });
  });

  it("preserves saved result, effective prompt and original command bytes through reopen and reclaim", async () => {
    const file = path(); const f = fixture({ path: file }); const current = admitted(f); const result = assessment(current);
    const saved = f.work.saveResult({ claim: policyWorkClaim(current), result });
    expect(f.work.saveResult({ claim: policyWorkClaim(saved), result })).toEqual(saved);
    const rows = f.db.prepare("SELECT target_bytes,result_bytes,command_request_id FROM hindsight_policy_work").all();
    await f.close(); const reopened = fixture({ path: file, banks: f.banks, clock: f.clock });
    expect(reopened.work.get(saved.key)).toEqual(saved);
    expect(reopened.db.prepare("SELECT target_bytes,result_bytes,command_request_id FROM hindsight_policy_work").all()).toEqual(rows);
    expect(reopened.work.pending({ ...saved.key, limit: 10 })).toEqual([]);
    reopened.clock.at = "2026-09-11T08:00:01.000Z";
    const retry = reopened.work.claim({ key: saved.key, leaseMs: 1000 })!;
    expect(retry).toMatchObject({ state: "saved", result, prompt, commandRequestId: saved.commandRequestId, claims: 2 });
    const completed = reopened.work.complete(policyWorkClaim(retry));
    expect(completed).toMatchObject({ state: "completed", result, claimToken: null, claimUntil: null });
    expect(reopened.work.pending({ ...saved.key, limit: 10 })).toEqual([]);
  });

  it("never replaces an admitted policy prompt or an immutable result with another attempt", () => {
    const f = fixture(); const current = admitted(f);
    expect(f.work.prompt({ claim: policyWorkClaim(current), prompt })).toEqual(current);
    expect(() => f.work.prompt({ claim: policyWorkClaim(current), prompt: { ...prompt, promptHash: "a".repeat(64) } }))
      .toThrow("MEMORY_REQUEST_ID_CONFLICT");
    const saved = f.work.saveResult({ claim: policyWorkClaim(current), result: assessment(current) });
    expect(() => f.work.saveResult({ claim: policyWorkClaim(saved), result: assessment(current, 6) })).toThrow("MEMORY_REQUEST_ID_CONFLICT");
    expect(f.work.get(saved.key)).toEqual(saved);
  });

  it("rejects a forged policy version before any durable row mutation", () => {
    const f = fixture(); const current = admitted(f); const result = assessment(current);
    result.body.policy.policyVersion = 99;
    expect(() => f.work.saveResult({ claim: policyWorkClaim(current), result })).toThrow("MEMORY_INTEGRITY_ERROR");
    expect(f.work.get(current.key)).toEqual(current);
  });

  it("keeps failed work durable and enforces the shared one-minute then five-minute retry delay", () => {
    const f = fixture(); const original = prepare(f); const first = f.work.claim({ key: original.key, leaseMs: 1000 })!;
    const deferred = f.work.defer({ claim: policyWorkClaim(first), failure: "model_failed" });
    expect(deferred).toMatchObject({ state: "ready", claimToken: null, nextAttemptAt: "2026-09-11T08:01:00.000Z" });
    expect(f.work.pending({ ...original.key, limit: 10 })).toEqual([]);
    f.clock.at = "2026-09-11T08:01:00.000Z";
    expect(f.work.pending({ ...original.key, limit: 10 })).toEqual([deferred]);
    const second = f.work.claim({ key: original.key, leaseMs: 1000 })!;
    expect(f.work.defer({ claim: policyWorkClaim(second), failure: "model_failed" }))
      .toMatchObject({ claims: 2, nextAttemptAt: "2026-09-11T08:06:00.000Z" });
  });

  it("rolls back a saved proposal when the active-scope guard changes during the same transaction", () => {
    const f = fixture(); const current = admitted(f); let rejectSaved = true;
    const changed = vi.fn();
    const work = createHindsightPolicyWorkRepo({ db: f.db, now: () => f.clock.at, onPolicyReviewChanged: changed, assertActive: () => {
      if (rejectSaved && f.db.prepare("SELECT 1 FROM hindsight_policy_work WHERE state='saved'").get()) throw new Error("MEMORY_AUTHORITY_MISMATCH");
    } });
    expect(() => work.saveResult({ claim: policyWorkClaim(current), result: assessment(current) })).toThrow("MEMORY_AUTHORITY_MISMATCH");
    expect(changed).not.toHaveBeenCalled();
    expect(f.work.get(current.key)).toEqual(current); rejectSaved = false;
    expect(work.saveResult({ claim: policyWorkClaim(current), result: assessment(current) }).state).toBe("saved");
    expect(changed).toHaveBeenCalledExactlyOnceWith(current.key.bankId);
  });

  it("does not notify a saved result whose deferred COMMIT fails", () => {
    const changed = vi.fn(); const f = fixture({ onPolicyReviewChanged: changed }); const current = admitted(f);
    f.db.exec(`CREATE TABLE review_fk_parent(id INTEGER PRIMARY KEY);
      CREATE TABLE review_fk_child(id INTEGER REFERENCES review_fk_parent(id) DEFERRABLE INITIALLY DEFERRED);
      CREATE TRIGGER review_fail_save AFTER UPDATE ON hindsight_policy_work WHEN NEW.state='saved'
      BEGIN INSERT INTO review_fk_child VALUES(99); END;`);
    expect(() => f.work.saveResult({ claim: policyWorkClaim(current), result: assessment(current) })).toThrow();
    expect(changed).not.toHaveBeenCalled(); expect(f.work.get(current.key)).toEqual(current);
  });

  it("rolls back preparation after deferred COMMIT failure and leaves the SQLite connection reusable", () => {
    const f = fixture(); f.db.exec(`CREATE TABLE curator_fk_parent(id INTEGER PRIMARY KEY);
      CREATE TABLE curator_fk_child(id INTEGER REFERENCES curator_fk_parent(id) DEFERRABLE INITIALLY DEFERRED);
      CREATE TRIGGER curator_fail_commit AFTER INSERT ON hindsight_policy_work BEGIN INSERT INTO curator_fk_child VALUES(99); END;`);
    expect(() => prepare(f)).toThrow();
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM hindsight_policy_work").get()?.n).toBe(0);
    expect(f.db.prepare("SELECT COUNT(*) AS n FROM curator_fk_child").get()?.n).toBe(0);
    f.db.exec("DROP TRIGGER curator_fail_commit"); expect(prepare(f).state).toBe("ready");
  });

  it("rejects corrupt stored bytes, scope mismatches and asynchronous publication guards", () => {
    const f = fixture(); const original = prepare(f);
    expect(() => f.work.get({ ...original.key, namespace: { ...original.key.namespace, bank_generation: "33333333-3333-4333-8333-333333333333" } }))
      .toThrow("MEMORY_AUTHORITY_MISMATCH");
    f.db.prepare("UPDATE hindsight_policy_work SET target_bytes=x'7B7D'").run();
    expect(() => f.work.get(original.key)).toThrow("MEMORY_INTEGRITY_ERROR");
    const second = fixture(); let calls = 0;
    const asyncGuard = createHindsightPolicyWorkRepo({ db: second.db, assertActive: async () => { calls++; } });
    expect(() => asyncGuard.prepare({ scope: { ...second.banks[0]!.scope, authorityEpochId: "epoch" }, target: curatorTestTarget(second) }))
      .toThrow("MEMORY_INVALID_REQUEST");
    expect(calls).toBe(0); expect(second.db.prepare("SELECT COUNT(*) AS n FROM hindsight_policy_work").get()?.n).toBe(0);
  });
});
