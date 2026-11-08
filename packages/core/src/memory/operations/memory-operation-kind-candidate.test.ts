import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../../logging/logger.ts";
import { candidateDomainFixture } from "../hindsight-candidates/hindsight-candidate-domain-fixture.ts";
import type { CandidateDriverContext } from "../hindsight-candidates/hindsight-candidate-service.ts";
import { createMemoryOperationService } from "./memory-operation-service.ts";
import { fakeSetup } from "./memory-operation-fixtures.ts";

describe("registered candidate Memory Operation integration", () => {
  it("refuses absent admission and routes original requests through the existing owner once", async () => {
    const f = candidateDomainFixture();
    const base = { db: f.db, live: () => null, setup: fakeSetup(), bootId: "candidate-owner",
      logger: createLogger("fatal"), onChanged: vi.fn() };
    const bare = createMemoryOperationService(base);
    const driver = vi.fn(async (ctx: CandidateDriverContext) => {
      await ctx.observe(async () => ({}));
    });
    f.setDriver(driver);
    const service = createMemoryOperationService({ ...base, candidates: f.service });
    try {
      expect(() => bare.submit(f.plan.request)).toThrow("MEMORY_OPERATION_UNSUPPORTED");
      expect(f.db.prepare("SELECT count(*) AS count FROM memory_operations").get()?.count).toBe(0);
      const original = service.submit(f.plan.request);
      await service.stop();
      expect(service.status(original.operationId)).toMatchObject({ kind: "candidate.prepare", state: "outcome_unknown" });
      f.current.custodyHash = "0".repeat(64);
      expect(service.submit(f.plan.request).operationId).toBe(original.operationId);
      expect(driver).toHaveBeenCalledTimes(1);
      expect(() => service.submit({ ...f.plan.request, expectedManifestHash: "1".repeat(64) })).toThrow("HINDSIGHT_CANDIDATE_CONFLICT");
      expect(base.onChanged).toHaveBeenCalled();
    } finally { await service.stop(); await bare.stop(); f.close(); }
  });

  it("settles an exact committed inspection on reopen without a fresh Host driver or custody lookup", async () => {
    const f = candidateDomainFixture();
    try {
      f.setDriver(async (ctx) => { await ctx.observe(async () => ({})); });
      const prepareId = f.admit();
      await f.execute(prepareId);
      const candidate = f.record(prepareId);
      const inspectId = f.admit({ kind: "candidate.inspect", requestId: randomUUID(),
        candidateId: candidate.candidateId, expectedPlanHash: candidate.planHash });
      expect(await f.execute(inspectId, false)).toMatchObject({ state: "completed" });
      expect(f.operations.get(inspectId)?.state).toBe("running");
      f.reopen();
      f.current.custodyHash = "0".repeat(64);
      const changes = vi.fn();
      const restarted = createMemoryOperationService({ db: f.db, live: () => null, setup: fakeSetup(), bootId: "new-driverless-boot",
        logger: createLogger("fatal"), onChanged: changes });
      try {
        expect(restarted.status(inspectId)).toMatchObject({ state: "completed", producer: { candidateId: candidate.candidateId } });
        expect(changes).toHaveBeenCalledWith(expect.objectContaining({ operationId: inspectId, state: "completed" }));
        expect(f.db.prepare("SELECT count(*) AS count FROM hindsight_candidate_records").get()?.count).toBe(1);
      } finally { await restarted.stop(); }
    } finally { f.close(); }
  });
});
