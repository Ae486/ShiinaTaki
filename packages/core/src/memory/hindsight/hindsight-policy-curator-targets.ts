/**
 * INPUT:  application-verified due work and current Core-owned Block snapshots
 * OUTPUT: lexical exact-target reads and fresh model/publication admission checks
 * POS:    core/memory/hindsight — no whole-source expansion or inferred cross-Bank ownership
 */
import { TakiApplicationBlockBodySchema, type CanonicalMemoryBank, type MemoryReplicaBank,
  type TakiApplicationArtifact, type TakiApplicationNativeHead } from "@taki/shared";
import { V1_BLOCKS, getBlock } from "../block-registry.ts";
import { isSafeAutomaticMemoryText } from "../canonical-ingestion-source.ts";
import { HindsightPolicyTargetSchema, validateHindsightPolicyWorkTarget, policyAssessmentTarget,
  type HindsightPolicyWorkScope, type HindsightPolicyTarget, type HindsightPolicySourceRef,
  type HindsightPolicyBlockTarget, type HindsightPolicyBlockSnapshot, type HindsightPolicyWorkTarget } from "../../db/hindsight-policy-work-contract.ts";
import { readHindsightApplicationNative } from "./hindsight-application-projection.ts";
import { hindsightPolicyAdmission } from "./hindsight-policy-admission.ts";
import { requireApplicationScope, sameApplicationValue, type HindsightApplicationScope } from "./hindsight-application-integrity.ts";
import type { HindsightPolicyCuratorRun, HindsightPolicyCuratorReview } from "./hindsight-policy-curator-context.ts";

export function readCuratorSnapshot<T>(run: HindsightPolicyCuratorRun, read: (current: HindsightPolicyCuratorRun) => T): T {
  return run.deps.replica.readSnapshot((replica) => {
    run.alive();
    const banks = run.deps.resolveBanks(run.characterId);
    return read({ ...run, deps: { ...run.deps, replica, resolveBanks: () => banks } });
  });
}

export function requireCuratorBank(run: HindsightPolicyCuratorRun, bankId: string) {
  run.alive(); const epoch = run.deps.authority.authorityEpoch(run.epochId);
  const binding = run.deps.replica.bankBinding(bankId);
  if (epoch.providerId !== "hindsight" || epoch.providerLineageId !== run.lineage || !binding?.bank
    || binding.authorityEpochId !== run.epochId || binding.namespace.provider_lineage !== run.lineage
    || binding.bankDeleted || binding.bindingState !== "bound"
    || binding.scope.kind === "character" && binding.scope.characterId !== run.characterId) authority();
  const declared = run.deps.resolveBanks(run.characterId).some((bank: MemoryReplicaBank) => bank.bankId === bankId
    && bank.scope === binding.scope.kind && bank.characterId === binding.scope.characterId);
  if (!declared) authority();
  return { scope: { authorityEpochId: run.epochId, bankId, namespace: binding.namespace }, bank: binding.bank };
}

export function captureCuratorPolicyTarget(run: HindsightPolicyCuratorRun, input: {
  scope: HindsightPolicyWorkScope; bank: CanonicalMemoryBank; head: TakiApplicationNativeHead;
}): HindsightPolicyTarget {
  const { scope, head } = input; const repo = run.deps.replica;
  if (!head.bound_artifact || !head.version || head.binding_state !== "bound") invalid();
  const artifact = repo.artifact({ ...scope, version: head.bound_artifact });
  if (!artifact) invalid();
  const readBody = (ref: TakiApplicationArtifact["body_ref"]) => {
    const body = repo.body({ ...scope, bodyId: ref.body_id });
    if (!body || !sameApplicationValue(body.ref, ref)) invalid();
    // The replica body reader already verifies descriptor, bytes and payload.
    return body;
  };
  const access = { body: readBody, decodedBody: (ref: TakiApplicationArtifact["body_ref"], current: HindsightApplicationScope) => {
    requireApplicationScope({ namespace: scope.namespace, bank_id: scope.bankId }, current);
    return readBody(ref);
  }, artifact: (version: NonNullable<TakiApplicationNativeHead["bound_artifact"]>) => {
    const value = repo.artifact({ ...scope, version }); if (!value) invalid(); return value;
  } };
  const native = readHindsightApplicationNative({ ...scope, head, evidence: access });
  const body = access.body(artifact.body_ref).content;
  if (body.body_schema !== "application-memory.v1") invalid();
  const target = HindsightPolicyTargetSchema.parse({ kind: "policy", bank: input.bank, native, artifact, memory: body.value });
  validateHindsightPolicyWorkTarget(scope, target); return target;
}

