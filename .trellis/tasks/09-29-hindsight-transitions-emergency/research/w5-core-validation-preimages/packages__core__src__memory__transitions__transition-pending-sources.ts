/**
 * INPUT: authenticated complete final application evidence and the admitted stable Bank mapping
 * OUTPUT: exact unconfirmed Source bytes/operation identity for W4 custody and factual disposition
 * POS: core/memory/transitions — pending Source evidence is never a confirmed Local document or fact
 */
import { MemoryTransitionPendingSourceSchema, type MemoryTransitionNativeEvidence, type MemoryTransitionScopeMapping } from "@taki/shared";
import { transitionProjectionContext } from "./transition-local-projection.ts";

export function projectTransitionPendingSources(evidence: MemoryTransitionNativeEvidence, scope: MemoryTransitionScopeMapping) {
  const context = transitionProjectionContext(evidence); const proof = evidence.status.proof;
  if (!proof || scope.evidenceId !== evidence.evidenceId || scope.nativeBankId !== proof.bank_id
    || scope.nativeGeneration !== proof.bank_generation) invalid();
  // Earlier awaiting revisions remain in the immutable evidence. A later proved binding closes that
  // obligation; only each current artifact's actual awaiting state enters W4's disposition inventory.
  const latest = new Map<string, (typeof context.artifacts extends Map<string, infer T> ? T : never)>();
  for (const artifact of context.artifacts.values()) {
    const key = JSON.stringify(artifact.key); const previous = latest.get(key);
    if (!previous || previous.revision < artifact.revision) latest.set(key, artifact);
  }
  return [...latest.values()].filter((artifact) => artifact.binding.kind === "awaiting_native").map((artifact) => {
    const binding = artifact.binding; if (binding.kind !== "awaiting_native") invalid();
    const body = context.reader.body(artifact.body_ref);
    if (body.content.body_schema !== "application-source.v1") invalid();
    return MemoryTransitionPendingSourceSchema.parse({ localBankId: scope.localBankId, nativeBankId: scope.nativeBankId,
      namespace: artifact.namespace, evidenceId: evidence.evidenceId, proofHash: proof.proof_hash,
      artifact: { key: artifact.key, revision: artifact.revision, record_hash: artifact.record_hash }, bodyRef: artifact.body_ref,
      base64: Buffer.from(body.bytes).toString("base64"), operationId: binding.operation_id, documentId: binding.document_id,
      source: body.content.value, tombstoned: artifact.tombstoned });
  }).sort((left, right) => JSON.stringify(left.artifact).localeCompare(JSON.stringify(right.artifact), "en"));
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
