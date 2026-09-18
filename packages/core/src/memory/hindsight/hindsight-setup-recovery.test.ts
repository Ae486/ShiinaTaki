import { afterEach, describe, expect, it } from "vitest";
import { createHindsightBankSetupRepo } from "../../db/hindsight-bank-setup-repo.ts";
import { createHindsightConnectionRepo } from "../../db/hindsight-connection-repo.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { reconcileInterruptedSetup } from "./hindsight-setup-recovery.ts";

const dbs: Database[] = [];
afterEach(() => { for (const db of dbs.splice(0)) db.close(); });

const at = "2026-09-19T00:00:00.000Z";
function fixture(phase: string) {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); dbs.push(db);
  const connectionRepo = createHindsightConnectionRepo(db); const bankRepo = createHindsightBankSetupRepo(db);
  const bank = (identity: string, status: "verified" | "applied" | "dry-run-ok" | "pending" | "failed") => bankRepo.upsert({
    scope: identity === "global" ? "global" : "character", canonicalIdentity: identity, externalBankId: `bank-${identity}`,
    templateRevision: "taki-bank-v1", templateDigest: "a".repeat(64), status, operationIds: status === "applied" ? ["op-1"] : [],
    lastVerifiedAt: status === "verified" ? at : null, lastError: null,
  });
  bank("global", "verified"); bank("character:taki", "applied"); bank("character:other", "dry-run-ok");
  const initial = connectionRepo.read(bankRepo.list());
  connectionRepo.save({ ...initial, phase: phase as typeof initial.phase, lastSuccessfulPhase: "compatible", configFingerprint: "f".repeat(64),
    attemptId: "attempt-9", lastAttemptAt: at, revision: initial.revision + 1, updatedAt: at, banks: bankRepo.list() }, initial.revision);
  return { db, connectionRepo, bankRepo };
}

describe("interrupted Hindsight setup reconciliation", () => {
  it("turns a busy phase into a retryable failure and returns intermediate Banks to pending", () => {
    const f = fixture("applying-templates");
    const report = reconcileInterruptedSetup(f, () => "2026-09-19T00:05:00.000Z");
    expect(report).toEqual({ previousPhase: "applying-templates", banksReset: 2 });
    const snapshot = f.connectionRepo.read(f.bankRepo.list());
    expect(snapshot).toMatchObject({ phase: "failed", lastSuccessfulPhase: "compatible", configFingerprint: "f".repeat(64), attemptId: null,
      latestError: { code: "HINDSIGHT_SETUP_INTERRUPTED", retryable: true }, updatedAt: "2026-09-19T00:05:00.000Z" });
    expect(snapshot.banks.map((bank) => [bank.canonicalIdentity, bank.status, bank.operationIds])).toEqual([
      ["character:other", "pending", []], ["character:taki", "pending", []], ["global", "verified", []],
    ]);
    expect(snapshot.banks.find((bank) => bank.scope === "global")?.lastVerifiedAt).toBe(at);
    expect(reconcileInterruptedSetup(f, () => at)).toBeNull();
  });

  it("leaves a settled snapshot untouched", () => {
    const f = fixture("compatible");
    const before = f.connectionRepo.read(f.bankRepo.list());
    expect(reconcileInterruptedSetup(f, () => at)).toBeNull();
    expect(f.connectionRepo.read(f.bankRepo.list())).toEqual(before);
  });
});
