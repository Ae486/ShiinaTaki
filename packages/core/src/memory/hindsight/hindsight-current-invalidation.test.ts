import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase, type Database } from "../../db/sqlite.ts";
import { MIGRATIONS } from "../../db/migrations/index-list.ts";
import { createHindsightCutoverRunRepo } from "../../db/hindsight-cutover-run-repo.ts";
import { currentStateFixture, currentImportFixture, currentMaintenanceFixture, CURRENT_REPLICA } from "../../db/hindsight-current-fixtures.ts";
import { LOCAL_COVERAGE_NOW as now, LOCAL_COVERAGE_NEXT as next } from "../../db/hindsight-local-coverage-fixtures.ts";
import { saveHindsightCurrentImport } from "../../db/hindsight-current-import-repo.ts";
import { saveCurrentVerificationCandidate } from "../../db/hindsight-current-candidate-repo.ts";
import { readHindsightCurrentVerification, saveHindsightCurrentVerification } from "../../db/hindsight-current-verification-repo.ts";
import { readHindsightCurrentNativeInvalidation, requireHindsightCurrentNativeState } from "../../db/hindsight-current-invalidation-repo.ts";
import { createHindsightReplicaRepo } from "../../db/hindsight-replica-repo.ts";
import { hindsightCheckpointSetDigest, promoteHindsightAuthority } from "../../db/hindsight-authority-repo.ts";
import { createHindsightClient, type HindsightTransport } from "./hindsight-client.ts";
import { verifyHindsightCurrentBank } from "./hindsight-current-orchestrator.ts";
import { currentVerificationRequest } from "./hindsight-current-verification-identity.ts";
import type { HindsightCurrentStateClient } from "./hindsight-current-client.ts";

const databases: Database[] = []; const directories: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0)) {
    const path = resolve(directory);
    if (dirname(path) !== resolve(tmpdir()) || !basename(path).startsWith("taki-current-drift-")) throw new Error("unsafe test cleanup");
    rmSync(path, { recursive: true, force: true });
  }
});
function open(path = ":memory:") { const db = openDatabase({ path, migrations: MIGRATIONS }); databases.push(db); return db; }
function fixture(path?: string) {
  const f = currentStateFixture(open(path)); const prepared = f.prepare(); const native = currentImportFixture(prepared, f.baselineRecords);
  const imported = saveHindsightCurrentImport(f.db, { preparationId: prepared.preparationId, ...native });
  const proof = currentMaintenanceFixture(imported, native);
  const candidate = saveCurrentVerificationCandidate(f.db, { preparationId: prepared.preparationId, request: proof.request, status: proof.candidate });
  const evidence = saveHindsightCurrentVerification(f.db, { lease: f.lease, ...proof, replicaEpochId: CURRENT_REPLICA, now });
  const checkpoint = createHindsightReplicaRepo(f.db).checkpoint(f.nativeBankId)!;
  const banks = [{ bankId: f.nativeBankId, templateDigest: f.templateDigest, checkpoint }];
  const checkpointSetDigest = hindsightCheckpointSetDigest(banks); const configFingerprint = "a".repeat(64);
  f.runs.markReady({ lease: f.lease, configFingerprint, checkpointSetDigest, now });
  f.db.prepare("UPDATE hindsight_connection_state SET phase='configured',config_fingerprint=:config,compatibility_json=:json WHERE singleton=1")
    .run({ config: configFingerprint, json: JSON.stringify({ providerLineage: proof.request.provider_lineage }) });
  return { ...f, prepared, imported, proof, candidate, evidence,
    promotion: { lease: f.lease, predecessorEpochId: f.epochId, hindsightEpochId: "new-hindsight", transactionId: "after-drift",
      configFingerprint, checkpointSetDigest, banks, now: next } };
}
function verify(f: ReturnType<typeof fixture>, transport: HindsightTransport) {
  const client = createHindsightClient({ endpoint: "http://127.0.0.1:8888", resolveApiKey: () => "fixture-key", transport: async (url, init, bytes) => {
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-key");
    expect(new URL(url).pathname).toBe(`/ext/taki-memory/banks/${f.nativeBankId}/cutover-verifications`);
    return transport(url, init, bytes);
  } }) as HindsightCurrentStateClient;
  return verifyHindsightCurrentBank({ db: f.db, preparationId: f.prepared.preparationId, lease: f.lease,
    verificationId: f.proof.request.verification_id, replicaEpochId: CURRENT_REPLICA, client, context: { timeoutMs: 1000 }, now: () => next });
}

