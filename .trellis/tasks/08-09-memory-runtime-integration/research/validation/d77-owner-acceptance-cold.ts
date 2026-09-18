/**
 * INPUT:  a complete real-data application state and a new SQLite file containing only actual restored identity
 * OUTPUT: interrupted cold-read/reopen proof and exact full reconstruction without repeated cached-body requests
 * POS:    task acceptance fault injection after a real immutable-cache commit; provider results remain genuine
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MIGRATIONS } from "../../../../../packages/core/src/db/migrations/index-list.ts";
import { openDatabase } from "../../../../../packages/core/src/db/sqlite.ts";
import { currentEvidence, restoreIdentity } from "./d77-owner-acceptance-storage.ts";
import { event, openRuntime, privateJson, ROOT, sync, type AcceptanceRuntime } from "./d77-owner-acceptance-context.ts";

export async function verifyActualColdResume(origin: AcceptanceRuntime, identity: string) {
  assert.match(identity, /^[a-z0-9-]+$/);
  for (const bank of origin.banks) await sync(origin, bank.externalBankId);
  const expected = currentEvidence(origin);
  const proof = join(ROOT, "cold-reconstruction-proof.json");
  if (existsSync(proof)) {
    const previous = JSON.parse(readFileSync(proof, "utf8")) as Record<string, unknown>;
    if (previous.cachedBodiesRedownloaded === 0 && previous.originalSourceTablesUsed === false
      && JSON.stringify(previous.completeEvidence) === JSON.stringify(expected)) {
      event("ACTUAL_COLD_PROOF_REUSED", { sameCompleteEvidence: true });
      return { ...previous, reused: true };
    }
  }
  const path = join(ROOT, `cold-resume-${identity}.sqlite`); assert.equal(existsSync(path), false);
  const seed = openDatabase({ path, migrations: MIGRATIONS });
  try { restoreIdentity(origin.db, seed); } finally { seed.close(); }
  let runtime: AcceptanceRuntime | undefined = await openRuntime(path, origin.endpoint);
  const cachedIds = new Set<string>(); const started = performance.now();
  try {
    const bankId = runtime.banks[0]!.externalBankId;
    const cache = runtime.subsystem.state.replica.cacheBodies;
    runtime.subsystem.state.replica.cacheBodies = (input) => {
      cache(input);
      for (const body of input.bodies) cachedIds.add(body.ref.body_id);
      throw new Error("D77_OWNED_COLD_READ_INTERRUPTED");
    };
    await assert.rejects(sync(runtime, bankId), /D77_OWNED_COLD_READ_INTERRUPTED/);
    assert.ok(cachedIds.size > 0);
    assert.equal(runtime.subsystem.state.replica.checkpoint(bankId), undefined);
    assert.equal(runtime.db.prepare("SELECT count(*) AS n FROM hindsight_application_replica_projections").get()?.n, 0);
    event("ACTUAL_COLD_READ_INTERRUPTED_AFTER_CACHE", { cachedBodies: cachedIds.size, readableRecords: 0 });
    await runtime.close(); runtime = await openRuntime(path, origin.endpoint);
    const body = runtime.client.applicationBody; assert.ok(body);
    let resumedBodyRequests = 0;
    runtime.client.applicationBody = async (input) => {
      assert.equal(cachedIds.has(input.bodyId), false, "COLD_REOPEN_REDOWNLOADED_COMMITTED_BODY");
      resumedBodyRequests++; return body(input);
    };
    for (const bank of runtime.banks) await sync(runtime, bank.externalBankId);
    assert.ok(resumedBodyRequests > 0, "COLD_RESUME_REQUEST_OBSERVER_WAS_NOT_USED");
    assert.deepEqual(currentEvidence(runtime), expected);
    assert.equal(runtime.db.prepare("SELECT count(*) AS n FROM canonical_memory_units").get()?.n, 0);
    assert.equal(runtime.db.prepare("SELECT count(*) AS n FROM hindsight_current_captures").get()?.n, 0);
    assert.equal(runtime.db.prepare("SELECT count(*) AS n FROM memory_migration_sources").get()?.n, 0);
    assert.equal(runtime.db.prepare("PRAGMA foreign_key_check").all().length, 0);
    const result = { cachedBodies: cachedIds.size, resumedBodyRequests, cachedBodiesRedownloaded: 0,
      completeEvidence: expected, elapsedMs: performance.now() - started, originalSourceTablesUsed: false };
    privateJson(`cold-resume-${identity}.json`, result);
    privateJson("cold-reconstruction-proof.json", result);
    event("ACTUAL_COLD_REOPEN_PASSED", { cachedBodies: cachedIds.size, cachedBodiesRedownloaded: 0,
      records: expected.projections.count, elapsedMs: Math.round(result.elapsedMs) });
    return result;
  } finally { if (runtime) await runtime.close(); }
}
