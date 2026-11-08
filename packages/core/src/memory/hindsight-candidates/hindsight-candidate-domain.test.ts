import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { HindsightCandidateRecord } from "@taki/shared/hindsight-candidate-domain";
import { candidateDomainFixture, candidateResourceFixture } from "./hindsight-candidate-domain-fixture.ts";
import { candidateDomainHash } from "./hindsight-candidate-domain-read.ts";
import { transitionLocalHash } from "../transitions/transition-local-encoding.ts";
import { observeHindsightCandidateOperation, type CandidateDriverContext } from "./hindsight-candidate-service.ts";

describe("D1-B original candidate persistence (real SQLite and operation/effect repos)", () => {
  it("joins admission atomically, preserves immutable input and resolves the original request before fresh custody after reopen", () => {
    const f = candidateDomainFixture();
    try {
      expect(() => f.db.transaction(() => { f.admit(); throw new Error("outer owner rollback"); })).toThrow("outer owner rollback");
      expect(f.db.prepare("SELECT count(*) AS n FROM memory_operations").get()?.n).toBe(0);
      expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_candidate_records").get()?.n).toBe(0);
      const operationId = f.admit(); const original = f.record(operationId);
      expect(original.plan.source.authorityEpochId).toBe("historical-epoch");
      expect(original.plan.guard.authorityEpochId).toBe("current-epoch");
      expect(() => f.db.exec("UPDATE hindsight_candidate_records SET plan_hash='tampered'")).toThrow("HINDSIGHT_CANDIDATE_IMMUTABLE");
      f.reopen(); f.current.custodyHash = "0".repeat(64);
      expect(f.admit()).toBe(operationId); expect(f.record(operationId)).toEqual(original);
      expect(() => f.admit({ ...f.plan.request, expectedManifestHash: "1".repeat(64) })).toThrow("HINDSIGHT_CANDIDATE_CONFLICT");
      expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_candidate_records").get()?.n).toBe(1);
    } finally { f.close(); }
  });

  it("retains a lost reserve reply, resumes by observing the same resource and never replays its dispatch", async () => {
    const f = candidateDomainFixture(); const effects = vi.fn();
    try {
      const operationId = f.admit(); const record = f.record(operationId);
      const dispatch = f.dispatch(record.candidateId, "reserve"); const physical = candidateResourceFixture(record.candidateId, f.plan);
      f.setDriver(async (ctx) => { await ctx.dispatch(dispatch, async () => { effects(); throw new Error("reply lost after create"); }); });
      expect(await f.execute(operationId)).toMatchObject({ state: "outcome_unknown", reason: "commitment_unknown", result: { unknownActions: ["reserve"] } });
      f.reopen(); expect(f.service.observeBoot(operationId)).toBeNull(); expect(f.record(operationId).dispatches).toEqual([dispatch]);
      const resume = f.admit(continuation(f.record(operationId), "candidate.resume"));
      f.setDriver(async (ctx) => {
        expect(await ctx.dispatch(dispatch, async () => { effects(); })).toEqual({ dispatched: false });
        await ctx.observe(async () => ({ resource: { dispatch, value: physical.resource, sources: physical.sources } }));
      });
      expect(await f.execute(resume)).toMatchObject({ state: "outcome_unknown", reason: "producer_incomplete", result: { phase: "reserved", unknownActions: [] } });
      expect(effects).toHaveBeenCalledTimes(1); expect(f.record(resume).candidateId).toBe(record.candidateId);
      expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_candidate_dispatches").get()?.n).toBe(1);
    } finally { f.close(); }
  });

  it("persists exact restore/baseline facts and recovers only this operation's completed observation after reply loss", async () => {
    const f = candidateDomainFixture();
    try {
      const operationId = f.admit(); const original = f.record(operationId);
      const physical = candidateResourceFixture(original.candidateId, f.plan); const effects = vi.fn();
      f.setDriver(async (ctx) => {
        const reserve = f.dispatch(original.candidateId, "reserve"); await ctx.dispatch(reserve, async () => { effects(); });
        await ctx.observe(async () => ({ resource: { dispatch: reserve, value: physical.resource, sources: physical.sources } }));
        const restore = f.dispatch(original.candidateId, "restore"); await ctx.dispatch(restore, async () => { effects(); });
        const receipt = { version: 1 as const, candidateId: original.candidateId, restoreRequestId: restore.hostRequestId,
          restoreInputHash: restore.inputHash, receiptId: randomUUID(), receiptHash: "7".repeat(64), archiveSha256: f.plan.source.archiveSha256,
          physicalIdentityHash: candidateDomainHash("resource", physical.resource) };
        await ctx.observe(async () => ({ restore: { dispatch: restore, value: receipt } }));
        await ctx.observe(async () => ({ baseline: { dispatch: restore, identity: physical.identity,
          value: { version: 1, stage: "baseline_verified", candidateId: original.candidateId, inventoryHash: f.plan.source.inventoryHash,
            identityHash: transitionLocalHash(physical.identity), requestHash: f.plan.source.backupRequestHash, nativeSchema: "public", observedTemplates: 2 } } }));
      });
      expect(await f.execute(operationId, false)).toMatchObject({ state: "completed", result: { phase: "baseline_verified" } });
      const originalFacts = f.record(operationId); f.reopen();
      const boot = observeHindsightCandidateOperation(f.db, operationId); expect(boot).toMatchObject({ state: "completed", result: { unknownActions: [] } });
      expect(effects).toHaveBeenCalledTimes(2); expect(f.record(operationId)).toEqual(originalFacts);
      f.operations.transition({ operationId, expectedState: "running", patch: boot! });
      const inspect = f.admit(continuation(originalFacts, "candidate.inspect"));
      expect(f.service.observeBoot(inspect)).toBeNull();
      f.setDriver(async () => undefined);
      expect(await f.execute(inspect)).toMatchObject({ state: "outcome_unknown", reason: "producer_incomplete" });
      expect(f.service.observeBoot(inspect)).toBeNull();
      expect(f.record(inspect)).toEqual(originalFacts);
    } finally { f.close(); }
  });

  it("rejects changed Host effects, source/shared resources and wrong archive receipt before persisting those facts", async () => {
    const f = candidateDomainFixture();
    try {
      const operationId = f.admit(); const original = f.record(operationId); const physical = candidateResourceFixture(original.candidateId, f.plan);
      const reserve = f.dispatch(original.candidateId, "reserve"); const effect = vi.fn();
      f.setDriver(async (ctx) => {
        await expect(ctx.dispatch({ ...reserve, inputHash: "0".repeat(64) }, async () => { effect(); })).rejects.toThrow("PROOF_MISMATCH");
        expect(ctx.read().dispatches).toHaveLength(0);
        await ctx.dispatch(reserve, async () => { effect(); });
        await expect(ctx.observe(async () => ({ resource: { dispatch: reserve, value: { ...physical.resource,
          volumes: physical.sources[0]!.volumes }, sources: physical.sources } }))).rejects.toThrow("PROOF_MISMATCH");
        expect(ctx.read().resource).toBeNull();
        await ctx.observe(async () => ({ resource: { dispatch: reserve, value: physical.resource, sources: physical.sources } }));
        const restore = f.dispatch(original.candidateId, "restore"); await ctx.dispatch(restore, async () => { effect(); });
        await expect(ctx.observe(async () => ({ restore: { dispatch: restore, value: { version: 1, candidateId: original.candidateId,
          restoreRequestId: restore.hostRequestId, restoreInputHash: restore.inputHash, receiptId: randomUUID(), receiptHash: "7".repeat(64),
          archiveSha256: "0".repeat(64), physicalIdentityHash: candidateDomainHash("resource", physical.resource) } } }))).rejects.toThrow("PROOF_MISMATCH");
      });
      expect(await f.execute(operationId)).toMatchObject({ state: "outcome_unknown", result: { unknownActions: ["restore"] } });
      expect(f.record(operationId).restore).toBeNull(); expect(effect).toHaveBeenCalledTimes(2);
      f.reopen(); expect(f.record(operationId).dispatches).toHaveLength(2);
    } finally { f.close(); }
  });

  it("keeps stale custody after a possible effect unknown and permits a freshly admitted read without renewing the old fence", async () => {
    const f = candidateDomainFixture();
    try {
      const operationId = f.admit(); const original = f.record(operationId); const reserve = f.dispatch(original.candidateId, "reserve");
      const physical = candidateResourceFixture(original.candidateId, f.plan); const effects = vi.fn();
      f.setDriver(async (ctx) => { await ctx.dispatch(reserve, async () => { effects(); f.current.custodyHash = "0".repeat(64); }); });
      expect(await f.execute(operationId)).toMatchObject({ state: "outcome_unknown", errorCode: "HINDSIGHT_CANDIDATE_STALE" });
      const inspect = f.admit(continuation(f.record(operationId), "candidate.inspect"));
      f.setDriver(async (ctx) => {
        await expect(ctx.dispatch(reserve, async () => { effects(); })).rejects.toThrow("INSPECTION_ONLY");
        await ctx.observe(async () => ({ resource: { dispatch: reserve, value: physical.resource, sources: physical.sources } }));
      });
      expect(await f.execute(inspect)).toMatchObject({ state: "completed", result: { phase: "reserved", unknownActions: [] } });
      expect(effects).toHaveBeenCalledTimes(1); expect(f.record(inspect).dispatches).toEqual([reserve]);
      expect(() => f.admit({ ...continuation(original, "candidate.resume"), expectedPlanHash: "0".repeat(64) })).toThrow("CONFLICT");
    } finally { f.close(); }
  });

  it("cancels only before deferred claim and refuses a stale source guard before dispatch", async () => {
    const f = candidateDomainFixture(); const driver = vi.fn(async () => undefined);
    try {
      f.setDriver(driver); const operationId = f.admit();
      const executing = f.execute(operationId); f.service.cancel(operationId);
      f.operations.transition({ operationId, expectedState: "admitted", patch: { state: "cancelled", reason: "cancelled_before_claim" } });
      expect(await executing).toMatchObject({ state: "cancelled" }); expect(driver).not.toHaveBeenCalled();
      const resume = f.admit(continuation(f.record(operationId), "candidate.resume"));
      f.current.sourceAuthorityHash = "0".repeat(64);
      expect(await f.execute(resume)).toMatchObject({ state: "failed", errorCode: "HINDSIGHT_CANDIDATE_STALE" });
      expect(driver).not.toHaveBeenCalled(); expect(f.record(resume).dispatches).toEqual([]);
      expect(() => f.service.cancel(resume)).toThrow("MEMORY_OPERATION_RUNNING");
    } finally { f.close(); }
  });

  it("revokes detached driver capabilities before physical SQLite close", async () => {
    const f = candidateDomainFixture(); let saved: CandidateDriverContext | undefined;
    try {
      const operationId = f.admit(); const dispatch = f.dispatch(f.record(operationId).candidateId, "reserve");
      f.setDriver(async (ctx) => { saved = ctx; });
      await f.execute(operationId); f.close();
      if (!saved) throw new Error("fixture driver context missing");
      const effect = vi.fn(async () => undefined); const read = vi.fn(async () => ({}));
      expect(() => saved!.read()).toThrow("HINDSIGHT_CANDIDATE_OPERATION_INACTIVE");
      await expect(saved.dispatch(dispatch, effect)).rejects.toThrow("HINDSIGHT_CANDIDATE_OPERATION_INACTIVE");
      await expect(saved.observe(read)).rejects.toThrow("HINDSIGHT_CANDIDATE_OPERATION_INACTIVE");
      expect(effect).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
    } finally { f.close(); }
  });
});

function continuation(record: HindsightCandidateRecord, kind: "candidate.inspect" | "candidate.resume") {
  return { kind, requestId: randomUUID(), candidateId: record.candidateId, expectedPlanHash: record.planHash };
}
