/** Read-only audit of actual Local lifecycle changes after exact emergency installation. */
import assert from "node:assert/strict";
import { discoverTransitionLocal } from "../../../../packages/core/src/db/memory-transition-local-capture.ts";
import { stableRequestHash } from "../../../../packages/core/src/db/canonical-memory-repo.ts";
import { sortState } from "../../../../packages/core/src/memory/transitions/transition-local-candidate.ts";
import { transitionLocalHash } from "../../../../packages/core/src/memory/transitions/transition-local-encoding.ts";
import { memoryRetentionVerdict } from "../../../../packages/core/src/memory/retention-sweeper.ts";
import { getLayer } from "../../../../packages/core/src/memory/layer-registry.ts";

export function auditLocalRetention(db, candidate, memoryConfig) {
  const epochId = candidate.targetEpochId;
  const actual = discoverTransitionLocal(db, epochId).state; sortState(actual);
  for (const key of ["banks", "sources", "derived", "blocks", "historicalReferences", "sourceAliases", "sourceSets"]) {
    assert.equal(transitionLocalHash(actual[key]), transitionLocalHash(candidate.state[key]), "W6_NON_LIFECYCLE_STATE_CHANGED");
  }
  const original = new Map(candidate.state.records.map((record) => [JSON.stringify([record.unit.bankId, record.unit.memoryId]), record]));
  assert.equal(actual.records.length, original.size, "W6_RECORD_MEMBERSHIP_CHANGED_REQUIRES_AUDIT");
  const receipts = db.prepare("SELECT * FROM canonical_memory_operation_receipts WHERE authority_epoch_id=:epoch ORDER BY request_id").all({ epoch: epochId });
  const used = new Set(); let changed = 0;
  for (const after of actual.records) {
    const before = original.get(JSON.stringify([after.unit.bankId, after.unit.memoryId])); assert(before, "W6_FOREIGN_LOCAL_RECORD");
    if (transitionLocalHash(before) === transitionLocalHash(after)) continue;
    const base = { epochId, bankId: before.unit.bankId, memoryId: before.unit.memoryId, expectedRevision: before.unit.revision };
    const requestId = `retention:${stableRequestHash({ ...base, verdict: "archive" })}`;
    const row = receipts.find((receipt) => receipt.request_id === requestId); assert(row, "W6_UNEXPLAINED_RECORD_CHANGE");
    const scope = candidate.state.banks.find((bank) => bank.bankId === base.bankId)?.scope; assert(scope);
    assert.equal(row.operation, "invalidate");
    assert.equal(row.request_hash, stableRequestHash(["canonical-local-maintenance.v1", "invalidate",
      { ...base, characterId: scope.characterId, reason: "retention" }]));
    assert.deepEqual(JSON.parse(row.result_json), { outcome: "applied", bankId: base.bankId, memoryId: base.memoryId, revision: before.unit.revision + 1 });
    const layer = getLayer(before.policy.layerId); assert(layer && layer.retention !== "permanent");
    const policy = before.policy.retention; assert.notEqual(policy.kind, "permanent");
    if (policy.kind === "rolling-window") assert(layer.writePolicy === "machine" && typeof layer.retention === "object"
      && "rollingDays" in layer.retention, "W6_ROLLING_RETENTION_SCOPE_INVALID");
    const retention = policy.kind === "expiring" ? "expiring" : policy.kind === "importance-decay"
      ? { afterDays: policy.afterDays, archiveBelowImportance: policy.archiveBelowImportance } : { rollingDays: policy.days };
    assert.equal(memoryRetentionVerdict(retention, { path: "owned-audit", layer: before.policy.layerId, importance: before.policy.importance,
      createdAt: before.unit.createdAt, updatedAt: before.unit.updatedAt, expiresAt: policy.kind === "expiring" ? policy.expiresAt : null },
    { at: Date.parse(row.created_at), intentionsDefaultDays: memoryConfig.intentionsDefaultDays }), "archive");
    assert.equal(before.unit.state, "valid");
    assert.deepEqual(after, { ...before, unit: { ...before.unit, revision: before.unit.revision + 1,
      state: "invalidated", invalidationReason: "retention", invalidatedAt: row.created_at, updatedAt: row.created_at } });
    for (const record of [before, after]) {
      const snapshot = db.prepare(`SELECT record_json FROM canonical_memory_revision_snapshots
        WHERE authority_epoch_id=:epoch AND bank_id=:bank AND memory_id=:memory AND revision=:revision`)
        .get({ epoch: epochId, bank: base.bankId, memory: base.memoryId, revision: record.unit.revision });
      assert(snapshot); assert.deepEqual(JSON.parse(snapshot.record_json), record);
    }
    used.add(row.request_id); changed++;
  }
  assert(receipts.every((row) => used.has(row.request_id)), "W6_UNAUDITED_LOCAL_RECEIPT");
  return { records: actual.records.length, sources: actual.sources.length, banks: actual.banks.length,
    invalidated: actual.records.filter((row) => row.unit.state === "invalidated").length,
    receiptBackedRetentionChanges: changed, lifecycleReceiptHash: transitionLocalHash(receipts), stateHash: transitionLocalHash(actual) };
}