describe("known native drift invalidates cutover evidence", () => {
  it("persists an authenticated stale candidate across restart and refuses ready/verify/promotion without rewriting proof", async () => {
    const directory = mkdtempSync(join(tmpdir(), "taki-current-drift-")); directories.push(directory);
    const path = join(directory, "memory.db"); const f = fixture(path);
    const before = f.db.prepare("SELECT * FROM hindsight_current_verification_evidence").all();
    const stale = { ...f.proof.candidate, revision: f.proof.status.revision + 1, state: "stale", reasons: ["source_changed"], certificate: null };
    await expect(verify(f, async () => ({ status: 200, body: JSON.stringify(stale) }))).resolves.toMatchObject({ status: { state: "stale" }, evidence: null });
    const invalidation = readHindsightCurrentNativeInvalidation(f.db, { preparationId: f.prepared.preparationId, candidateId: f.candidate.candidateId });
    expect(invalidation).toMatchObject({ scope: "candidate", candidateId: f.candidate.candidateId,
      certificateHash: f.proof.status.certificate!.certificate_hash, verificationId: f.proof.request.verification_id });
    expect(() => f.db.exec("INSERT OR REPLACE INTO hindsight_current_native_invalidations SELECT * FROM hindsight_current_native_invalidations")).toThrow("IMMUTABLE");
    f.db.close(); const db = open(path); const runs = createHindsightCutoverRunRepo(db);
    expect(db.prepare("SELECT * FROM hindsight_current_verification_evidence").all()).toEqual(before);
    expect(readHindsightCurrentVerification(db, { preparationId: f.prepared.preparationId,
      snapshotId: f.proof.status.certificate!.snapshot.snapshot_id, now: next })).toEqual(f.evidence);
    expect(() => runs.markReady({ lease: f.lease, configFingerprint: f.promotion.configFingerprint,
      checkpointSetDigest: f.promotion.checkpointSetDigest, now: next })).toThrow("HINDSIGHT_CURRENT_NATIVE_STATE_INVALIDATED");
    expect(runs.verify({ runId: f.runId, expectedRevision: 0, expectedEpochId: f.epochId }))
      .toMatchObject({ eligible: false, blockingCodes: expect.arrayContaining(["HINDSIGHT_CURRENT_NATIVE_STATE_INVALIDATED"]) });
    expect(() => promoteHindsightAuthority(db, f.promotion)).toThrow("HINDSIGHT_CURRENT_NATIVE_STATE_INVALIDATED");
    expect(() => saveHindsightCurrentVerification(db, { lease: f.lease, ...f.proof, replicaEpochId: CURRENT_REPLICA, now: next }))
      .toThrow("HINDSIGHT_CURRENT_NATIVE_STATE_INVALIDATED");
    expect(runs.status(f.runId).currentState).toMatchObject({ state: "available", importedBankCount: 1,
      verifiedBankCount: 0, nativeInvalidatedBankCount: 1 });
    expect(db.prepare("SELECT mode FROM memory_authority_selection").get()?.mode).toBe("canonical-local");
  });

  it("binds generation refusal to its preparation without poisoning a different preparation", async () => {
    const f = fixture();
    await expect(verify(f, async () => ({ status: 409, body: JSON.stringify({ error: "cutover_verification_refused", reason: "generation_mismatch" }) })))
      .rejects.toThrow("HINDSIGHT_CURRENT_NATIVE_REFUSED:generation_mismatch");
    expect(readHindsightCurrentNativeInvalidation(f.db, { preparationId: f.prepared.preparationId })).toMatchObject({ scope: "preparation" });
    expect(() => requireHindsightCurrentNativeState(f.db, { preparationId: f.prepared.preparationId })).toThrow("INVALIDATED");
    f.runs.captureCoverage({ lease: f.lease, now: next }); const other = f.prepare();
    expect(other.preparationId).not.toBe(f.prepared.preparationId);
    expect(() => requireHindsightCurrentNativeState(f.db, { preparationId: other.preparationId })).not.toThrow();
  });

  it("scopes a terminal candidate observation separately from a new candidate", async () => {
    const f = fixture(); const stale = { ...f.proof.candidate, revision: f.proof.status.revision + 1,
      state: "stale", reasons: ["target_changed"], certificate: null };
    await verify(f, async () => ({ status: 200, body: JSON.stringify(stale) }));
    const request = currentVerificationRequest({ imported: f.imported, verificationId: CURRENT_REPLICA });
    const candidate = saveCurrentVerificationCandidate(f.db, { preparationId: f.prepared.preparationId, request,
      status: { ...f.proof.candidate, ...request, candidate_hash: "c".repeat(64) } });
    expect(() => requireHindsightCurrentNativeState(f.db, { preparationId: f.prepared.preparationId, candidateId: candidate.candidateId })).not.toThrow();
    expect(() => requireHindsightCurrentNativeState(f.db, { preparationId: f.prepared.preparationId, candidateId: f.candidate.candidateId })).toThrow("INVALIDATED");
  });

  it.each(["network", "timeout", "service-unavailable", "capability-unavailable", "invalid-json", "wrong-identity", "older-response"] as const)("does not fabricate drift from %s", async (failure) => {
    const f = fixture();
    await expect(verify(f, async () => {
      if (failure === "network") throw new Error("network unreachable");
      if (failure === "timeout") throw new DOMException("timeout", "AbortError");
      if (failure === "service-unavailable") return { status: 503, body: "provider is restarting" };
      if (failure === "capability-unavailable") return { status: 503,
        body: JSON.stringify({ error: "cutover_verification_refused", reason: "unsupported_storage" }) };
      if (failure === "invalid-json") return { status: 200, body: "not JSON" };
      if (failure === "older-response") return { status: 200, body: JSON.stringify({ ...f.proof.candidate, state: "stale", reasons: ["source_changed"] }) };
      return { status: 200, body: JSON.stringify({ ...f.proof.candidate, bank_id: "unrelated", state: "stale", reasons: ["source_changed"] }) };
    })).rejects.toThrow();
    expect(f.db.prepare("SELECT count(*) AS n FROM hindsight_current_native_invalidations").get()?.n).toBe(0);
    expect(f.runs.verify({ runId: f.runId, expectedRevision: 0, expectedEpochId: f.epochId }).eligible).toBe(true);
  });
});
