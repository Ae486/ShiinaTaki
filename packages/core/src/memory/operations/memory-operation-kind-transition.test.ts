import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemoryTransitionResolution, MemoryTransitionResult } from "@taki/shared";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createMemoryOperationRepo } from "../../db/memory-operation-repo.ts";
import { claimTransition, changeTransitionAdmission, readTransitionAttempt, readTransitionByRequest, updateTransitionAttempt } from "../../db/memory-transition-repo.ts";
import { readTransitionResult, settleTransition } from "../../db/memory-transition-evidence-repo.ts";
import { readTransitionRecovery, readTransitionResolution, resolveTransition } from "../../db/memory-transition-recovery-repo.ts";
import { seedTransition, startTransition, TRANSITION_AT as AT, TRANSITION_HASH as HASH, transitionIdentity, transitionRequest } from "../../db/memory-transition-fixtures.ts";
import { createLogger } from "../../logging/logger.ts";
import { rmTempDir } from "../../testing/rm-temp.ts";
import { canonicalPayloadHash } from "../legacy-migration/legacy-identities.ts";
import { createMemoryOperationService, type MemoryOperationService } from "./memory-operation-service.ts";
import { fakeSetup, seedHindsightAuthority } from "./memory-operation-fixtures.ts";
import type { MemoryTransitionDriver } from "./memory-operation-transition-storage.ts";

const opened: Database[] = []; const services: MemoryOperationService[] = []; const dirs: string[] = [];
const plan = () => ({ current: transitionIdentity(), actorId: "operator" });
function open(path = ":memory:") { const db = openDatabase({ path, migrations: MIGRATIONS }); opened.push(db); return db; }
function service(db: Database, driver?: MemoryTransitionDriver, now = AT) {
  const value = createMemoryOperationService({ db, setup: fakeSetup(), live: () => null, bootId: "new", now: () => now,
    logger: createLogger("fatal"), onChanged: () => {}, transition: driver }); services.push(value); return value;
}
afterEach(async () => { for (const value of services.splice(0)) await value.stop(); for (const db of opened.splice(0)) db.close(); for (const dir of dirs.splice(0)) rmTempDir(dir); });
function unknown(transitionId: string): MemoryTransitionResult {
  return { kind: "transition", transitionId, receiptId: null, authorityCommitted: false, runtime: "unavailable", queue: "settled",
    outcome: "outcome_unknown", errorCode: "MEMORY_TRANSITION_OUTCOME_UNKNOWN" };
}