export function assertCuratorPolicyReadable(run: HindsightPolicyCuratorRun, scope: HindsightPolicyWorkScope, target: HindsightPolicyTarget): void {
  const current = requireCuratorBank(run, scope.bankId);
  if (!sameApplicationValue(current.scope.namespace, scope.namespace) || !sameApplicationValue(current.bank.scope, target.bank.scope)) authority();
  const head = run.deps.replica.nativeHead({ ...scope, objectKind: "memory_unit", objectId: target.native.version.object_id });
  if (!head || !sameApplicationValue(head.version, target.native.version) || !sameApplicationValue(head.bound_artifact,
    { key: target.artifact.key, revision: target.artifact.revision, record_hash: target.artifact.record_hash })) revision();
  const admission = hindsightPolicyAdmission({ ...policyAssessmentTarget(scope, target), at: now(run), query: "" });
  if (!admission.eligible) revision();
  if (target.memory.policy.disclosure?.trim() && !isSafeAutomaticMemoryText(target.memory.policy.disclosure)) invalid();
}

export function policySourceRef(scope: HindsightPolicyWorkScope, target: HindsightPolicyTarget): HindsightPolicySourceRef {
  return { bankId: scope.bankId, namespace: scope.namespace, native: target.native.version,
    artifact: { key: target.artifact.key, revision: target.artifact.revision, record_hash: target.artifact.record_hash } };
}

export function captureCuratorBlocks(run: HindsightPolicyCuratorRun, bank: CanonicalMemoryBank): HindsightPolicyBlockSnapshot[] {
  return V1_BLOCKS.filter((block) => block.ownership === "global" || bank.scope.kind === "character")
    .map((definition) => {
      const scope = definition.ownership === "global" ? { kind: "global" as const, characterId: null } : bank.scope;
      const raw = run.deps.readBlock(definition.id, scope);
      const value = raw ? TakiApplicationBlockBodySchema.parse({ block_id: raw.blockId, scope: raw.scope,
        content: raw.content, block_revision: raw.revision, updated_at: raw.updatedAt, writer: definition.writer, block_contract_version: 1 }) : null;
      if (value && (value.block_id !== definition.id || !sameApplicationValue(value.scope, scope)
        || value.content.trim() && !isSafeAutomaticMemoryText(value.content))) invalid();
      return { blockId: definition.id, scope, value };
    });
}

export function captureCuratorBlockTarget(run: HindsightPolicyCuratorRun, input: {
  scope: HindsightPolicyWorkScope; bank: CanonicalMemoryBank; blockId: string;
  sources: HindsightPolicySourceRef[]; blocks: HindsightPolicyBlockSnapshot[];
}): HindsightPolicyBlockTarget {
  const block = input.blocks.find((value) => value.blockId === input.blockId);
  if (!block || !sameApplicationValue(block.scope, input.bank.scope)) invalid();
  const matches = run.deps.replica.blockArtifacts(input.scope).filter((artifact) => {
    const body = run.deps.replica.body({ ...input.scope, bodyId: artifact.body_ref.body_id });
    if (!body || body.content.body_schema !== "application-block.v1") invalid();
    return body.content.value.block_id === input.blockId && sameApplicationValue(body.content.value.scope, input.bank.scope);
  });
  if (matches.length > 1) invalid();
  const target: HindsightPolicyBlockTarget = { kind: "block", bank: input.bank, blockId: input.blockId,
    block: block.value, artifact: matches[0] ?? null, sources: input.sources, contextBlocks: input.blocks };
  validateHindsightPolicyWorkTarget(input.scope, target); return target;
}

