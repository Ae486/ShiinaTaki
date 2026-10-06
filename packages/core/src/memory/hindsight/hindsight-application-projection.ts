/**
 * INPUT:  verified D77 native heads, exact artifact/body closure and trusted current Bank ownership
 * OUTPUT: complete Canonical consumer projections or explicit withheld binding state
 * POS:    core/memory/hindsight — originals stay immutable; native data and Taki policy keep separate authorities
 */
import { HindsightApplicationReplicaRecordSchema, HindsightCurrentCanonicalBankSchema,
  HindsightCurrentCanonicalRecordSchema, HindsightCurrentCanonicalSourceSchema, HindsightCurrentCanonicalUnitSchema, TakiApplicationJsonObjectSchema,
  type CanonicalMemoryBank, type CanonicalMemoryUnit, type HindsightApplicationReplicaRecord, type JsonValue, type MemoryBankScope,
  type TakiApplicationArtifact, type TakiApplicationArtifactVersion, type TakiApplicationBodyRef,
  type TakiApplicationNativeHead, type TakiApplicationNativeRecord, type TakiApplicationSourceBody } from "@taki/shared";
import { isSafeAutomaticMemoryText } from "../canonical-ingestion-source.ts";
import { resolveHindsightApplicationPolicy } from "./hindsight-application-policy.ts";
import { projectHindsightPolicyLayerTags } from "./hindsight-policy-admission.ts";
import { decodeHindsightApplicationBody, requireApplicationScope, sameApplicationValue, type HindsightApplicationBody,
  type HindsightApplicationScope } from "./hindsight-application-integrity.ts";
import { readHindsightApplicationSourceArtifact } from "./hindsight-application-source-evidence.ts";

export interface HindsightApplicationEvidenceReader {
  body(ref: TakiApplicationBodyRef): HindsightApplicationBody;
  artifact(version: TakiApplicationArtifactVersion): TakiApplicationArtifact;
}
export interface HindsightApplicationProjectionInput extends HindsightApplicationScope {
  authorityEpochId: string;
  bankScope: MemoryBankScope;
  bank: CanonicalMemoryBank | undefined;
  head: TakiApplicationNativeHead;
  evidence: HindsightApplicationEvidenceReader;
}
export type HindsightApplicationProjection = { status: "projected"; record: HindsightApplicationReplicaRecord }
  | { status: "withheld"; reason: TakiApplicationNativeHead["binding_state"] | "bank_unready" };

export function projectHindsightApplicationRecord(input: HindsightApplicationProjectionInput): HindsightApplicationProjection {
  const { head } = input;
  if (head.binding_state === "tombstoned") {
    if (!head.tombstone || head.tombstone.object_kind !== head.object_kind || head.tombstone.object_id !== head.object_id) invalid();
    return { status: "projected", record: HindsightApplicationReplicaRecordSchema.parse({ bankId: input.bankId,
      objectKind: head.object_kind, objectId: head.object_id, objectRevision: head.tombstone.object_revision,
      operation: "tombstone", payload: null }) };
  }
  const native = readHindsightApplicationNative(input);
  if (head.object_kind === "bank") return projectBank(input, native);
  if (!input.bank) return { status: "withheld", reason: "bank_unready" };
  if (head.object_kind === "mental_model" || head.object_kind === "directive") {
    return projected(input, { kind: head.object_kind, value: { authorityEpochId: input.authorityEpochId,
      bankId: input.bankId, objectRevision: native.version.object_revision,
      payload: { ...nativeCamelFields(native), kind: head.object_kind } } });
  }
  if (head.binding_state !== "bound") {
    if (head.object_kind === "document") return projectSource(input, { native, artifact: null, body: null });
    return { status: "withheld", reason: head.binding_state };
  }
  const artifact = boundArtifact(input);
  const body = input.evidence.body(artifact.body_ref).content;
  if (head.object_kind === "memory_unit" && body.body_schema === "application-memory.v1") {
    const unit = HindsightCurrentCanonicalUnitSchema.parse({ ...projectHindsightApplicationNativeUnit({ ...input, native }),
      metadata: restoreHindsightApplicationMetadata({ native: nativeMetadata(native),
        original: body.value.original_record?.unit.metadata ?? null, encoded: body.value.encoded_metadata }) });
    const policy = resolveHindsightApplicationPolicy({ context: { namespace: input.namespace, authorityEpochId: input.authorityEpochId,
      bank: input.bank, activeCharacterId: input.bankScope.characterId,
      native: { status: "verified", namespace: input.namespace, bankId: input.bankId, native: native.version, unit } },
    state: { status: "present", namespace: input.namespace, bankId: input.bankId, native: native.version,
      artifact: artifactVersion(artifact), body: body.value } });
    if (policy.kind !== "existing") invalid();
    const value = HindsightCurrentCanonicalRecordSchema.parse({ unit: { ...unit, tags: projectHindsightPolicyLayerTags(unit.tags, policy.policy) },
      policy: policy.policy, provenance: body.value.provenance });
    return projected(input, { kind: "memory_unit", value });
  }
  if (head.object_kind === "document") {
    const source = readHindsightApplicationSourceArtifact({ ...input, artifact });
    return projectSource(input, { native, artifact, body: source.source });
  }
  return invalid();
}

