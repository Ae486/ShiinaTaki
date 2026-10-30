/**
 * INPUT:  complete verified replica evidence, trusted Bank routing and original activation artifacts
 * OUTPUT: restriction-preserving Bank/source/memory bodies for exact native binding commands
 * POS:    core/memory/hindsight — deterministic policy initialization/rebinding; no model call or speculative source matching
 */
import {
  TakiApplicationBankBodySchema, TakiApplicationMemoryBodySchema, TakiApplicationSourceBodySchema,
  type CanonicalMemoryBank, type MemoryBankScope, type TakiApplicationArtifact,
  type TakiApplicationArtifactVersion, type TakiApplicationNativeHead, type TakiApplicationNativeRecord,
  type TakiApplicationMemoryBody,
} from "@taki/shared";
import type { HindsightApplicationReplicaRepo } from "../../db/hindsight-application-replica-contract.ts";
import { assertHindsightApplicationOriginalBinding,
  type HindsightApplicationBootstrapEvidence } from "../../db/hindsight-application-bootstrap-evidence.ts";
import { resolveHindsightApplicationPolicy } from "./hindsight-application-policy.ts";
import { rebindHindsightApplicationPolicyEvidence } from "./hindsight-policy-assessment.ts";
import { requirePersistedHindsightPolicy, requireHindsightPolicyOwnership,
  type VerifiedHindsightPolicyContext } from "./hindsight-policy-context.ts";
import { projectHindsightApplicationNativeUnit, readHindsightApplicationNative,
  type HindsightApplicationEvidenceReader } from "./hindsight-application-projection.ts";
import { createHindsightApplicationProviderSource, readHindsightApplicationSourceEvidence } from "./hindsight-application-source-binding.ts";
import { sameApplicationValue, type HindsightApplicationScope } from "./hindsight-application-integrity.ts";

export interface HindsightApplicationBindingContext extends HindsightApplicationScope {
  authorityEpochId: string; bankScope: MemoryBankScope; bank: CanonicalMemoryBank;
  repo: HindsightApplicationReplicaRepo; evidence: HindsightApplicationEvidenceReader;
  original: HindsightApplicationBootstrapEvidence | undefined;
}
interface Work { head: TakiApplicationNativeHead; native: TakiApplicationNativeRecord; prior: TakiApplicationArtifact | null; at: string }

export function hindsightApplicationEvidenceReader(repo: HindsightApplicationReplicaRepo, scope: HindsightApplicationScope): HindsightApplicationEvidenceReader {
  return {
    body: (ref) => {
      const body = repo.body({ ...scope, bodyId: ref.body_id });
      if (!body || !sameApplicationValue(body.ref, ref)) invalid();
      return body;
    },
    artifact: (version) => {
      const artifact = repo.artifact({ ...scope, version });
      if (!artifact) invalid();
      return artifact;
    },
  };
}

export function hindsightApplicationBindingBody(context: HindsightApplicationBindingContext, work: Work) {
  if (work.native.version.object_kind === "bank") return { schema: "application-bank.v1" as const, value: bankBody(context, work) };
  if (work.native.version.object_kind === "document") return { schema: "application-source.v1" as const, value: sourceBody(context, work) };
  if (work.native.version.object_kind === "memory_unit") return { schema: "application-memory.v1" as const, value: memoryBody(context, work) };
  return invalid();
}

function bankBody(context: HindsightApplicationBindingContext, work: Work) {
  if (work.prior) {
    const body = context.evidence.body(work.prior.body_ref).content;
    if (body.body_schema !== "application-bank.v1" || !sameApplicationValue(body.value.scope, context.bankScope)) invalid();
    return body.value;
  }
  const original = context.original;
  if (original) assertHindsightApplicationOriginalBinding(original.bank, work.native.version);
  return TakiApplicationBankBodySchema.parse({ scope: context.bankScope, original_bank: original?.bank.value ?? null,
    original_provider_lineage: original?.originalProviderLineage ?? null,
    original_authority_epoch_id: original?.bank.value.authorityEpochId ?? null });
}

function sourceBody(context: HindsightApplicationBindingContext, work: Work) {
  if (work.prior) {
    const body = context.evidence.body(work.prior.body_ref).content;
    if (body.body_schema !== "application-source.v1") invalid();
    // Rebinding does not rewrite the original source or pretend that an old
    // operation's text is the body of a later native document revision.
    return body.value;
  }
  const original = context.original?.sources.get(work.head.object_id);
  if (original) {
    assertHindsightApplicationOriginalBinding(original, work.native.version);
    const native = original.native;
    return TakiApplicationSourceBodySchema.parse({ original_source: original.value, encoded_metadata: original.value.metadata,
      original_witness: { source_kind: native.object_kind, source_id: native.object_id,
        source_revision: native.object_revision, source_payload_hash: native.payload_hash }, operation_id: original.operationId });
  }
  const source = readHindsightApplicationSourceEvidence({ ...context, native: work.native });
  return createHindsightApplicationProviderSource({ ...context, native: work.native, source, at: work.at });
}