export function assertCuratorBlockCurrent(run: HindsightPolicyCuratorRun, scope: HindsightPolicyWorkScope,
  target: HindsightPolicyBlockTarget): void {
  const binding = requireCuratorBank(run, scope.bankId);
  if (!sameApplicationValue(binding.scope.namespace, scope.namespace) || !sameApplicationValue(binding.bank.scope, target.bank.scope)) authority();
  const current = captureCuratorBlocks(run, binding.bank);
  if (!sameApplicationValue(current, target.contextBlocks)) revision();
  const captured = captureCuratorBlockTarget(run, { scope, bank: binding.bank, blockId: target.blockId,
    sources: target.sources, blocks: current });
  if (!sameApplicationValue(captured.artifact, target.artifact)) revision();
}

export function readCuratorSource(run: HindsightPolicyCuratorRun, input: {
  owner: CanonicalMemoryBank; source: HindsightPolicySourceRef; exactPolicy: boolean;
}): HindsightPolicyTarget {
  const current = requireCuratorBank(run, input.source.bankId);
  if (input.owner.scope.kind === "global" && current.bank.scope.kind !== "global"
    || !sameApplicationValue(current.scope.namespace, input.source.namespace)) authority();
  const head = run.deps.replica.nativeHead({ ...current.scope, objectKind: "memory_unit", objectId: input.source.native.object_id });
  if (!head || !sameApplicationValue(head.version, input.source.native)
    || input.exactPolicy && !sameApplicationValue(head.bound_artifact, input.source.artifact)) revision();
  const target = captureCuratorPolicyTarget(run, { ...current, head });
  assertCuratorPolicyReadable(run, current.scope, target); return target;
}

export function assertCuratorReviewOpen(review: HindsightPolicyCuratorReview): void {
  review.run.alive(); if (review.closed || review.finished) throw new Error("MEMORY_OPERATION_CANCELLED");
}
export function assertCuratorReviewInputs(review: HindsightPolicyCuratorReview): void {
  assertCuratorReviewOpen(review);
  readCuratorSnapshot(review.run, (run) => {
    if (!sameApplicationValue(captureCuratorBlocks(run, review.bank), review.blocks)) revision();
    for (const record of review.records.values()) assertCuratorWorkCurrent(run, { scope: record.key, target: record.target });
  });
}
export function assertCuratorWorkCurrent(run: HindsightPolicyCuratorRun, input: {
  scope: HindsightPolicyWorkScope; target: HindsightPolicyWorkTarget; exactPolicy?: boolean;
}): void {
  readCuratorSnapshot(run, (current) => assertWorkCurrent(current, input));
}
function assertWorkCurrent(run: HindsightPolicyCuratorRun, input: {
  scope: HindsightPolicyWorkScope; target: HindsightPolicyWorkTarget; exactPolicy?: boolean;
}): void {
  const { scope, target } = input;
  if (target.kind === "policy") assertCuratorPolicyReadable(run, scope, target);
  else {
    assertCuratorBlockCurrent(run, scope, target);
    for (const source of target.sources) readCuratorSource(run, { owner: target.bank, source, exactPolicy: input.exactPolicy ?? true });
  }
}
export function curatorWritableBlocks(bank: CanonicalMemoryBank): string[] {
  return V1_BLOCKS.filter((block) => block.writer === "background"
    && (block.ownership === "global" ? "global" : "character") === bank.scope.kind).map((block) => block.id);
}
export function curatorBlockDefinition(id: string) { const value = getBlock(id); if (!value) invalid(); return value; }
function now(run: HindsightPolicyCuratorRun): string { return run.deps.now?.() ?? new Date().toISOString(); }
function invalid(): never { throw new Error("MEMORY_INTEGRITY_ERROR"); }
function authority(): never { throw new Error("MEMORY_AUTHORITY_MISMATCH"); }
function revision(): never { throw new Error("MEMORY_REVISION_MISMATCH"); }