/** Only unchanged, explicitly witnessed encodings may recover original types; a JSON-looking native string stays a string. */
export function restoreHindsightApplicationMetadata(input: {
  native: unknown; original: Record<string, JsonValue> | null; encoded: Record<string, JsonValue> | null;
}): Record<string, JsonValue> {
  const native = TakiApplicationJsonObjectSchema.parse(input.native);
  return Object.fromEntries(Object.entries(native).map(([key, value]) => {
    const proven = input.original !== null && input.encoded !== null && Object.hasOwn(input.original, key)
      && Object.hasOwn(input.encoded, key) && sameApplicationValue(value, input.encoded[key]);
    const original = input.original?.[key];
    return [key, proven && original !== undefined ? original : value];
  }));
}

function projectBank(input: HindsightApplicationProjectionInput, native: TakiApplicationNativeRecord): HindsightApplicationProjection {
  if (input.head.binding_state !== "bound") return { status: "withheld", reason: input.head.binding_state };
  const artifact = boundArtifact(input); const body = input.evidence.body(artifact.body_ref).content;
  if (body.body_schema !== "application-bank.v1" || !sameApplicationValue(body.value.scope, input.bankScope)) invalid();
  const value = projectHindsightApplicationNativeBank({ ...input, native });
  return projected(input, { kind: "bank", value });
}

function projectSource(input: HindsightApplicationProjectionInput, source: {
  native: TakiApplicationNativeRecord; artifact: TakiApplicationArtifact | null; body: TakiApplicationSourceBody | null;
}): HindsightApplicationProjection {
  const ref = source.native.source_evidence_ref;
  const evidence = ref === null ? null : input.evidence.body(ref).content;
  if (evidence !== null && (evidence.body_schema !== "application-native-source.v1"
    || !sameApplicationValue(evidence.value.document_version, source.native.version))) invalid();
  const current = evidence?.body_schema === "application-native-source.v1" ? evidence.value : null;
  const text = current?.availability === "available" ? current.original_text : null;
  const context = current?.context ?? null;
  if (text !== null && text.trim() && !isSafeAutomaticMemoryText(text)
    || context !== null && context.trim() && !isSafeAutomaticMemoryText(context)) invalid();
  const original = source.body?.original_source;
  const proven = source.body && original && originalSourceStillExact({ native: source.native, body: source.body })
    && text === original.retainedText && context === original.context;
  const version = source.native.version;
  const provenance = proven ? original.provenance : { actor: "provider", origin: "provider-derived",
    characterId: input.bankScope.characterId, timelineFromSeq: null, timelineToSeq: null,
    capturedAt: source.artifact?.updated_at ?? String(nativeCamelFields(source.native).updatedAt), sanitized: true,
    sourceRef: `hindsight:${input.namespace.provider_lineage}:${input.namespace.bank_generation}:${version.object_kind}:${version.object_id}@${version.object_revision}` };
  const value = HindsightCurrentCanonicalSourceSchema.parse({ ...nativeCamelFields(source.native),
    authorityEpochId: input.authorityEpochId, revision: version.object_revision, retainedText: text, context, provenance,
    metadata: restoreHindsightApplicationMetadata({ native: nativeMetadata(source.native),
      original: original?.metadata ?? null, encoded: source.body?.encoded_metadata ?? null }) });
  return projected(input, { kind: "document", value });
}