describe("transition operation owner integration", () => {
  it("keeps a post-effect operation lookup failure unresolved instead of manufacturing a failed result", async () => {
    const db = open(); seedHindsightAuthority(db); const repo = createMemoryOperationRepo(db, () => AT);
    const owner = createMemoryOperationService({ db, repo, setup: fakeSetup(), live: () => null, bootId: "new", now: () => AT,
      logger: createLogger("fatal"), onChanged: () => {}, transition: { plan, execute: async (input) => {
        const intent = readTransitionByRequest(db, input.request.requestId)!;
        const lease = claimTransition(db, { transitionId: intent.transitionId, ownerId: "driver", now: AT, leaseMs: 60_000 });
        settleTransition(db, { lease, now: AT, result: unknown(intent.transitionId) });
        vi.spyOn(repo, "get").mockImplementationOnce(() => { throw new Error("post-effect read unavailable"); });
        return null;
      } } }); services.push(owner);
    const row = owner.submit(transitionRequest()); await owner.stop();
    expect(repo.get(row.operationId)).toMatchObject({ state: "running", result: null });
    expect(owner.status(row.operationId)).toMatchObject({ state: "outcome_unknown", reason: "commitment_unknown" });
    vi.restoreAllMocks();
  });

  it("deduplicates admission and lets pre-claim cancellation win without dispatch", async () => {
    const db = open(); seedHindsightAuthority(db); let calls = 0;
    const owner = service(db, { plan, execute: async () => { calls++; return null; } }); const request = transitionRequest();
    const row = owner.submit(request); expect(owner.submit(request).operationId).toBe(row.operationId);
    expect(() => owner.submit({ ...request, previewId: randomUUID() })).toThrow("MEMORY_TRANSITION_CONFLICT");
    expect(owner.cancel(row.operationId).state).toBe("cancelled"); await owner.stop();
    expect(calls).toBe(0); expect(readTransitionAttempt(db, row.producer!.kind === "transition" ? row.producer!.transitionId : "")).toBeUndefined();
    expect(owner.submit(request).state).toBe("cancelled");
  });

  it("refuses automatic admission and ignores unpersisted producer settlement", async () => {
    const db = open(); seedHindsightAuthority(db);
    const owner = service(db, { plan, execute: async () => ({ state: "completed", reason: null, errorCode: null, result: null }) });
    expect(() => owner.submit(transitionRequest(), { origin: "automatic" })).toThrow("UNSUPPORTED");
    const row = owner.submit(transitionRequest()); await owner.stop();
    expect(owner.status(row.operationId).state).toBe("running"); expect(owner.status(row.operationId).result).toBeNull();
    expect(() => owner.cancel(row.operationId)).toThrow("RUNNING");
  });

  it("observes factual durable failure after a lost producer reply, without treating the exception as failure evidence", async () => {
    const db = open(); seedHindsightAuthority(db);
    const owner = service(db, { plan, execute: async (input) => {
      const intent = readTransitionByRequest(db, input.request.requestId)!;
      const lease = claimTransition(db, { transitionId: intent.transitionId, ownerId: "driver", now: AT, leaseMs: 60_000 });
      settleTransition(db, { lease, now: AT, result: { ...unknown(intent.transitionId), runtime: "source", outcome: "failed", errorCode: "MEMORY_TRANSITION_PROOF_INVALID" } });
      throw new Error("lost reply");
    } });
    const row = owner.submit(transitionRequest()); await owner.stop();
    expect(owner.status(row.operationId)).toMatchObject({ state: "failed", errorCode: "MEMORY_TRANSITION_PROOF_INVALID" });
    const observer = service(db); expect(observer.status(row.operationId)).toEqual(owner.status(row.operationId));
  });

  it("boot observes UNKNOWN without dispatch; a new authorized operation resolves the original fence and preserves terminal history after reopen", async () => {
    const dir = mkdtempSync(join(tmpdir(), "taki-transition-owner-")); dirs.push(dir); const path = join(dir, "db.sqlite");
    let db = open(path); const intent = seedTransition(db); let lease = startTransition(db, intent);
    lease = changeTransitionAdmission(db, { lease, now: AT, action: "close" });
    lease = updateTransitionAttempt(db, { lease, now: AT, patch: { phase: "draining" } });
    lease = updateTransitionAttempt(db, { lease, now: AT, patch: { phase: "fenced" } });
    const oldResult = unknown(intent.transitionId); settleTransition(db, { lease, now: AT, result: oldResult }); db.close(); db = open(path);
    let calls = 0; const now = "2026-09-29T00:01:01.000Z";
    const owner = service(db, { plan, execute: async (input) => {
      calls++;
      const claimed = claimTransition(db, { transitionId: intent.transitionId, operationId: input.operationId, ownerId: "recovery", now, leaseMs: 60_000 });
      const body = { version: 1 as const, operationId: input.operationId, transitionId: intent.transitionId,
        result: { ...oldResult, runtime: "source" as const, outcome: "failed" as const, errorCode: "MEMORY_TRANSITION_PROOF_INVALID" as const },
        release: { protocol: "taki-transition-v1" as const, attemptId: claimed.attemptId, generation: claimed.generation,
          disposition: "source-aborted" as const, proofHash: HASH, banks: [{ sourceBankId: "global", nativeGeneration: "generation", fenceId: "fence", outcomeReceiptId: "abort-receipt", proofHash: HASH }], incidentId: null, recordedAt: now } };
      const resolution: MemoryTransitionResolution = { ...body, resolutionId: canonicalPayloadHash(["taki-transition-resolution.v1", body]) };
      resolveTransition(db, { lease: claimed, now, resolution }); return null;
    } }, now);
    expect(calls).toBe(0); const original = owner.status(intent.operationId); expect(original.state).toBe("outcome_unknown");
    expect(() => owner.submit({ kind: "setup.validate", expectedRevision: 3 })).toThrow("BUSY");
    const request = { ...intent.request, requestId: randomUUID(), recovery: { transitionId: intent.transitionId, expectedReceiptId: null, expectedGeneration: 1 } };
    const cancelled = owner.submit(request); expect(owner.cancel(cancelled.operationId).state).toBe("cancelled"); await owner.stop();
    expect(calls).toBe(0); expect(readTransitionAttempt(db, intent.transitionId)?.phase).toBe("fenced");
    const recovered = owner.submit({ ...request, requestId: randomUUID() }); await owner.stop();
    expect(calls).toBe(1); expect(owner.status(recovered.operationId)).toMatchObject({ state: "failed", errorCode: "MEMORY_TRANSITION_PROOF_INVALID" });
    expect(readTransitionRecovery(db, recovered.operationId)?.transitionId).toBe(intent.transitionId);
    expect(readTransitionResolution(db, recovered.operationId)).toBeDefined(); expect(owner.status(intent.operationId)).toEqual(original);
    expect(readTransitionResult(db, intent.transitionId)).toEqual(oldResult); expect(readTransitionAttempt(db, intent.transitionId)?.phase).toBe("terminal");
    db.close(); db = open(path); const observer = service(db);
    expect(observer.status(intent.operationId)).toEqual(original); expect(observer.status(recovered.operationId).state).toBe("failed");
    expect(calls).toBe(1);
  });
});
