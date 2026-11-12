/** Offline regression against a stopped controlled-journey database; writes no database or service state. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { HindsightMemoryRetainEnvelopeV1Schema } from "../../../../../packages/shared/src/index.ts";
import { getApplicationReplicaRecord } from "../../../../../packages/core/src/db/hindsight-application-replica-records.ts";
import { memoryRecordModelView } from "../../../../../packages/core/src/memory/canonical-tools/memory-record-model-view.ts";
import { fenceUntrusted } from "../../../../../packages/core/src/agents/untrusted-fence.ts";
import { parseMemoryModelOutput, readMemoryToolEvidence, readRetainWrite, assertRecallModelView } from "./memory-tool-evidence.mjs";
import { pendingWriteEvidence } from "./pending-write-evidence.mjs";

assert.ok(process.argv[2], "Supply the stopped isolated journey's taki.db path");
const path = resolve(process.argv[2]);
assert.match(path.replaceAll("\\", "/"), /^G:\/taki-first-use-[^/]+\/core-data\/taki\.db$/i);
const hash = () => createHash("sha256").update(readFileSync(path)).digest("hex");
const before = hash();
const db = new DatabaseSync(path, { readOnly: true });
const checks = [];
function verify(name, body) { body(); checks.push(name); }
try {
  const retains = db.prepare("SELECT run_id, source_ref_json FROM run_effects WHERE kind = 'memory'").all()
    .map((row) => ({ runId: row.run_id, source: JSON.parse(row.source_ref_json) }))
    .filter((row) => row.source.operation === "retain");
  const evidence = retains.map(({ runId, source }) => {
    const expected = { runId, characterId: "taki", toolName: "retain", providerId: source.providerId, authorityEpochId: source.authorityEpoch };
    const result = readMemoryToolEvidence(db, expected);
    verify(`actual ${source.providerId} retain projection and durable Effect`, () => {
      assert.equal(result.modelView.scope, "global");
      assert.equal(HindsightMemoryRetainEnvelopeV1Schema.safeParse(result.modelView).success, false,
        "the stopped-data regression must distinguish the old raw-envelope parser");
      assert.equal(Object.hasOwn(result.modelView, "requestId"), false);
    });
    return { expected, ...result };
  });
  const local = evidence.find((row) => row.expected.providerId === "local");
  const hindsight = evidence.find((row) => row.expected.providerId === "hindsight");
  assert.ok(local && hindsight, "Replay requires both observed Local and Hindsight retains");
  verify("recorded Local completed and Hindsight Pending remain distinct", () => {
    assert.equal(local.modelView.status, "completed"); assert.equal(hindsight.modelView.status, "pending");
  });
  const write = readRetainWrite(db, hindsight.memoryEffect);
  verify("original Hindsight parent and Native child remain Pending", () => {
    assert.equal(write.parentRow.state, "pending"); assert.notEqual(write.child.phase, "completed");
    assert.equal(write.parent.terminal, null);
    assert.equal(write.child.intent.bank.scope, hindsight.modelView.scope);
  });
  verify("restart evidence uses the same proven request and original document", () => {
    const value = pendingWriteEvidence({ coreOptions: { dataDir: dirname(path) }, epochId: hindsight.expected.authorityEpochId }, hindsight);
    assert.equal(value.identity.parent.requestId, hindsight.memoryEffect.requestId);
    assert.equal(value.identity.child.operationId, write.parent.nativeOperationId);
    assert.equal(value.documentId, write.child.documentId);
  });
  for (const [key, value] of [["runId", local.expected.runId], ["authorityEpochId", "wrong-epoch"], ["providerId", "local"]]) {
    verify(`refuse wrong ${key}`, () => assert.throws(() => readMemoryToolEvidence(db, { ...hindsight.expected, [key]: value })));
  }
  for (const [key, value] of [["requestId", local.memoryEffect.requestId], ["providerLineageId", "wrong-lineage"], ["inputDigest", "0".repeat(64)]]) {
    verify(`refuse wrong parent ${key}`, () => assert.throws(() => readRetainWrite(db, { ...hindsight.memoryEffect, [key]: value })));
  }
  verify("SDK error output remains a failure", () => assert.throws(() => parseMemoryModelOutput({ type: "error-text", value: "failed" })));

  // Exercise flattened recall using an actual imported record and the production model projection.
  const bankId = write.parent.identity.key.bankId;
  const projected = db.prepare("SELECT object_id FROM hindsight_application_replica_projections WHERE bank_id = ? AND object_kind = 'memory_unit'")
    .all(bankId).map((row) => getApplicationReplicaRecord(db, { bankId, objectKind: "memory_unit", objectId: row.object_id }))
    .find((row) => row?.payload.kind === "memory_unit");
  assert.ok(projected, "Replay requires the imported Global record from successful activation");
  const record = projected.payload.value;
  const routes = { global: bankId, character: "unused-character-route" };
  const hit = { ...memoryRecordModelView(record, routes), confirmed: true };
  const recall = { ok: true, hits: [hit], returned: 1, partial: false, branchFailures: [] };
  const expected = { providerId: "hindsight", text: hit.text, scope: "global" };
  verify("flattened Hindsight recall preserves exact text and scope", () => assertRecallModelView(recall, expected));
  verify("Local observed text keeps its existing fence", () => {
    const observed = structuredClone(record);
    observed.policy.origin = "observed";
    observed.unit.text = fenceUntrusted({ source: "memory", content: hit.text });
    assertRecallModelView({ ...recall, hits: [{ ...memoryRecordModelView(observed, routes), confirmed: true }] },
      { ...expected, providerId: "local" });
  });
  for (const [name, changed] of [["partial branch", { ...recall, partial: true }],
    ["branch failure", { ...recall, branchFailures: [{ scope: "character", code: "MEMORY_PROVIDER_UNAVAILABLE" }] }],
    ["wrong scope", { ...recall, hits: [{ ...hit, scope: "character" }] }],
    ["duplicate fact", { ...recall, hits: [hit, hit], returned: 2 }],
    ["unconfirmed fact", { ...recall, hits: [{ ...hit, confirmed: false }] }]]) {
    verify(`recall refuses ${name}`, () => assert.throws(() => assertRecallModelView(changed, expected)));
  }
} finally { db.close(); }
assert.equal(hash(), before, "stopped source database changed during replay");
console.log(JSON.stringify({ status: "passed", database: path, sourceSha256: before, sourceUnchanged: true,
  checks: checks.length, passed: checks, limits: "Recall uses production projection of saved data; no live recall or Native completion is claimed." }, null, 2));