function memoryBody(context: HindsightApplicationBindingContext, work: Work): TakiApplicationMemoryBody {
  const policyContext = hindsightApplicationPolicyContext(context, work.native);
  const sourceArtifacts = currentSourceArtifacts(context, policyContext.native.unit.documentId);
  if (work.prior) return rebindMemory(context, { ...work, policyContext, sourceArtifacts });
  const original = context.original?.memories.get(work.head.object_id);
  if (original) {
    assertHindsightApplicationOriginalBinding(original, work.native.version);
    requireHindsightPolicyOwnership(policyContext, original.value.policy);
    const body = TakiApplicationMemoryBodySchema.parse({ policy_basis: "curated", policy: original.value.policy,
      provenance: original.value.provenance, original_record: original.value, encoded_metadata: original.value.unit.metadata,
      source_artifacts: sourceArtifacts, assessment: { state: "not_required", target: work.native.version,
        attempts: 0, next_attempt_at: null, last_failure_code: null, prompt_version: null, prompt_hash: null, completed_at: null } });
    return original.native.object_revision !== work.native.version.object_revision
      || original.native.payload_hash !== work.native.version.payload_hash ? due(body, work.native) : body;
  }
  const address = { namespace: context.namespace, bankId: context.bankId, native: work.native.version };
  const resolved = resolveHindsightApplicationPolicy({ context: policyContext, state: { status: "authenticated-absence", ...address },
    initial: { stamp: { policyVersion: 1, updatedAt: work.at }, evidence: { kind: "provider-derived", observedAt: work.at } } });
  if (resolved.kind !== "initialize") invalid();
  return TakiApplicationMemoryBodySchema.parse({ ...resolved.body, source_artifacts: sourceArtifacts });
}

function rebindMemory(context: HindsightApplicationBindingContext, work: Work & {
  policyContext: VerifiedHindsightPolicyContext; sourceArtifacts: TakiApplicationArtifactVersion[];
}) {
  if (!work.prior || work.prior.binding.kind !== "exact_native") invalid();
  const content = context.evidence.body(work.prior.body_ref).content;
  if (content.body_schema !== "application-memory.v1") invalid();
  const previous = { status: "present" as const, namespace: context.namespace, bankId: context.bankId,
    native: work.prior.binding.native, artifact: hindsightApplicationArtifactVersion(work.prior), body: content.value };
  let body: TakiApplicationMemoryBody;
  if (sameApplicationValue(previous.native, work.native.version)) {
    if (work.head.binding_state !== "rebind_required" || work.head.cause !== "native_change") invalid();
    // A source dependency may change without changing the fact's own version.
    // Exact native equality is verified; this is app-only reassessment work.
    requirePersistedHindsightPolicy(work.policyContext, previous);
    body = due(content.value, work.native);
  } else body = rebindHindsightApplicationPolicyEvidence({ previous, current: work.policyContext, expectedArtifact: previous.artifact });
  return TakiApplicationMemoryBodySchema.parse({ ...body, source_artifacts: work.sourceArtifacts });
}

export function hindsightApplicationPolicyContext(context: Pick<HindsightApplicationBindingContext,
"namespace" | "bankId" | "authorityEpochId" | "bankScope" | "bank">, native: TakiApplicationNativeRecord): VerifiedHindsightPolicyContext {
  const unit = projectHindsightApplicationNativeUnit({ ...context, native });
  return { namespace: context.namespace, authorityEpochId: context.authorityEpochId, bank: context.bank,
    activeCharacterId: context.bankScope.characterId,
    native: { status: "verified", namespace: context.namespace, bankId: context.bankId, native: native.version, unit } };
}

function currentSourceArtifacts(context: HindsightApplicationBindingContext, documentId: string | null): TakiApplicationArtifactVersion[] {
  if (documentId === null) return [];
  const head = context.repo.nativeHead({ ...context, objectKind: "document", objectId: documentId });
  if (!head?.version || head.binding_state !== "bound") return [];
  readHindsightApplicationNative({ ...context, head });
  return context.repo.sourceArtifacts({ ...context, documentId }).filter((artifact) =>
    artifact.binding.kind === "exact_native" && sameApplicationValue(artifact.binding.native, head.version))
    .map(hindsightApplicationArtifactVersion);
}

export function hindsightApplicationArtifactVersion(artifact: TakiApplicationArtifact): TakiApplicationArtifactVersion {
  return { key: artifact.key, revision: artifact.revision, record_hash: artifact.record_hash };
}
function due(body: TakiApplicationMemoryBody, native: TakiApplicationNativeRecord): TakiApplicationMemoryBody {
  return TakiApplicationMemoryBodySchema.parse({ ...body, assessment: { state: "due", target: native.version,
    attempts: 0, next_attempt_at: null, last_failure_code: null, prompt_version: null, prompt_hash: null, completed_at: null } });
}
function invalid(): never { throw new Error("HINDSIGHT_APPLICATION_BINDING_EVIDENCE_INVALID"); }