function originalSourceStillExact(source: { native: TakiApplicationNativeRecord; body: TakiApplicationSourceBody }): boolean {
  const witness = source.body.original_witness; const version = source.native.version;
  return witness !== null && witness.source_kind === version.object_kind && witness.source_id === version.object_id
    && witness.source_revision === version.object_revision && witness.source_payload_hash === version.payload_hash;
}

/** Validates native bytes independently of policy readiness, including a Bank that still needs its first artifact. */
export function readHindsightApplicationNative(input: HindsightApplicationScope & {
  head: TakiApplicationNativeHead; evidence: HindsightApplicationEvidenceReader;
}): TakiApplicationNativeRecord {
  const { head } = input;
  if (!head.version || !head.body_ref || head.tombstone !== null) invalid();
  const evidence = input.evidence.body(head.body_ref);
  if (!sameApplicationValue(evidence.ref, head.body_ref)) invalid();
  const body = decodeHindsightApplicationBody({ ...input, ref: head.body_ref, bytes: evidence.bytes }).content;
  if (body.body_schema !== "application-native-record.v1" || !sameApplicationValue(body.value.version, head.version)
    || body.value.payload.bank_id !== input.bankId || head.version.object_kind !== head.object_kind
    || head.version.object_id !== head.object_id) invalid();
  return body.value;
}

/** Trusted routing supplies ownership; this shape alone is not evidence of a durably bound application Bank. */
export function projectHindsightApplicationNativeBank(input: HindsightApplicationScope & {
  authorityEpochId: string; bankScope: MemoryBankScope; native: TakiApplicationNativeRecord;
}): CanonicalMemoryBank {
  if (input.native.version.object_kind !== "bank" || input.native.version.object_id !== input.bankId
    || input.native.payload.bank_id !== input.bankId) invalid();
  return HindsightCurrentCanonicalBankSchema.parse({ ...nativeCamelFields(input.native), authorityEpochId: input.authorityEpochId,
    scope: input.bankScope, revision: input.native.version.object_revision });
}

/** Keeps native tags and metadata intact. Policy and typed-original restoration belong to the later bound projection. */
export function projectHindsightApplicationNativeUnit(input: HindsightApplicationScope & {
  authorityEpochId: string; native: TakiApplicationNativeRecord;
}): CanonicalMemoryUnit {
  if (input.native.version.object_kind !== "memory_unit" || input.native.payload.bank_id !== input.bankId) invalid();
  const unit = HindsightCurrentCanonicalUnitSchema.parse({ ...nativeCamelFields(input.native), authorityEpochId: input.authorityEpochId });
  if (unit.memoryId !== input.native.version.object_id || unit.revision !== input.native.version.object_revision) invalid();
  return unit;
}

function boundArtifact(input: HindsightApplicationProjectionInput): TakiApplicationArtifact {
  const { head } = input;
  if (!head.bound_artifact || !head.version) invalid();
  const artifact = input.evidence.artifact(head.bound_artifact);
  requireApplicationScope(artifact, input);
  if (artifact.tombstoned || artifact.binding.kind !== "exact_native"
    || !sameApplicationValue(artifact.binding.native, head.version)) invalid();
  return artifact;
}

function artifactVersion(artifact: TakiApplicationArtifact): TakiApplicationArtifactVersion {
  return { key: artifact.key, revision: artifact.revision, record_hash: artifact.record_hash };
}

function nativeCamelFields(native: TakiApplicationNativeRecord): Record<string, unknown> {
  const entries = Object.entries(native.payload).map(([key, value]) =>
    [key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()), value] as const);
  if (new Set(entries.map(([key]) => key)).size !== entries.length) invalid();
  return Object.fromEntries(entries);
}

function nativeMetadata(native: TakiApplicationNativeRecord): unknown {
  if (!("metadata" in native.payload)) invalid();
  return native.payload.metadata;
}

function projected(input: HindsightApplicationProjectionInput, payload: unknown): HindsightApplicationProjection {
  if (!input.head.version) invalid();
  return { status: "projected", record: HindsightApplicationReplicaRecordSchema.parse({ bankId: input.bankId,
    objectKind: input.head.object_kind, objectId: input.head.object_id, objectRevision: input.head.version.object_revision,
    operation: "upsert", payload }) };
}
function invalid(): never { throw new Error("HINDSIGHT_APPLICATION_PROJECTION_INVALID"); }
