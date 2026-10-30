/**
 * INPUT:  genuine activated copied storage and the provider's complete native/application state
 * OUTPUT: full original-field comparisons and provider-only reconstruction evidence
 * POS:    task acceptance; restored routing/authority metadata never substitutes for original source or replica data
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { TakiApplicationNativeHead } from "../../../../../packages/shared/src/index.ts";
import { readHindsightApplicationBootstrapEvidence, type HindsightApplicationBootstrapEvidence } from "../../../../../packages/core/src/db/hindsight-application-bootstrap-evidence.ts";
import { MIGRATIONS } from "../../../../../packages/core/src/db/migrations/index-list.ts";
import { openDatabase, type Database } from "../../../../../packages/core/src/db/sqlite.ts";
import { sameApplicationValue } from "../../../../../packages/core/src/memory/hindsight/hindsight-application-integrity.ts";
import { event, hash, openRuntime, privateJson, ROOT, scope, sync, traffic, type AcceptanceRuntime } from "./d77-owner-acceptance-context.ts";

export function bodyFor(runtime: AcceptanceRuntime, bankId: string, kind: TakiApplicationNativeHead["object_kind"], id: string) {
  const address = scope(runtime, bankId); const repo = runtime.subsystem.state.replica;
  const head = repo.nativeHead({ ...address, objectKind: kind, objectId: id }); assert.ok(head?.version && head.bound_artifact);
  const artifact = repo.artifact({ ...address, version: head.bound_artifact }); assert.ok(artifact);
  const body = repo.body({ ...address, bodyId: artifact.body_ref.body_id }); assert.ok(body);
  return { address, head, artifact, content: body.content };
}

function originalEvidence(runtime: AcceptanceRuntime) {
  return new Map(runtime.banks.map((bank) => {
    const address = scope(runtime, bank.externalBankId);
    const bankScope = bank.scope === "global" ? { kind: "global" as const, characterId: null }
      : { kind: "character" as const, characterId: bank.canonicalIdentity.slice("character:".length) };
    const original = readHindsightApplicationBootstrapEvidence(runtime.db, { ...address, bankScope, authorityEpochId: runtime.epochId });
    assert.ok(original); return [bank.externalBankId, original];
  }));
}

function checkOriginals(runtime: AcceptanceRuntime, expected: Map<string, HindsightApplicationBootstrapEvidence>) {
  const totals = { banks: 0, sources: 0, memories: 0, blocks: 0, invalidated: 0, metadata: 0 };
  const policies: Record<string, number> = {};
  for (const [bankId, original] of expected) {
    const bank = bodyFor(runtime, bankId, "bank", bankId).content;
    assert.equal(bank.body_schema, "application-bank.v1");
    if (bank.body_schema !== "application-bank.v1") throw new Error("D77_BANK_BODY_MISSING");
    assert.ok(sameApplicationValue(bank.value.original_bank, original.bank.value)); totals.banks++;
    for (const [id, source] of original.sources) {
      const stored = bodyFor(runtime, bankId, "document", id).content;
      assert.equal(stored.body_schema, "application-source.v1");
      if (stored.body_schema !== "application-source.v1") throw new Error("D77_SOURCE_BODY_MISSING");
      assert.ok(sameApplicationValue(stored.value.original_source, source.value), "D77_SOURCE_FIELDS_CHANGED");
      assert.ok(sameApplicationValue(stored.value.encoded_metadata, source.value.metadata), "D77_SOURCE_METADATA_CHANGED");
      assert.equal(stored.value.operation_id, source.operationId);
      totals.sources++; if (source.value.metadata !== null) totals.metadata++;
    }
    for (const [id, memory] of original.memories) {
      const stored = bodyFor(runtime, bankId, "memory_unit", id).content;
      assert.equal(stored.body_schema, "application-memory.v1");
      if (stored.body_schema !== "application-memory.v1") throw new Error("D77_MEMORY_BODY_MISSING");
      assert.ok(sameApplicationValue(stored.value.original_record, memory.value), "D77_ORIGINAL_MEMORY_FIELDS_CHANGED");
      assert.ok(sameApplicationValue(stored.value.policy, memory.value.policy), "D77_ORIGINAL_POLICY_CHANGED");
      assert.ok(sameApplicationValue(stored.value.provenance, memory.value.provenance), "D77_ORIGINAL_PROVENANCE_CHANGED");
      assert.ok(sameApplicationValue(stored.value.encoded_metadata, memory.value.unit.metadata), "D77_MEMORY_METADATA_CHANGED");
      totals.memories++; if (memory.value.unit.state === "invalidated") totals.invalidated++;
      policies[memory.value.policy.visibility] = (policies[memory.value.policy.visibility] ?? 0) + 1;
    }
    for (const block of original.blocks) {
      const restored = runtime.subsystem.state.blocks.read(block.block_id, block.scope);
      assert.ok(restored); assert.equal(restored.content, block.content); assert.equal(restored.revision, block.block_revision);
      totals.blocks++;
    }
  }
  return { ...totals, policies };
}

export function currentEvidence(runtime: AcceptanceRuntime) {
  const projections = runtime.db.prepare(`SELECT bank_id,object_kind,object_id,object_revision,operation,record_hash,bytes_sha256
    FROM hindsight_application_replica_projections ORDER BY bank_id,object_kind,object_id`).all();
  const heads = runtime.db.prepare(`SELECT bank_id,object_key,bytes_sha256 FROM hindsight_application_replica_heads
    ORDER BY bank_id,object_key`).all();
  const artifacts = runtime.db.prepare(`SELECT bank_id,artifact_key,revision,bytes_sha256 FROM hindsight_application_replica_artifacts
    ORDER BY bank_id,artifact_key,revision`).all();
  const blocks = runtime.db.prepare("SELECT * FROM taki_memory_blocks ORDER BY scope_kind,character_id,block_id").all();
  return { projections: { count: projections.length, sha256: hash(JSON.stringify(projections)) },
    heads: { count: heads.length, sha256: hash(JSON.stringify(heads)) },
    artifacts: { count: artifacts.length, sha256: hash(JSON.stringify(artifacts)) },
    blocks: { count: blocks.length, sha256: hash(JSON.stringify(blocks)) } };
}

/** Restore only already-committed routing/authority identity, like a minimal control-plane backup. */
export function restoreIdentity(origin: Database, target: Database): void {
  // Authority selection verifies its actual activation receipts and FK parents.
  // Restore those unchanged control records, but no B2 Sources/results, D78
  // capture/import bodies, canonical memories or disposable replica rows.
  const tables = ["canonical_memory_authority_epochs", "canonical_memory_authority_state", "memory_migration_runs",
    "hindsight_cutover_runs", "hindsight_authority_activation_receipts", "hindsight_authority_bank_receipts",
    "memory_authority_selection", "hindsight_bank_setup", "hindsight_connection_state", "config"];
  target.transaction(() => {
    for (const table of [...tables].reverse()) target.exec(`DELETE FROM "${table}"`);
    for (const table of tables) {
      const rows = origin.prepare(`SELECT * FROM "${table}"`).all();
      for (const row of rows) {
        const columns = Object.keys(row); assert.ok(columns.every((column) => /^[a-z0-9_]+$/.test(column)));
        target.prepare(`INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(",")})
          VALUES (${columns.map((column) => `:${column}`).join(",")})`).run(row);
      }
    }
  });
  assert.equal(target.prepare("PRAGMA foreign_key_check").all().length, 0);
}

