/** Owned W2 HTTP-to-Core proof and original-source projection fixture. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { createHindsightClient } from "../../../../../packages/core/src/memory/hindsight/hindsight-client.ts";
import { requireHindsightTransitionClient, requireHindsightTransitionCapability } from "../../../../../packages/core/src/memory/hindsight/hindsight-transition-capability.ts";
import { requireHindsightApplicationClient } from "../../../../../packages/core/src/memory/hindsight/hindsight-application-capability.ts";
import { loadHindsightApplicationBundle } from "../../../../../packages/core/src/memory/hindsight/hindsight-application-bundle-loader.ts";
import { projectHindsightApplicationRecord, type HindsightApplicationEvidenceReader } from "../../../../../packages/core/src/memory/hindsight/hindsight-application-projection.ts";

assert.equal(process.env.TAKI_TRANSITION_HTTP_FIXTURE, "1");
const [endpoint, bankId, transitionId, oldSourceHash] = process.argv.slice(2);
assert(endpoint && bankId && transitionId && oldSourceHash);
assert.equal(new URL(endpoint).hostname, "127.0.0.1");
const context = { timeoutMs: 120_000 };
const client = requireHindsightTransitionClient(requireHindsightApplicationClient(createHindsightClient({ endpoint,
  resolveApiKey: () => "native-results-offline-test" })));
requireHindsightTransitionCapability(await client.compatibility(context));
const original = await client.transitionStatus({ bankId, transitionId, context });
assert(original.proof && !original.executor_live);
const attemptId = randomUUID();
const claimed = await client.claimTransition({ bankId, transitionId,
  request: { expected_revision: original.revision, attempt_id: attemptId }, context });
assert.equal(claimed.executor.attempt_id, attemptId);
assert.equal(claimed.executor.generation, original.executor.generation + 1);
assert.deepEqual(claimed.proof, original.proof);
const status = await client.verifyTransition({ bankId, request: claimed.executor, context });
assert(status.proof);
assert.deepEqual(status.proof, original.proof);
const decision = { executor: original.executor, disposition: "activate" as const, decision_id: randomUUID(),
  decision_hash: "e".repeat(64), core_receipt_id: "f".repeat(64), proof_hash: status.proof.proof_hash };
await assert.rejects(client.resolveTransition({ bankId, request: decision, context }), /HINDSIGHT_TRANSITION_EXECUTOR_LOST/);
const delta = await client.transitionDelta({ bankId, transitionId, context });
assert(delta && status.proof.delta_result_hash === delta.result_hash);
await client.transitionEvidence({ bankId, transitionId, proofHash: status.proof.proof_hash, pageNumber: 0, context });
await client.transitionAuxiliary({ bankId, transitionId, proofHash: status.proof.proof_hash, pageNumber: 0, context });
const namespace = status.proof.application_snapshot.namespace;
const bundle = await loadHindsightApplicationBundle({ client, namespace, bankId, context, manifest: status.proof.application_snapshot });
const records = bundle.pages.flatMap((page) => page.records);
const evidence: HindsightApplicationEvidenceReader = {
  body(ref) { const value = bundle.bodies.get(ref.body_id); assert(value); return value; },
  artifact(version) {
    const value = records.find((record) => record.kind === "artifact" && record.artifact.key.artifact_kind === version.key.artifact_kind
      && record.artifact.key.artifact_id === version.key.artifact_id && record.artifact.revision === version.revision);
    assert(value?.kind === "artifact"); return value.artifact;
  },
};
const bankHead = records.find((record) => record.kind === "native" && record.head.object_kind === "bank");
assert(bankHead?.kind === "native");
const scope = { namespace, bankId, authorityEpochId: "owned-current-projection", bankScope: { kind: "global" as const, characterId: null }, evidence };
const bank = projectHindsightApplicationRecord({ ...scope, bank: undefined, head: bankHead.head });
assert(bank.status === "projected" && bank.record.payload?.kind === "bank");
const sourceHead = records.find((record) => record.kind === "native" && record.head.object_kind === "document");
assert(sourceHead?.kind === "native");
const source = projectHindsightApplicationRecord({ ...scope, bank: bank.record.payload.value, head: sourceHead.head });
assert(source.status === "projected" && source.record.payload?.kind === "document");
assert.equal(source.record.payload.value.retainedText, "Current Local original source");
assert.equal(source.record.payload.value.context, "");
assert.equal(source.record.payload.value.provenance.origin, "explicit-user");
assert.deepEqual(source.record.payload.value.metadata, JSON.parse('{"empty":"","null":null,"__proto__":{"constructor":[true,null,1,"1"]},"nested":[]}'));
assert([...bundle.bodies.values()].some((body) => createHash("sha256").update(body.bytes).digest("hex") === oldSourceHash));
const currentDecision = { ...decision, executor: claimed.executor };
const resolved = await client.resolveTransition({ bankId, request: currentDecision, context });
assert.equal(resolved.phase, "active");
assert.deepEqual(resolved.proof, original.proof);
assert.deepEqual(resolved.outcome?.request, currentDecision);
console.log(JSON.stringify({ nativeProof: true, deltaIdentity: true, originalSourceProjection: true,
  typedMetadataPreserved: true, previousRawBodyPreserved: true, coreClaimRecoveredSameProof: true,
  coreOldExecutorRefused: true, coreExactDecisionResolved: true }));
