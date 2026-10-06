/**
 * INPUT: owned prepared W3 deltas and their exact prior synthetic native evidence
 * OUTPUT: complete post-delta evidence/result fixtures for multi-Bank final-candidate validation
 * POS: core/testing — deterministic producer shapes, not a claim of native maintenance execution
 */
import { HindsightTransitionDeltaResultSchema, type MemoryTransitionNativeEvidence, type MemoryTransitionPreparation } from "@taki/shared";
import { transitionProjectionContext } from "../memory/transitions/transition-local-projection.ts";
import { sealTransitionNativeEvidence } from "../memory/transitions/transition-native-evidence.ts";
import { hindsightTransitionHash } from "../memory/hindsight/hindsight-transition-proof.ts";
import type { ApplicationNativeFixture } from "./hindsight-application-fixtures.ts";
import { evidenceFromBundle } from "./memory-transition-candidate-fixtures.ts";
import { applyFixtureNativeDelta } from "./memory-transition-delta-native-fixtures.ts";
import { applyFixtureArtifactDelta } from "./memory-transition-delta-artifact-fixtures.ts";
import type { HindsightApplicationBody } from "../memory/hindsight/hindsight-application-integrity.ts";

export function transitionFinalFixture(prepared: MemoryTransitionPreparation, old: MemoryTransitionNativeEvidence, uploads: HindsightApplicationBody[] = []) {
  const context = transitionProjectionContext(old);
  const scope = { bankId: prepared.scope.nativeBankId, namespace: old.status.proof!.application_snapshot.namespace };
  const native: ApplicationNativeFixture[] = context.heads.map((raw) => {
    const head = structuredClone(raw);
    // The fixture shape requires a body field; tombstones never serialize it into a page or body closure.
    const body = context.reader.body(head.body_ref ?? context.heads.find((row) => row.object_kind === "bank")!.body_ref!);
    const source = body.content.body_schema === "application-native-record.v1" ? body.content.value.source_evidence_ref : null;
    return { head, body, bodies: head.body_ref ? [body, ...(source ? [context.reader.body(source)] : [])] : [] };
  });
  const artifacts = [...context.artifacts.values()].map((artifact) => ({ artifact, body: context.reader.body(artifact.body_ref) }));
  const applied = applyFixtureNativeDelta(prepared, scope, native);
  const changed = applyFixtureArtifactDelta(prepared, { scope, native, artifacts });
  const resultBody = { protocol: "taki-transition-v1", operation_id: prepared.request.operation_id, transition_id: prepared.transitionId,
    bank_id: scope.bankId, provider_lineage: scope.namespace.provider_lineage, bank_generation: scope.namespace.bank_generation,
    request_hash: prepared.request.request_hash, baseline_proof_hash: prepared.request.baseline_proof_hash,
    unused_scope_hash: prepared.request.unused_scope?.proof_hash ?? null,
    local_manifest_hash: prepared.request.local_manifest_hash, native_before_cursor: old.status.proof!.native_snapshot.manifest.end_cursor,
    native_through_cursor: applied.cursor, application_through_cursor: 0,
    mappings: applied.mappings,
    artifacts: prepared.request.application.map((row) => ({ key: row.key, previous: row.expected_artifact,
      previous_body_hash: row.expected_body_hash, current: changed.get(JSON.stringify(row.key)) ?? row.expected_artifact,
      source_record_hash: row.source_record_hash, disposition: row.disposition === "reuse" ? "reused" : row.disposition === "retire" ? "retired" : "upserted" })) };
  const result = HindsightTransitionDeltaResultSchema.parse({ ...resultBody, result_hash: hindsightTransitionHash(resultBody) });
  const nested = artifacts.flatMap(({ body }) => {
    if (body.content.body_schema !== "application-source-evidence.v1") return [];
    const ref = body.content.value.source_ref;
    return [uploads.find((value) => value.ref.body_id === ref.body_id) ?? context.reader.body(ref)];
  });
  const raw = evidenceFromBundle({ transitionId: prepared.transitionId, scope, native, artifacts, extraBodies: nested });
  raw.status.request = prepared.target.request; raw.status.executor = prepared.target.executor;
  const proof = raw.status.proof!; proof.executor = prepared.target.executor; proof.request_hash = prepared.target.request.request_hash;
  proof.delta_result_hash = result.result_hash;
  proof.unused_scope_hash = prepared.request.unused_scope?.proof_hash ?? null;
  proof.proof_hash = hindsightTransitionHash({ domain: "transition-proof.v1", proof: Object.fromEntries(Object.entries(proof).filter(([key]) => key !== "proof_hash")) });
  for (const page of raw.maintenancePages) page.certificate_hash = proof.proof_hash;
  for (const page of raw.auxiliaryPages) page.proof_hash = proof.proof_hash;
  return { result, evidence: sealTransitionNativeEvidence(raw) };
}
