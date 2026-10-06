/**
 * INPUT:  fully verified native/application evidence, a stable Local Bank identity and original object mappings
 * OUTPUT: lossless Local records with translated logical references and preserved or explicit first neutral policies
 * POS:    core/memory/transitions — W3 reconstruction; original provider bytes remain in separate immutable evidence
 */
import { createHash } from "node:crypto";
import { HindsightCurrentCanonicalBankSchema, HindsightCurrentCanonicalSourceSchema, HindsightCurrentCanonicalRecordSchema,
  HindsightCurrentCanonicalDerivedSchema, type CanonicalMemoryBank, type CanonicalMemorySource, type CanonicalMemoryRecord,
  type CanonicalDerivedMemory, type MemoryTransitionNativeEvidence, type MemoryTransitionScopeMapping,
  type MemoryTransitionObjectMapping, type TakiApplicationNativeHead, type MemoryTransitionLocalState,
  type TakiApplicationBodyContent, type TakiApplicationBodyRef, type MemorySurvivingBankEvidence, type TakiApplicationNamespace,
  type HindsightSnapshotRecordWire, type HindsightTransitionProof } from "@taki/shared";
import { verifyTransitionNativeEvidence } from "./transition-native-evidence.ts";
import { applicationArtifactVersionKey } from "../hindsight/hindsight-application-bundle.ts";
import { projectHindsightApplicationRecord, projectHindsightApplicationNativeBank, projectHindsightApplicationNativeUnit,
  readHindsightApplicationNative } from "../hindsight/hindsight-application-projection.ts";
import { initializeHindsightTransitionPolicy } from "../hindsight/hindsight-application-policy.ts";
import { projectHindsightPolicyLayerTags } from "../hindsight/hindsight-policy-admission.ts";
import { transitionLocalHash } from "./transition-local-encoding.ts";
import { projectTransitionHistoricalReferences } from "./transition-historical-references.ts";
import { preserveTransitionLocalTimestamps } from "./transition-local-timestamps.ts";
import { projectTransitionSourceState } from "./transition-source-aliases.ts";
import { readHindsightApplicationSourceArtifact } from "../hindsight/hindsight-application-source-evidence.ts";
import type { TransitionEvidenceContext } from "./transition-evidence-context.ts";
import { verifySurvivingBankEvidence } from "./transition-surviving-evidence.ts";
import type { SurvivingPolicyRecord } from "../../db/memory-transition-surviving-policy.ts";

export function transitionSemanticHash(value: object): string {
  return transitionLocalHash(semantic(value));
}
function semantic(value: object): unknown {
  if ("unit" in value && "policy" in value) {
    const record = value as CanonicalMemoryRecord;
    return { ...record, unit: semantic(record.unit), policy: semantic(record.policy) };
  }
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "authorityEpochId" && key !== "bankId"));
}
export function transitionObjectKey(kind: string, id: string): string { return JSON.stringify([kind, id]); }

export function transitionProjectionContext(evidence: MemoryTransitionNativeEvidence, verification?: TransitionEvidenceContext) {
  const bundle = verification ? verification.bundle(evidence) : verifyTransitionNativeEvidence(evidence);
  const descriptors = bundle.pages.flatMap((page) => page.records);
  const heads = descriptors.filter((row) => row.kind === "native").map((row) => row.head);
  const artifacts = new Map(descriptors.filter((row) => row.kind === "artifact")
    .map((row) => [applicationArtifactVersionKey(row.artifact), row.artifact]));
  const reader = { body: (ref: TakiApplicationBodyRef) => {
    const body = bundle.bodies.get(ref.body_id); if (!body || transitionLocalHash(body.ref) !== transitionLocalHash(ref)) invalid(); return body;
  }, artifact: (version: Parameters<typeof applicationArtifactVersionKey>[0]) => {
    const artifact = artifacts.get(applicationArtifactVersionKey(version)); if (!artifact) invalid(); return artifact;
  } };
  const bound = (head: TakiApplicationNativeHead) => head.bound_artifact ? reader.artifact(head.bound_artifact) : null;
  const body = (head: TakiApplicationNativeHead) => { const artifact = bound(head); return artifact ? reader.body(artifact.body_ref).content : null; };
  return { bundle, heads, artifacts, reader, bound, body };
}
export type TransitionProjectionContext = Omit<ReturnType<typeof transitionProjectionContext>, "bundle">;

