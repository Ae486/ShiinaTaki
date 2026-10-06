/**
 * INPUT: initial synthetic native inventory and real historical Local source data
 * OUTPUT: Source-version fixture and a genuinely new Local Bank with synthetic unused native evidence
 * POS: core/testing — real Local writers remain responsible for copy, reinforcement and lifecycle effects
 */
import { randomUUID } from "node:crypto";
import { HindsightTransitionUnusedScopeSchema, TakiApplicationNativePayloadSchema, type MemoryTransitionNativeEvidence } from "@taki/shared";
import { transitionProjectionContext } from "../memory/transitions/transition-local-projection.ts";
import { applicationTestArtifact, applicationTestBody, applicationTestNative, applicationTestMemoryBody, applicationTestBankPayload } from "./hindsight-application-fixtures.ts";
import { applicationTestBind } from "./hindsight-application-runtime-fixtures.ts";
import { evidenceFromBundle } from "./memory-transition-candidate-fixtures.ts";
import { addTransitionSourceAliases } from "./memory-transition-source-fixtures.ts";
import { createCanonicalMemoryAuthorityRepo } from "../db/canonical-memory-authority-repo.ts";
import { createHindsightBankSetupRepo } from "../db/hindsight-bank-setup-repo.ts";
import { hindsightTransitionHash } from "../memory/hindsight/hindsight-transition-proof.ts";
import type { createHealthyTransitionHarness } from "./memory-transition-healthy-fixtures.ts";
import type { seedLocalB2CoverageFixture } from "../db/hindsight-local-coverage-fixtures.ts";

type Harness = Awaited<ReturnType<typeof createHealthyTransitionHarness>>;
export function healthySourceEvidence(old: MemoryTransitionNativeEvidence, local: ReturnType<typeof seedLocalB2CoverageFixture>) {
  const context = transitionProjectionContext(old); const scope = { bankId: old.status.bank_id, namespace: old.status.proof!.application_snapshot.namespace };
  const bank = context.heads.find((head) => head.object_kind === "bank")!;
  const source = local.source;
  const document = applicationTestNative({ scope, kind: "document", cursor: 20, source: { text: source.retainedText, context: source.context, metadata: source.metadata },
    payload: { bank_id: scope.bankId, document_id: "journey-native-document", content_hash: source.contentHash,
      tags: source.tags, metadata: source.metadata, observation_scopes: source.observationScopes, created_at: source.createdAt, updated_at: source.updatedAt } });
  const original = applicationTestArtifact({ scope, key: { artifact_kind: "source", artifact_id: source.documentId },
    binding: { kind: "exact_native", native: document.head.version! }, body: applicationTestBody("application-source.v1", {
      original_source: source, encoded_metadata: source.metadata, original_witness: { source_kind: "document",
        source_id: document.head.object_id, source_revision: 1, source_payload_hash: document.head.version!.payload_hash }, operation_id: null }, scope) });
  applicationTestBind(document, original.artifact);
  const record = { ...local.record, unit: { ...local.record.unit, memoryId: "journey-unit" }, policy: { ...local.record.policy, memoryId: "journey-unit" } };
  const fields = Object.fromEntries(Object.entries(record.unit).filter(([key]) => !["authorityEpochId", "bankId", "memoryId", "documentId"].includes(key))
    .map(([key, value]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), value]));
  const memory = applicationTestNative({ scope, kind: "memory_unit", cursor: 21,
    payload: TakiApplicationNativePayloadSchema.parse({ ...fields, bank_id: scope.bankId, memory_id: "journey-native-unit", document_id: document.head.object_id }) });
  const policy = applicationTestArtifact({ scope, key: { artifact_kind: "memory", artifact_id: "journey-unit" },
    binding: { kind: "exact_native", native: memory.head.version! }, body: applicationTestBody("application-memory.v1",
      applicationTestMemoryBody(memory.head.version!, { policy: record.policy, provenance: record.provenance, original_record: record,
        encoded_metadata: record.unit.metadata }), scope) });
  applicationTestBind(memory, policy.artifact);
  const native = [{ head: structuredClone(bank), body: context.reader.body(bank.body_ref!), bodies: [context.reader.body(bank.body_ref!)] }, document, memory];
  const artifacts = [...context.artifacts.values()].map((artifact) => ({ artifact, body: context.reader.body(artifact.body_ref) }));
  artifacts.push(original, policy); addTransitionSourceAliases({ native, artifacts });
  return evidenceFromBundle({ transitionId: old.transitionId, scope, native, artifacts });
}

export function addHealthyUnusedBank(h: Harness, characterId: string) {
  const authority = createCanonicalMemoryAuthorityRepo(h.db); const epoch = authority.activeEpoch();
  const bank = authority.createBank({ authorityEpochId: epoch.epochId, bankId: `local-${characterId}`,
    scope: { kind: "character", characterId }, name: characterId, disposition: { skepticism: 3, literalism: 3, empathy: 3 }, mission: "", config: {} });
  const setup = createHindsightBankSetupRepo(h.db); const template = setup.get("character:taki")!;
  const nativeBankId = `native-${characterId}`;
  setup.upsert({ ...template, canonicalIdentity: `character:${characterId}`, externalBankId: nativeBankId });
  const scope = { bankId: nativeBankId, namespace: { application_id: "taki" as const,
    provider_lineage: h.initial[0]!.status.request.provider_lineage, bank_generation: randomUUID() } };
  const evidence = evidenceFromBundle({ transitionId: randomUUID(), scope, artifacts: [],
    native: [applicationTestNative({ scope, kind: "bank", payload: applicationTestBankPayload(scope), cursor: 1 })] });
  const proof = HindsightTransitionUnusedScopeSchema.parse({ bank_id: nativeBankId, provider_lineage: scope.namespace.provider_lineage,
    bank_generation: scope.namespace.bank_generation,
    creation_id: randomUUID(), native_cursor: 1, template_hash: template.templateDigest, history_hash: "b".repeat(64),
    baseline_hash: evidence.status.proof!.baseline_hash, proof_hash: "0".repeat(64) });
  proof.proof_hash = hindsightTransitionHash(Object.fromEntries(Object.entries(proof).filter(([key]) => key !== "proof_hash")));
  h.remote.registerUnused(evidence, proof); return bank;
}
