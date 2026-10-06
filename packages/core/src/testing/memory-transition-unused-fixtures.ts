/**
 * INPUT:  admitted Local re-entry identity for a new scope and isolated deterministic native Bank data
 * OUTPUT: complete empty native/application inventory with a signed unused-scope acquisition shape
 * POS:    core/testing — synthetic native evidence for Core publication and release verification
 */
import { randomUUID } from "node:crypto";
import { HindsightTransitionUnusedScopeSchema, type MemoryTransitionIntent } from "@taki/shared";
import { evidenceFromBundle } from "./memory-transition-candidate-fixtures.ts";
import { applicationTestNative, applicationTestBankPayload } from "./hindsight-application-fixtures.ts";
import { signHindsightTransitionAcquire, hindsightTransitionHash } from "../memory/hindsight/hindsight-transition-proof.ts";

export function transitionUnusedFixture(intent: MemoryTransitionIntent) {
  const scope = { bankId: "new-native-bank", namespace: { application_id: "taki" as const,
    provider_lineage: intent.request.expected.targetLineageId, bank_generation: randomUUID() } };
  const evidence = evidenceFromBundle({ transitionId: intent.transitionId, scope, artifacts: [],
    native: [applicationTestNative({ scope, kind: "bank", payload: applicationTestBankPayload(scope), cursor: 1 })] });
  const proof = HindsightTransitionUnusedScopeSchema.parse({ bank_id: scope.bankId, provider_lineage: scope.namespace.provider_lineage,
    bank_generation: scope.namespace.bank_generation, creation_id: randomUUID(), native_cursor: 1,
    template_hash: "a".repeat(64), history_hash: "b".repeat(64), baseline_hash: evidence.status.proof!.baseline_hash, proof_hash: "0".repeat(64) });
  proof.proof_hash = hindsightTransitionHash(Object.fromEntries(Object.entries(proof).filter(([key]) => key !== "proof_hash")));
  const request = signHindsightTransitionAcquire(scope.bankId, { ...evidence.status.request, direction: "reenter-hindsight", unused_scope: proof });
  return { evidence, target: { ...evidence.status, request, proof: null, phase: "fenced" as const },
    inventory: { nativeSnapshot: evidence.status.proof!.native_snapshot, nativePages: evidence.nativePages,
      applicationManifest: evidence.status.proof!.application_snapshot, applicationPages: evidence.applicationPages, bodies: evidence.bodies } };
}
