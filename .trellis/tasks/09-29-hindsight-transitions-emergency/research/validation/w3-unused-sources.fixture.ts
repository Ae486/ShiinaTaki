/** Independent W3 regression: real Local copy -> unused native scope -> final source closure. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openDatabase } from "../../../../../packages/core/src/db/sqlite.ts";
import { MIGRATIONS } from "../../../../../packages/core/src/db/migrations/index-list.ts";
import { createTransitionReentryFixture } from "../../../../../packages/core/src/testing/memory-transition-reentry-fixtures.ts";
import { createCanonicalMemoryMaintenanceRepo } from "../../../../../packages/core/src/db/canonical-memory-maintenance-repo.ts";
import { readCanonicalSourceSet } from "../../../../../packages/core/src/db/canonical-memory-source-references.ts";
import { captureTransitionLocal } from "../../../../../packages/core/src/db/memory-transition-local-capture.ts";
import { createHindsightClient } from "../../../../../packages/core/src/memory/hindsight/hindsight-client.ts";
import { requireHindsightTransitionClient } from "../../../../../packages/core/src/memory/hindsight/hindsight-transition-capability.ts";
import { requireHindsightApplicationClient } from "../../../../../packages/core/src/memory/hindsight/hindsight-application-capability.ts";
import { loadBodies } from "../../../../../packages/core/src/memory/hindsight/hindsight-application-bundle-loader.ts";
import { compileTransitionUnusedDelta } from "../../../../../packages/core/src/memory/transitions/transition-unused-delta.ts";
import { signHindsightTransitionAcquire, signHindsightTransitionDelta } from "../../../../../packages/core/src/memory/hindsight/hindsight-transition-proof.ts";
import { HindsightTransitionDeltaRequestSchema, HindsightTransitionAcquireSchema } from "../../../../../packages/shared/src/index.ts";
import { loadTransitionNativeEvidence } from "../../../../../packages/core/src/memory/transitions/transition-native-loader.ts";
import { projectTransitionLocalBank, transitionProjectionContext } from "../../../../../packages/core/src/memory/transitions/transition-local-projection.ts";

assert.equal(process.env.TAKI_TRANSITION_HTTP_FIXTURE, "1");
const [endpoint, bankId] = process.argv.slice(2);
assert(endpoint && bankId); assert.equal(new URL(endpoint).hostname, "127.0.0.1");
const client = requireHindsightTransitionClient(requireHindsightApplicationClient(createHindsightClient({ endpoint,
  resolveApiKey: () => "native-results-offline-test" })));
assert(client.createCurrentSnapshot && client.currentSnapshotPage);
const context = { timeoutMs: 120_000 };
const db = openDatabase({ path: ":memory:", migrations: MIGRATIONS });
try {
  const fixture = createTransitionReentryFixture(db, { newScope: true, aliases: true });
  const maintenance = createCanonicalMemoryMaintenanceRepo(db, fixture.local.tokenizer);
  const identity = { epochId: fixture.candidate.targetEpochId, bankId: "global", memoryId: "logical-unit", characterId: "new-character" };
  const copied = maintenance.copyToBank({ ...identity, expectedRevision: maintenance.record(identity)!.unit.revision,
    destinationBankId: "new-local-bank", requestId: "http-copy-new-scope", now: "2026-10-01T00:00:01.000Z",
    policy: { layerId: "episodes", visibility: "retrieved", retention: { kind: "permanent" } } });
  const references = readCanonicalSourceSet(db, { ...identity, bankId: "new-local-bank", memoryId: copied.record.unit.memoryId })!.references;
  assert.deepEqual(references.map((ref) => ref.source.retainedText), ["", "append fragment one", "append fragment two", "append fragment one"]);
  const capture = captureTransitionLocal(db, fixture.input);
  const unused = await client.unusedTransitionScope({ bankId, context });
  const acquired = await client.acquireTransition({ bankId, context, request: signHindsightTransitionAcquire(bankId,
    HindsightTransitionAcquireSchema.parse({ transition_id: fixture.intent.transitionId, attempt_id: randomUUID(),
      provider_lineage: unused.provider_lineage, bank_generation: unused.bank_generation,
      direction: "reenter-hindsight", request_hash: "0".repeat(64), unused_scope: unused })) });
  const target = await client.fenceTransition({ bankId, context, request: acquired.executor });
  const nativeSnapshot = await client.createCurrentSnapshot({ bankId, ttlSeconds: 600, context });
  const nativePages = [];
  for (let pageNumber = 0; pageNumber < nativeSnapshot.manifest.total_pages; pageNumber++) {
    nativePages.push(await client.currentSnapshotPage({ bankId, snapshotId: nativeSnapshot.snapshot_id, pageNumber, context }));
  }
  const namespace = { application_id: "taki" as const, provider_lineage: unused.provider_lineage, bank_generation: unused.bank_generation };
  const applicationManifest = await client.createApplicationSnapshot({ bankId, context,
    request: { namespace, request_id: randomUUID(), ttl_seconds: 600 } });
  const applicationPages = [];
  for (let pageNumber = 0; pageNumber < applicationManifest.total_pages; pageNumber++) {
    applicationPages.push(await client.applicationSnapshotPage({ bankId, namespace, snapshotId: applicationManifest.snapshot_id!, pageNumber, context }));
  }
  const bodies = await loadBodies({ bankId, namespace, client, context, request: () => context }, applicationPages);
  const compiled = compileTransitionUnusedDelta({ capture, localBankId: "new-local-bank",
    localLineageId: fixture.intent.request.expected.sourceLineageId, target, inventory: { nativeSnapshot, nativePages, applicationManifest,
      applicationPages, bodies: [...bodies.values()].map(({ ref, bytes }) => ({ ref, base64: Buffer.from(bytes).toString("base64") })) } });
  const request = signHindsightTransitionDelta(bankId, HindsightTransitionDeltaRequestSchema.parse({ ...compiled,
    executor: target.executor, operation_id: randomUUID(), request_hash: "0".repeat(64), baseline_transition_id: null,
    baseline_proof_hash: null, unused_scope: unused, local_manifest_hash: capture.contentHash }));
  const result = await client.applyTransitionDelta({ bankId, request, context });
  assert.deepEqual(await client.transitionDelta({ bankId, transitionId: target.request.transition_id, context }), result);
  const status = await client.verifyTransition({ bankId, request: target.executor, context });
  const evidence = await loadTransitionNativeEvidence({ status, client: { ...client, currentSnapshotPage: client.currentSnapshotPage }, request: () => context });
  const output = projectTransitionLocalBank({ evidence, scope: { scope: { kind: "character", characterId: "new-character" },
    localBankId: "new-local-bank", nativeBankId: bankId, nativeGeneration: unused.bank_generation, evidenceId: evidence.evidenceId,
    origin: "original", originEpochId: capture.epochId }, epochId: randomUUID(), createdAt: new Date().toISOString() });
  const sourceResults = references.map((ref) => result.artifacts.find((row) => row.key.artifact_kind === "source"
    && row.key.artifact_id === ref.documentId)!.current);
  const memoryResult = result.artifacts.find((row) => row.key.artifact_id === copied.record.unit.memoryId)!;
  const closure = transitionProjectionContext(evidence);
  const memoryBody = closure.reader.body(closure.reader.artifact(memoryResult.current).body_ref).content;
  assert.equal(memoryBody.body_schema, "application-memory.v1");
  if (memoryBody.body_schema !== "application-memory.v1") throw new Error("missing memory body");
  assert.deepEqual(memoryBody.value.source_artifacts, sourceResults);
  const actual = output.sourceSets.find((set) => set.memoryId === copied.record.unit.memoryId)!.references;
  assert.deepEqual(actual.map((ref) => [ref.documentId, ref.source.retainedText]), references.map((ref) => [ref.documentId, ref.source.retainedText]));
  console.log(JSON.stringify({ realLocalCopy: true, referenceCount: references.length, actualAtomicReferences: true,
    finalProjection: true, historicalResultRecovery: true }));
} finally { db.close(); }