export async function bootstrapAndReconstruct(runtime: AcceptanceRuntime) {
  const started = performance.now();
  for (const bank of runtime.banks) {
    event("FULL_APPLICATION_BOOTSTRAP_STARTED", { scope: bank.scope });
    await sync(runtime, bank.externalBankId);
    event("FULL_APPLICATION_BOOTSTRAP_BANK_COMPLETE", { scope: bank.scope, ...traffic });
  }
  const expected = originalEvidence(runtime); const original = checkOriginals(runtime, expected);
  assert.equal(original.memories, 722); assert.equal(original.sources, 722); assert.equal(original.blocks, 2);
  assert.equal(original.invalidated, 21);
  const evidence = currentEvidence(runtime);
  privateJson("bootstrap-original-comparison.json", { ...original, evidence, elapsedMs: performance.now() - started });
  event("ALL_ORIGINAL_FIELDS_PRESERVED", { ...original, elapsedMs: Math.round(performance.now() - started) });

  const identity = process.env.TAKI_D78_CONSUMER_ID ?? ""; assert.match(identity, /^[a-z0-9-]+$/);
  const path = join(ROOT, `provider-only-${identity}.sqlite`); assert.equal(existsSync(path), false);
  const target = openDatabase({ path, migrations: MIGRATIONS });
  try { restoreIdentity(runtime.db, target); }
  finally { target.close(); }
  const beforeCommits = traffic.applicationCommits;
  let recovered: AcceptanceRuntime | undefined;
  try {
    recovered = await openRuntime(path, runtime.endpoint);
    const absent = ["canonical_memory_units", "canonical_memory_sources", "hindsight_current_captures",
      "hindsight_application_replica_bodies", "hindsight_memory_write_intents", "memory_migration_sources", "memory_migration_results"];
    for (const table of absent) assert.equal(recovered.db.prepare(`SELECT count(*) AS n FROM "${table}"`).get()?.n, 0);
    for (const bank of recovered.banks) await sync(recovered, bank.externalBankId);
    assert.deepEqual(checkOriginals(recovered, expected), original);
    assert.deepEqual(currentEvidence(recovered), evidence);
    assert.equal(traffic.applicationCommits, beforeCommits, "RECONSTRUCTION_CREATED_REPLACEMENT_EVIDENCE");
    assert.equal(recovered.db.prepare("PRAGMA quick_check").get()?.quick_check, "ok");
    assert.equal(recovered.db.prepare("PRAGMA foreign_key_check").all().length, 0);
    privateJson("provider-only-result.json", { original, evidence, localInputTablesEmpty: absent,
      sameCompleteProjection: true, replacementApplicationCommits: 0 });
    event("PROVIDER_ONLY_RECONSTRUCTION_PASSED", { ...original, records: evidence.projections.count });
  } finally { if (recovered) await recovered.close(); }
  return { original, evidence, elapsedMs: performance.now() - started };
}
