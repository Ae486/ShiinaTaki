import { afterEach, describe, expect, it } from "vitest";
import { createCanonicalMemoryAuthorityRepo } from "./canonical-memory-authority-repo.ts";
import { createHindsightBankSetupRepo } from "./hindsight-bank-setup-repo.ts";
import { readHindsightLocalBankBinding, requireHindsightLocalCoverageBanks } from "./hindsight-local-bank-binding.ts";
import { createLocalCoverageFixture, LOCAL_COVERAGE_NEXT, LOCAL_COVERAGE_NOW } from "./hindsight-local-coverage-fixtures.ts";
import { hindsightBankBindings } from "../memory/hindsight/hindsight-bank-identity.ts";
import { MIGRATIONS } from "./migrations/index-list.ts";
import { openDatabase, type Database } from "./sqlite.ts";

const databases: Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });

function fixture() {
  const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS }); databases.push(db);
  const value = createLocalCoverageFixture(db);
  createCanonicalMemoryAuthorityRepo(db).createBank({ authorityEpochId: value.epochId, bankId: "local-character",
    scope: { kind: "character", characterId: "taki" }, name: "Character", disposition: { skepticism: 3, literalism: 3, empathy: 3 },
    mission: "remember", config: {}, createdAt: LOCAL_COVERAGE_NOW });
  const coverage = value.runs.captureCoverage({ lease: value.lease, now: LOCAL_COVERAGE_NEXT });
  const bindings = hindsightBankBindings("taki"); const setup = createHindsightBankSetupRepo(db);
  for (const binding of bindings) setup.upsert({ ...binding, templateRevision: "1", templateDigest: "a".repeat(64),
    status: "verified", operationIds: [], lastVerifiedAt: LOCAL_COVERAGE_NOW, lastError: null });
  return { ...value, coverage, bindings, nativeBankIds: bindings.map((binding) => binding.externalBankId) };
}

describe("verified Local-to-native Bank ownership", () => {
  it("maps the complete Local set through real B3 scope bindings without discharging current import gaps", () => {
    const value = fixture();
    expect(value.coverage.bankIds).toEqual([value.bankId, "local-character"]);
    expect(value.nativeBankIds).not.toEqual(value.coverage.bankIds);
    expect(readHindsightLocalBankBinding(value.db, { localEpochId: value.epochId, sourceBankId: "local-character" }))
      .toEqual({ sourceBankId: "local-character", nativeBankId: value.bindings[1].externalBankId,
        scope: { kind: "character", characterId: "taki" } });
    expect(() => requireHindsightLocalCoverageBanks(value.db, { coverage: value.coverage,
      nativeBankIds: [...value.nativeBankIds].reverse() })).not.toThrow();
    expect(() => value.runs.markReady({ lease: value.lease, configFingerprint: "a".repeat(64),
      checkpointSetDigest: "b".repeat(64), now: LOCAL_COVERAGE_NEXT })).toThrow("HINDSIGHT_LOCAL_COVERAGE_UNPROVEN");
  });

  it.each(["missing", "pending", "scope", "character"] as const)("refuses %s B3 ownership evidence", (kind) => {
    const value = fixture();
    if (kind === "missing") value.db.exec("DELETE FROM hindsight_bank_setup WHERE canonical_identity='character:taki'");
    if (kind === "pending") value.db.exec("UPDATE hindsight_bank_setup SET status='pending' WHERE canonical_identity='character:taki'");
    if (kind === "scope") value.db.exec("UPDATE hindsight_bank_setup SET scope_kind='global' WHERE canonical_identity='character:taki'");
    if (kind === "character") value.db.exec("UPDATE hindsight_bank_setup SET canonical_identity='character:foreign' WHERE canonical_identity='character:taki'");
    expect(() => requireHindsightLocalCoverageBanks(value.db, value)).toThrow("HINDSIGHT_SOURCE_BANK_BINDING_MISSING");
  });

  it.each(["missing", "extra", "duplicate", "Local IDs"] as const)("refuses a %s native Bank set", (kind) => {
    const value = fixture(); const nativeBankIds = [...value.nativeBankIds];
    if (kind === "missing") nativeBankIds.pop();
    if (kind === "extra") nativeBankIds.push("foreign-bank");
    if (kind === "duplicate") nativeBankIds[1] = nativeBankIds[0]!;
    if (kind === "Local IDs") nativeBankIds.splice(0, nativeBankIds.length, ...value.coverage.bankIds);
    expect(() => requireHindsightLocalCoverageBanks(value.db, { coverage: value.coverage, nativeBankIds }))
      .toThrow("HINDSIGHT_BANKS_INCOMPLETE");
  });

  it("requires the actual Local epoch and Bank rather than native ID coincidence", () => {
    const value = fixture();
    expect(() => readHindsightLocalBankBinding(value.db, { localEpochId: "foreign", sourceBankId: value.bankId }))
      .toThrow("HINDSIGHT_SOURCE_BANK_BINDING_MISSING");
    expect(() => readHindsightLocalBankBinding(value.db, { localEpochId: value.epochId, sourceBankId: value.nativeBankIds[0]! }))
      .toThrow("HINDSIGHT_SOURCE_BANK_BINDING_MISSING");
  });
});