/** Both producers use the same logical projection; only the healthy path carries a native certificate. */
export interface LocalBankProjectionInput {
  scope: MemoryTransitionScopeMapping; epochId: string; createdAt: string;
  previous?: MemoryTransitionObjectMapping[]; localEpochIds?: string[];
  nativeBaseline?: { evidence: MemoryTransitionNativeEvidence; reusedMemoryIds: string[] };
  context: TransitionProjectionContext;
  evidenceId: string; evidenceHash: string; bankId: string; namespace: TakiApplicationNamespace;
  nativeRecords: HindsightSnapshotRecordWire[]; healthyProof: HindsightTransitionProof | null;
  survivingPolicies?: ReadonlyMap<string, SurvivingPolicyRecord>;
}

export function projectTransitionLocalBank(input: { evidence: MemoryTransitionNativeEvidence; scope: MemoryTransitionScopeMapping;
  epochId: string; createdAt: string; previous?: MemoryTransitionObjectMapping[]; localEpochIds?: string[];
  nativeBaseline?: { evidence: MemoryTransitionNativeEvidence; reusedMemoryIds: string[] }; verification?: TransitionEvidenceContext }): ReturnType<typeof projectLocalBank> {
  const { verification, ...semanticInput } = input;
  const compute = () => {
    const proof = input.evidence.status.proof; if (!proof) invalid();
    verifyProjectionBaseline(input, proof);
    return projectLocalBank({ ...input, context: transitionProjectionContext(input.evidence, input.verification),
      evidenceId: input.evidence.evidenceId, evidenceHash: proof.proof_hash, bankId: proof.bank_id,
      namespace: proof.application_snapshot.namespace, nativeRecords: input.evidence.nativePages.flatMap((page) => page.records), healthyProof: proof });
  };
  return verification ? verification.projectBank(semanticInput, compute) : compute();
}
export function projectSurvivingLocalBank(input: { evidence: MemorySurvivingBankEvidence; scope: MemoryTransitionScopeMapping;
  epochId: string; createdAt: string; previous?: MemoryTransitionObjectMapping[]; localEpochIds?: string[];
  nativeBaseline?: { evidence: MemoryTransitionNativeEvidence; reusedMemoryIds: string[] }; survivingPolicies?: ReadonlyMap<string, SurvivingPolicyRecord>;
  verification?: TransitionEvidenceContext }): ReturnType<typeof projectLocalBank> {
  const { verification, ...semanticInput } = input; const evidence = input.evidence;
  const compute = () => projectLocalBank({ ...semanticInput, context: verification ? verification.surviving(evidence) : verifySurvivingBankEvidence(evidence), evidenceId: evidence.evidenceId,
    evidenceHash: evidence.evidenceId, bankId: evidence.bankId, namespace: evidence.namespace,
    nativeRecords: evidence.nativeRecords, healthyProof: null });
  return verification ? verification.projectSurvivingBank(semanticInput, compute) : compute();
}
function projectLocalBank(input: LocalBankProjectionInput) {
  const context = input.context;
  const address = { namespace: input.namespace, bankId: input.bankId };
  const ids = resolveIds(input, context);
  const nativeBank = context.heads.find((head) => head.object_kind === "bank"); if (!nativeBank) invalid();
  const native = readHindsightApplicationNative({ ...address, head: nativeBank, evidence: context.reader });
  const originalBank = context.body(nativeBank);
  const projectedBank = projectHindsightApplicationNativeBank({ ...address, native, authorityEpochId: input.epochId, bankScope: input.scope.scope });
  const bank = HindsightCurrentCanonicalBankSchema.parse({ ...projectedBank, bankId: input.scope.localBankId,
    revision: originalBank?.body_schema === "application-bank.v1" ? originalBank.value.original_bank?.revision ?? projectedBank.revision : projectedBank.revision });
  const result = { bank, sources: [] as CanonicalMemorySource[], records: [] as CanonicalMemoryRecord[],
    derived: [] as CanonicalDerivedMemory[], mappings: [] as MemoryTransitionObjectMapping[],
    historicalReferences: projectTransitionHistoricalReferences({ source: input, context, ids, bankId: bank.bankId }),
    initialPolicies: [] as MemoryTransitionLocalState["history"] };
  for (const head of context.heads) {
    if (!head.version) continue; // Tombstones retain full head/history evidence, never a live Local row.
    const logicalId = ids.get(transitionObjectKey(head.object_kind, head.object_id));
    if (!logicalId) invalid();
    const primary = head.object_kind === "document" ? physicalSourceArtifact(input, context, { head, logicalId }) : null;
    // A prior physical Source may legitimately be older than the current native document. Preserve its
    // application address for the next CAS, but use it as a current projection only at the exact version.
    const currentPrimary = primary?.binding.kind === "exact_native"
      && transitionLocalHash(primary.binding.native) === transitionLocalHash(head.version) ? primary : null;
    const projectionHead = currentPrimary ? { ...head, binding_state: "bound" as const,
      bound_artifact: { key: currentPrimary.key, revision: currentPrimary.revision, record_hash: currentPrimary.record_hash } } : head;
    const runtimeBank = { ...bank, bankId: input.bankId };
    const projectionInput = { ...address, authorityEpochId: input.epochId, bankScope: bank.scope,
      bank: runtimeBank, head: projectionHead, evidence: context.reader };
    const projected = projectHindsightApplicationRecord(projectionInput);
    const body = context.body(projectionHead);
    const value = projectValue({ input, head: projectionHead, projected, body, projectionInput, context, logicalId, ids, bank,
      initialPolicies: result.initialPolicies });
    if (head.object_kind === "document") result.sources.push(value as CanonicalMemorySource);
    else if (head.object_kind === "memory_unit") result.records.push(value as CanonicalMemoryRecord);
    else if (head.object_kind !== "bank") result.derived.push(value as CanonicalDerivedMemory);
    const artifact = primary ?? context.bound(head);
    result.mappings.push({ localBankId: bank.bankId, kind: head.object_kind, localId: logicalId, native: head.version,
      semanticHash: transitionSemanticHash(value), application: artifact ? { key: artifact.key, revision: artifact.revision, record_hash: artifact.record_hash } : null,
      applicationBodyHash: artifact?.body_ref.bytes_sha256 ?? null, origin: primary || originalId(body, input) ? "original"
        : input.previous?.some((row) => row.kind === head.object_kind && row.native.object_id === head.object_id) ? "baseline" : "native-derived" });
  }
  const sourceState = projectTransitionSourceState(input, context, { output: result, ids });
  return { ...result, sourceAliases: sourceState.aliases, sourceSets: sourceState.sets };
}
type ProjectionContext = TransitionProjectionContext;
function physicalSourceArtifact(input: LocalBankProjectionInput, context: ProjectionContext,
  target: { head: TakiApplicationNativeHead; logicalId: string }) {
  const latest = new Map<string, (typeof context.artifacts extends Map<string, infer T> ? T : never)>();
  for (const artifact of context.artifacts.values()) {
    if (artifact.key.artifact_kind !== "source") continue;
    const key = JSON.stringify(artifact.key); const old = latest.get(key);
    if (!old || old.revision < artifact.revision) latest.set(key, artifact);
  }
  const candidates = [];
  for (const artifact of latest.values()) {
    if (artifact.tombstoned || artifact.binding.kind !== "exact_native"
      || artifact.binding.native.object_id !== target.head.object_id) continue;
    const body = context.reader.body(artifact.body_ref).content;
    if (body.body_schema === "application-source.v1" && originalId(body, input) === target.logicalId) candidates.push({ artifact, source: body.value.original_source });
  }
  if (new Set(candidates.map((row) => transitionSemanticHash(row.source))).size > 1) invalid();
  return candidates.sort((left, right) => JSON.stringify(left.artifact.key).localeCompare(JSON.stringify(right.artifact.key), "en"))[0]?.artifact ?? null;
}
function resolveIds(input: LocalBankProjectionInput, context: ProjectionContext): Map<string, string> {
  const ids = new Map<string, string>(); const unique = new Set<string>();
  for (const head of context.heads) {
    const body = context.body(head);
    const previous = input.previous?.find((row) => row.kind === head.object_kind && row.native.object_id === head.object_id);
    const original = head.object_kind === "document" ? originalDocumentId(input, context, head) : originalId(body, input);
    if (original && previous && previous.localId !== original && head.object_kind !== "document") invalid();
    const id = head.object_kind === "bank" ? input.scope.localBankId : previous?.localId ?? original
      ?? stableDerivedId([input.namespace.provider_lineage, input.scope.nativeBankId, input.scope.nativeGeneration, head.object_kind, head.object_id]);
    const key = transitionObjectKey(head.object_kind, id);
    if (unique.has(key)) invalid(); unique.add(key);
    ids.set(transitionObjectKey(head.object_kind, head.object_id), id);
  }
  return ids;
}
function originalDocumentId(input: LocalBankProjectionInput, context: ProjectionContext, head: TakiApplicationNativeHead): string | null {
  const candidates = new Set<string>();
  for (const artifact of context.artifacts.values()) {
    if (artifact.key.artifact_kind !== "source" || artifact.binding.kind !== "exact_native"
      || artifact.binding.native.object_id !== head.object_id) continue;
    const { source, evidenceOnly } = readHindsightApplicationSourceArtifact({ bankId: input.scope.nativeBankId,
      namespace: input.namespace, artifact, evidence: context.reader });
    // Only original physical Source evidence can establish the historical document ID. A later
    // evidence-only alias uses that physical mapping but never becomes the document's identity.
    if (evidenceOnly || source.original_witness?.source_kind !== "document") continue;
    const id = originalId({ body_schema: "application-source.v1", value: source }, input);
    if (id) candidates.add(id);
  }
  if (candidates.size > 1) invalid();
  return candidates.values().next().value ?? originalId(context.body(head), input);
}
export function originalId(body: TakiApplicationBodyContent | null, input: Pick<LocalBankProjectionInput, "scope" | "localEpochIds" | "previous">): string | null {
  const original = body?.body_schema === "application-source.v1" ? body.value.original_source
    : body?.body_schema === "application-memory.v1" ? body.value.original_record?.unit
      : body?.body_schema === "application-bank.v1" ? body.value.original_bank : null;
  if (!original) return null;
  const kind = "memoryId" in original ? "memory_unit" : "documentId" in original ? "document" : "bank";
  const id = "memoryId" in original ? original.memoryId : "documentId" in original ? original.documentId : original.bankId;
  // Provider-created Source bodies also contain original_source, using native/Hindsight identities.
  // Only the verified Local Bank/epoch or an exact durable prior Local mapping can adopt an original logical ID.
  if (original.bankId !== input.scope.localBankId) {
    if (original.authorityEpochId === input.scope.originEpochId || input.localEpochIds?.includes(original.authorityEpochId)) invalid();
    return null;
  }
  return original.authorityEpochId === input.scope.originEpochId
    || input.localEpochIds?.includes(original.authorityEpochId)
    || input.previous?.some((row) => row.kind === kind && row.localId === id) ? id : null;
}
export function stableDerivedId(identity: string[]): string {
  const bytes = createHash("sha256").update(JSON.stringify(["taki-transition-local-object.v1", identity])).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 15) | 80; bytes[8] = ((bytes[8] ?? 0) & 63) | 128;
  const hex = bytes.toString("hex"); return `${hex.slice(0, 8)}-${hex.slice(8, 10)}${hex.slice(10, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
type ValueInput = { input: LocalBankProjectionInput; head: TakiApplicationNativeHead;
  projected: ReturnType<typeof projectHindsightApplicationRecord>; body: TakiApplicationBodyContent | null;
  projectionInput: Parameters<typeof projectHindsightApplicationRecord>[0]; context: ProjectionContext;
  logicalId: string; ids: Map<string, string>; bank: CanonicalMemoryBank; initialPolicies: MemoryTransitionLocalState["history"] };
function projectValue(value: ValueInput): CanonicalMemoryBank | CanonicalMemorySource | CanonicalMemoryRecord | CanonicalDerivedMemory {
  if (value.head.object_kind === "bank") return value.bank;
  if (value.head.object_kind === "document") return projectSource(value);
  if (value.head.object_kind === "memory_unit") return projectMemory(value);
  const payload = value.projected.status === "projected" ? value.projected.record.payload : null;
  if (!payload || payload.kind !== "mental_model" && payload.kind !== "directive") invalid();
  return HindsightCurrentCanonicalDerivedSchema.parse({ ...payload.value, authorityEpochId: value.input.epochId,
    bankId: value.bank.bankId, payload: { ...payload.value.payload, bankId: value.bank.bankId,
      [payload.kind === "mental_model" ? "mentalModelId" : "directiveId"]: value.logicalId } });
}
function projectSource(value: ValueInput): CanonicalMemorySource {
  const payload = value.projected.status === "projected" ? value.projected.record.payload : null;
  let source: CanonicalMemorySource;
  const original = value.body?.body_schema === "application-source.v1" && originalId(value.body, value.input) === value.logicalId ? value.body.value.original_source : null;
  if (payload?.kind === "document") source = payload.value;
  else {
    if (value.head.bound_artifact || value.head.binding_state !== "binding_missing") invalid();
    const native = readHindsightApplicationNative(value.projectionInput);
    const ref = native.source_evidence_ref;
    const evidence = ref && value.context.reader.body(ref).content;
    if (!evidence || evidence.body_schema !== "application-native-source.v1") invalid();
    const fields = camel(native.payload);
    source = HindsightCurrentCanonicalSourceSchema.parse({ ...fields, authorityEpochId: value.input.epochId,
      revision: native.version.object_revision, retainedText: evidence.value.original_text, context: evidence.value.context,
      provenance: { actor: "provider", origin: "provider-derived", characterId: value.bank.scope.characterId,
        timelineFromSeq: null, timelineToSeq: null, capturedAt: value.input.createdAt, sanitized: true,
        sourceRef: `hindsight:${value.input.scope.nativeGeneration}:document:${value.head.object_id}` } });
  }
  const exact = original && transitionLocalHash(source.provenance) === transitionLocalHash(original.provenance)
    && source.retainedText === original.retainedText && source.context === original.context
    && transitionLocalHash([source.tags, source.metadata, source.observationScopes, source.createdAt, source.updatedAt])
      === transitionLocalHash([original.tags, original.metadata, original.observationScopes, original.createdAt, original.updatedAt]);
  return HindsightCurrentCanonicalSourceSchema.parse({ ...source, authorityEpochId: value.input.epochId,
    bankId: value.bank.bankId, documentId: value.logicalId,
    revision: exact ? original.revision : Math.max(source.revision, (original?.revision ?? 0) + 1),
    contentHash: exact ? original.contentHash : source.contentHash });
}
function projectMemory(value: ValueInput): CanonicalMemoryRecord {
  const payload = value.projected.status === "projected" ? value.projected.record.payload : null;
  let record: CanonicalMemoryRecord;
  if (payload?.kind === "memory_unit") record = payload.value;
  else {
    if (value.head.bound_artifact || value.head.binding_state !== "binding_missing") invalid();
    if (!value.input.healthyProof) {
      const saved = value.input.survivingPolicies?.get(value.head.object_id);
      if (!saved || saved.record.unit.memoryId !== value.logicalId || saved.record.unit.bankId !== value.bank.bankId) invalid();
      value.initialPolicies.push(saved.history);
      // This is an already committed Canonical record. Preserve logical references, Local revisions and timestamps;
      // sending it through the Native-ID translation below would corrupt a valid historical representation.
      return HindsightCurrentCanonicalRecordSchema.parse({ ...saved.record,
        unit: { ...saved.record.unit, authorityEpochId: value.input.epochId, bankId: value.bank.bankId },
        policy: { ...saved.record.policy, authorityEpochId: value.input.epochId, bankId: value.bank.bankId } });
    }
    const native = readHindsightApplicationNative(value.projectionInput);
    const unit = projectHindsightApplicationNativeUnit({ ...value.projectionInput, native });
    const proof = value.input.healthyProof;
    const address = { namespace: proof.application_snapshot.namespace, bankId: proof.bank_id, native: native.version };
    const body = initializeHindsightTransitionPolicy({ proof,
      context: { ...address, authorityEpochId: value.input.epochId, bank: { ...value.bank, bankId: proof.bank_id },
        activeCharacterId: value.bank.scope.characterId, native: { ...address, status: "verified", unit } },
      state: { ...address, status: "authenticated-absence" }, initial: { stamp: { policyVersion: 1, updatedAt: value.input.createdAt },
        evidence: { kind: "provider-derived", observedAt: value.input.createdAt } } });
    record = { unit: { ...unit, tags: projectHindsightPolicyLayerTags(unit.tags, body.policy) }, policy: body.policy, provenance: body.provenance };
    value.initialPolicies.push({ table: "transition_initial_policy", rowJson: JSON.stringify({ proofHash: proof.proof_hash,
      native: native.version, logicalMemoryId: value.logicalId, localBankId: value.bank.bankId, body }) });
  }
  const translate = (kind: string, id: string) => {
    const translated = value.ids.get(transitionObjectKey(kind, id)); if (!translated) invalid(); return translated;
  };
  const original = value.body?.body_schema === "application-memory.v1" && originalId(value.body, value.input) ? value.body.value.original_record : null;
  const unit = { ...record.unit, authorityEpochId: value.input.epochId, bankId: value.bank.bankId, memoryId: value.logicalId,
    documentId: record.unit.documentId === null ? null : translate("document", record.unit.documentId),
    sourceMemoryIds: record.unit.sourceMemoryIds.map((id) => translate("memory_unit", id)).sort() };
  // Logical Local revisions have their own history. Native revisions remain separately recorded in the mapping.
  if (original && sameUnitContent(unit, original.unit)) {
    unit.revision = original.unit.revision;
  }
  else if (original) unit.revision = Math.max(unit.revision, original.unit.revision + 1);
  if (original) preserveTransitionLocalTimestamps({ unit, original: original.unit,
    before: value.input.nativeBaseline?.evidence.nativePages.flatMap((page) => page.records).find((row) => row.object_kind === "memory_unit" && row.object_id === value.head.object_id),
    final: value.input.nativeRecords.find((row) => row.object_kind === "memory_unit" && row.object_id === value.head.object_id),
    reused: value.input.nativeBaseline?.reusedMemoryIds.includes(value.head.object_id) ?? false });
  return HindsightCurrentCanonicalRecordSchema.parse({ ...record, unit,
    policy: { ...record.policy, authorityEpochId: value.input.epochId, bankId: value.bank.bankId, memoryId: value.logicalId } });
}
function sameUnitContent(left: CanonicalMemoryRecord["unit"], right: CanonicalMemoryRecord["unit"]): boolean {
  const strip = (unit: CanonicalMemoryRecord["unit"]) => Object.fromEntries(Object.entries(unit)
    .filter(([key]) => !["authorityEpochId", "bankId", "revision", "updatedAt", "editedAt"].includes(key)));
  return transitionLocalHash(strip(left)) === transitionLocalHash(strip(right));
}
function camel(value: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), item]));
}
function verifyProjectionBaseline(input: Parameters<typeof projectTransitionLocalBank>[0],
  proof: NonNullable<MemoryTransitionNativeEvidence["status"]["proof"]>): void {
  if (!input.nativeBaseline) return;
  const previous = input.nativeBaseline.evidence;
  if (input.verification) input.verification.bundle(previous); else verifyTransitionNativeEvidence(previous);
  if (previous.status.bank_id !== proof.bank_id || previous.status.request.provider_lineage !== proof.provider_lineage
    || previous.status.request.bank_generation !== proof.bank_generation) invalid();
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
