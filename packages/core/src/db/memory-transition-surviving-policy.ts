/**
 * INPUT: surviving missing-policy heads and the exact already committed healthy predecessor
 * OUTPUT: original Canonical records/policy history for byte-identical native/application versions only
 * POS: core/db — historical policy reuse; never creates policy or treats an old proof as a fresh emergency certificate
 */
import { z } from "zod";
import { TakiApplicationMemoryBodySchema, TakiApplicationNativeVersionSchema,
  type CanonicalMemoryRecord, type MemoryTransitionLocalState, type MemorySurvivingBankEvidence } from "@taki/shared";
import { readTransitionReceipt } from "./memory-transition-evidence-repo.ts";
import { readVerifiedTransitionPublication } from "./memory-transition-publication-reader.ts";
import { readTransitionCandidate, readTransitionNativeEvidence, type readTransitionPublishedNativeBaseline } from "./memory-transition-candidate-repo.ts";
import { withTransitionEvidenceContext, type TransitionEvidenceContext } from "../memory/transitions/transition-evidence-context.ts";
import { transitionProjectionContext } from "../memory/transitions/transition-local-projection.ts";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";
import type { Database } from "./sqlite.ts";

export interface SurvivingPolicyRecord { record: CanonicalMemoryRecord; history: MemoryTransitionLocalState["history"][number] }
const InitialPolicy = z.strictObject({ proofHash: z.string(), native: TakiApplicationNativeVersionSchema,
  logicalMemoryId: z.string(), localBankId: z.string(), body: TakiApplicationMemoryBodySchema });

export function readSurvivingBaselinePolicies(db: Database, input: { evidence: MemorySurvivingBankEvidence;
  predecessorEpochId: string; baseline: ReturnType<typeof readTransitionPublishedNativeBaseline>; verification?: TransitionEvidenceContext }): Map<string, SurvivingPolicyRecord> {
  input.verification?.assertOwner(db); input.verification?.assertIndependent();
  const wanted = input.evidence.heads.filter((head) => head.object_kind === "memory_unit" && head.version && head.binding_state === "binding_missing");
  if (wanted.length === 0) return new Map();
  const baseline = input.baseline; if (!baseline) invalid();
  return withTransitionEvidenceContext(db, (verification) => {
    const receipt = readTransitionReceipt(db, baseline.evidence.transitionId);
    if (!receipt || receipt.newEpochId !== input.predecessorEpochId || receipt.identity.targetProvider !== "hindsight") invalid();
    const publication = readVerifiedTransitionPublication(db, receipt.receiptId, verification);
    if (publication.version !== 1) invalid();
    const candidate = readTransitionCandidate(db, publication.candidateId);
    const scope = candidate.scopes.find((row) => row.nativeBankId === input.evidence.bankId);
    if (!scope || scope.evidenceId !== baseline.evidence.evidenceId || scope.nativeGeneration !== input.evidence.namespace.bank_generation) invalid();
    const evidence = readTransitionNativeEvidence(db, baseline.evidence.evidenceId, verification);
    const proof = evidence.status.proof;
    if (!proof || proof.bank_id !== input.evidence.bankId
      || transitionLocalHash(proof.application_snapshot.namespace) !== transitionLocalHash(input.evidence.namespace)) invalid();
    const context = transitionProjectionContext(evidence, verification);
    const nativeRecords = evidence.nativePages.flatMap((page) => page.records);
    const result = new Map<string, SurvivingPolicyRecord>();
    for (const head of wanted) {
      const previous = context.heads.find((row) => row.object_kind === head.object_kind && row.object_id === head.object_id);
      if (!previous || transitionLocalHash(previous) !== transitionLocalHash(head)) invalid();
      const originalNative = nativeRecords.find((row) => row.object_kind === head.object_kind && row.object_id === head.object_id);
      const currentNative = input.evidence.nativeRecords.find((row) => row.object_kind === head.object_kind && row.object_id === head.object_id);
      if (!originalNative || !currentNative || transitionLocalHash(originalNative) !== transitionLocalHash(currentNative)) invalid();
      const mapping = candidate.mappings.find((row) => row.localBankId === scope.localBankId && row.kind === "memory_unit"
        && transitionLocalHash(row.native) === transitionLocalHash(head.version));
      const record = mapping && candidate.state.records.find((row) => row.unit.bankId === mapping.localBankId && row.unit.memoryId === mapping.localId);
      if (!mapping || !record) invalid();
      const history = candidate.state.history.find((row) => {
        if (row.table !== "transition_initial_policy") return false;
        const saved = InitialPolicy.parse(JSON.parse(row.rowJson));
        return saved.logicalMemoryId === mapping.localId && saved.localBankId === mapping.localBankId
          && saved.proofHash === proof.proof_hash && transitionLocalHash(saved.native) === transitionLocalHash(head.version);
      });
      if (!history) invalid();
      const saved = InitialPolicy.parse(JSON.parse(history.rowJson));
      // The recorded first-policy body has Native addresses; the committed Canonical row already has logical IDs.
      const policy = { ...saved.body.policy, authorityEpochId: record.policy.authorityEpochId,
        bankId: record.policy.bankId, memoryId: record.policy.memoryId };
      if (transitionLocalHash(policy) !== transitionLocalHash(record.policy)
        || transitionLocalHash(saved.body.provenance) !== transitionLocalHash(record.provenance)) invalid();
      result.set(head.object_id, { record, history });
    }
    return result;
  }, input.verification);
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
