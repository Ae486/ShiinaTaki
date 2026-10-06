/** Revalidate every current D77 projection and source edge on a new private SQLite copy; no native/model dispatch. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openDatabase } from "../../../../packages/core/src/db/sqlite.ts";
import { createCanonicalMemoryAuthorityRepo } from "../../../../packages/core/src/db/canonical-memory-authority-repo.ts";
import { createHindsightApplicationReplicaRepo } from "../../../../packages/core/src/db/hindsight-application-replica-repo.ts";
import { createApplicationEvidenceAccess } from "../../../../packages/core/src/db/hindsight-application-replica-evidence.ts";
import { listApplicationHeads } from "../../../../packages/core/src/db/hindsight-application-replica-heads.ts";
import { readHindsightCurrentPreparation } from "../../../../packages/core/src/db/hindsight-current-preparation-repo.ts";
import { createIntlSegmenterTokenizer } from "../../../../packages/core/src/memory/search-tokenizer.ts";
import { projectHindsightApplicationRecord, readHindsightApplicationNative } from "../../../../packages/core/src/memory/hindsight/hindsight-application-projection.ts";
import { hindsightApplicationTaggedJson } from "../../../../packages/shared/src/hindsight-application-encoding.ts";

const parent = resolve("H:/TakiAgent/.trellis/.runtime/stage4-conversion-native/8ce88920d37641aa9689145bd1811a90");
const sourceRoot = join(parent, "application-ad325c12054d4d92b91a81ad2b18fee1");
const source = join(sourceRoot, "application.sqlite");
const sourceResult = JSON.parse(readFileSync(join(sourceRoot, "result.json"), "utf8"));
assert(sourceResult.stopped && sourceResult.nodeExit === 0 && sourceResult.originalColumnsAndRowsUnchanged);
assert(!existsSync(`${source}-wal`));
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const sourceHash = hash(source);
const root = join(parent, `projection-${randomUUID()}`);
mkdirSync(root);
const path = join(root, "projection.sqlite");
copyFileSync(source, path);
const db = openDatabase({ path, migrations: [] });
const result = { root, completed: false, access: "local-sqlite-only", counts: { bank: 0, document: 0, memory_unit: 0,
  mental_model: 0, directive: 0 }, invalidated: 0, originalPolicies: 0, neutralDerivedPolicies: 0, blocks: 0,
  documentReferences: 0, memoryReferences: 0, typedOriginalFields: 0, banks: [] };
const projectionHashes = [];
try {
  const authority = createCanonicalMemoryAuthorityRepo(db).authorityEpoch();
  assert.equal(authority.providerId, "hindsight");
  const preparations = db.prepare("SELECT preparation_id FROM hindsight_current_preparations ORDER BY preparation_id").all()
    .map((row) => readHindsightCurrentPreparation(db, String(row.preparation_id)));
  const bankScope = (id) => { const prepared = preparations.find((entry) => entry.bankId === id); assert(prepared); return prepared.bankScope; };
  const repo = createHindsightApplicationReplicaRepo({ db, bankScope, tokenizer: createIntlSegmenterTokenizer({ stoplist: [] }) });
  for (const prepared of preparations) {
    const checkpoint = repo.checkpoint(prepared.bankId);
    assert(checkpoint && !checkpoint.bankDeleted);
    assert.equal(checkpoint.authorityEpochId, authority.epochId);
    assert.equal(checkpoint.namespace.provider_lineage, authority.providerLineageId);
    assert.deepEqual(checkpoint.bankScope, prepared.bankScope);
    const scope = { bankId: prepared.bankId, namespace: checkpoint.namespace };
    const heads = listApplicationHeads(db, scope).map((entry) => entry.head);
    const bank = repo.bankBinding(prepared.bankId)?.bank;
    assert(bank);
    const evidence = createApplicationEvidenceAccess(db, scope);
    const available = new Set(heads.filter((head) => head.version).map((head) => JSON.stringify([head.object_kind, head.object_id])));
    const requireReference = (kind, id) => assert(available.has(JSON.stringify([kind, id])), "current real-corpus reference must have same-Bank evidence");
    const bankCounts = { heads: heads.length, memories: 0, documents: 0, invalidated: 0 };
    for (const head of heads) {
      const input = { ...scope, authorityEpochId: authority.epochId, bankScope: prepared.bankScope, bank, head, evidence };
      const fresh = projectHindsightApplicationRecord(input);
      assert.equal(fresh.status, "projected", "every real current native head must have a complete consumer projection");
      assert(fresh.record.payload && head.version);
      const stored = repo.logicalRecord({ ...scope, objectKind: head.object_kind, objectId: head.object_id,
        includeInvalidated: true, includeTombstones: true });
      assert.deepEqual(stored, fresh.record, "verified stored and independently reconstructed projections disagree");
      result.counts[head.object_kind]++;
      projectionHashes.push(createHash("sha256").update(hindsightApplicationTaggedJson(fresh.record)).digest("hex"));
      const native = readHindsightApplicationNative(input);
      if (head.object_kind === "memory_unit") {
        assert.equal(fresh.record.payload.kind, "memory_unit");
        const record = fresh.record.payload.value;
        const nativeUnit = native.payload;
        assert.deepEqual(repo.record({ ...scope, memoryId: head.object_id, includeHidden: true, includeInvalidated: true }), record);
        // Compare independent native facts, including lifecycle and provenance references. Policy mirrors and
        // original typed metadata are checked against application evidence instead of flattening them into strings.
        for (const [key, value] of Object.entries(nativeUnit)) {
          if (key === "metadata" || key === "tags") continue;
          const field = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
          assert.deepEqual(record.unit[field], value, `native memory field ${field} changed during projection`);
        }
        assert.deepEqual(record.unit.tags.filter((tag) => !tag.startsWith("taki-layer:")),
          nativeUnit.tags.filter((tag) => !tag.startsWith("taki-layer:")));
        assert(record.unit.tags.includes(`taki-layer:${record.policy.layerId}`));
        if (record.unit.documentId !== null) { requireReference("document", record.unit.documentId); result.documentReferences++; }
        for (const id of record.unit.sourceMemoryIds) { requireReference("memory_unit", id); result.memoryReferences++; }
        assert(head.bound_artifact);
        const artifact = evidence.artifact(head.bound_artifact);
        const body = evidence.body(artifact.body_ref).content;
        assert.equal(body.body_schema, "application-memory.v1");
        assert.deepEqual(record.provenance, body.value.provenance);
        const omitLocation = (policy) => Object.fromEntries(Object.entries(policy)
          .filter(([key]) => !["authorityEpochId", "bankId", "memoryId"].includes(key)));
        assert.deepEqual(omitLocation(record.policy), omitLocation(body.value.policy));
        if (body.value.original_record) {
          result.originalPolicies++;
          for (const [key, value] of Object.entries(body.value.original_record.unit.metadata)) {
            assert.deepEqual(record.unit.metadata[key], value, "typed original unit metadata changed");
            result.typedOriginalFields++;
          }
        } else {
          assert.equal(body.value.policy_basis, "neutral");
          assert.equal(body.value.assessment.state, "due");
          assert.equal(record.policy.importance, 5);
          assert.equal(record.policy.visibility, "retrieved");
          result.neutralDerivedPolicies++;
        }
        bankCounts.memories++;
        if (record.unit.state === "invalidated") { result.invalidated++; bankCounts.invalidated++; }
      } else if (head.object_kind === "document") {
        assert.equal(fresh.record.payload.kind, "document");
        assert(head.bound_artifact);
        const artifact = evidence.artifact(head.bound_artifact);
        const body = evidence.body(artifact.body_ref).content;
        assert.equal(body.body_schema, "application-source.v1");
        const actual = fresh.record.payload.value;
        const original = body.value.original_source;
        assert.equal(actual.retainedText, original.retainedText);
        assert.equal(actual.context, original.context);
        assert.deepEqual(actual.provenance, original.provenance);
        for (const [key, value] of Object.entries(original.metadata)) {
          assert.deepEqual(actual.metadata[key], value, "typed original Source metadata changed");
          result.typedOriginalFields++;
        }
        bankCounts.documents++;
      }
    }
    result.blocks += repo.blockArtifacts(scope).length;
    result.banks.push(bankCounts);
    console.log(JSON.stringify({ phase: "projected", bankOrdinal: result.banks.length, ...bankCounts }));
  }
  assert.deepEqual(result.counts, { bank: 2, document: 722, memory_unit: 1216, mental_model: 2, directive: 2 });
  assert.equal(result.originalPolicies, 722);
  assert.equal(result.neutralDerivedPolicies, 494);
  assert.equal(result.invalidated, 21);
  assert.equal(result.blocks, 2);
  assert.equal(Number(db.prepare("SELECT total_changes() AS n").get().n), 0, "projection probe must not mutate data");
  result.projectionDigest = createHash("sha256").update(JSON.stringify(projectionHashes.sort())).digest("hex");
  result.completed = true;
} catch (error) {
  result.errorType = error?.constructor?.name ?? "UnknownError";
  writeFileSync(join(root, "failure.log"), String(error?.stack ?? error), "utf8");
} finally {
  db.close();
  result.sourceHashUnchanged = hash(source) === sourceHash;
  writeFileSync(join(root, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
}
process.exitCode = result.completed && result.sourceHashUnchanged ? 0 : 1;
