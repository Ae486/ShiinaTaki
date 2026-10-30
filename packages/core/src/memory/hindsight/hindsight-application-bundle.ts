/**
 * INPUT:  complete joint snapshot/event descriptor pages and their immutable byte bodies
 * OUTPUT: verified namespace, hashes, native identities and recovery-closure relationships
 * POS:    core/memory/hindsight — synchronous proof boundary before the SQLite application replica transaction
 */
import {
  TakiApplicationReadBundleManifestSchema, TakiApplicationRecordPageSchema, TakiApplicationStateChangeManifestSchema,
  type TakiApplicationReadBundleManifest, type TakiApplicationRecordPage, type TakiApplicationStateChangeManifest,
  type TakiApplicationRecordDescriptor, type TakiApplicationNativeHead, type TakiApplicationArtifact,
  type TakiApplicationArtifactVersion, type TakiApplicationBodyRef,
  HindsightLogicalSnapshotMetadataSchema, type HindsightLogicalSnapshotMetadata,
} from "@taki/shared";
import { snapshotManifestHash } from "./hindsight-snapshot-validator.ts";
import {
  hindsightApplicationHash, requireApplicationScope, sameApplicationValue, verifyHindsightApplicationBody,
  withoutApplicationHash, type HindsightApplicationBody, type HindsightApplicationScope,
} from "./hindsight-application-integrity.ts";

export type { HindsightApplicationBody } from "./hindsight-application-integrity.ts";
export interface HindsightApplicationBundle {
  manifest: TakiApplicationReadBundleManifest;
  pages: TakiApplicationRecordPage[];
  bodies: Map<string, HindsightApplicationBody>;
}
export interface HindsightApplicationEvent {
  manifest: TakiApplicationStateChangeManifest;
  pages: TakiApplicationRecordPage[];
  bodies: Map<string, HindsightApplicationBody>;
}
interface Closure {
  records: TakiApplicationRecordDescriptor[];
  bodies: Map<string, HindsightApplicationBody>;
  artifacts: Map<string, TakiApplicationArtifact>;
  full: boolean;
}

export function verifyHindsightApplicationBundle(bundle: HindsightApplicationBundle, scope: HindsightApplicationScope): void {
  const manifest = TakiApplicationReadBundleManifestSchema.parse(bundle.manifest);
  requireApplicationScope(manifest, scope);
  if (hindsightApplicationHash({ ...scope, domain: "snapshot", value: withoutApplicationHash(manifest, "manifest_hash") })
    !== manifest.manifest_hash || Date.parse(manifest.expires_at) <= Date.parse(manifest.created_at)) invalid();
  const records = verifyPages({ ...bundle, manifest }, scope);
  if (manifest.kind === "snapshot" && records.some((record) => record.kind === "selector")) invalid();
  const artifacts = artifactsFrom(records);
  verifyArtifactHistory(artifacts);
  verifyClosure({ records, bodies: bundle.bodies, artifacts, full: true }, scope);
}

export function verifyHindsightApplicationEvent(event: HindsightApplicationEvent, scope: HindsightApplicationScope): void {
  const manifest = TakiApplicationStateChangeManifestSchema.parse(event.manifest);
  requireApplicationScope(manifest, scope);
  if (hindsightApplicationHash({ ...scope, domain: "event", value: withoutApplicationHash(manifest, "event_hash") }) !== manifest.event_hash) invalid();
  if (manifest.state_cursor !== manifest.to_checkpoint.state_cursor || manifest.state_cursor !== manifest.from_checkpoint.state_cursor + 1
    || manifest.to_checkpoint.native_cursor < manifest.from_checkpoint.native_cursor) invalid();
  let cursor = manifest.from_checkpoint.native_cursor;
  for (const batch of manifest.native_batches) {
    if (batch.first_cursor !== cursor + 1 || batch.last_cursor !== batch.first_cursor + batch.size - 1) invalid();
    cursor = batch.last_cursor;
  }
  if (cursor !== manifest.to_checkpoint.native_cursor) invalid();
  const records = verifyPages({ ...event, manifest }, scope);
  if (records.some((record) => record.kind === "selector")) invalid();
  if (manifest.bank_deleted && !records.some((record) => record.kind === "native" && record.head.object_kind === "bank"
    && record.head.object_id === scope.bankId && record.head.binding_state === "tombstoned")) invalid();
  // Historical artifact dependencies omitted from a delta must resolve against
  // the replica's verified predecessor inside its publication transaction.
  verifyClosure({ records, bodies: event.bodies, artifacts: artifactsFrom(records), full: false }, scope);
}

function verifyPages(input: {
  pages: TakiApplicationRecordPage[];
  manifest: Pick<TakiApplicationReadBundleManifest, "total_pages" | "total_records" | "pages_hash">;
}, scope: HindsightApplicationScope): TakiApplicationRecordDescriptor[] {
  if (input.pages.length !== input.manifest.total_pages) invalid();
  const records: TakiApplicationRecordDescriptor[] = [];
  for (const [index, raw] of input.pages.entries()) {
    const page = TakiApplicationRecordPageSchema.parse(raw);
    requireApplicationScope(page, scope);
    if (page.page_number !== index || hindsightApplicationHash({ ...scope, domain: "page",
      value: withoutApplicationHash(page, "page_hash") }) !== page.page_hash) invalid();
    for (const record of page.records) records.push(record);
  }
  if (records.length !== input.manifest.total_records || hindsightApplicationHash({ ...scope, domain: "pages",
    value: input.pages.map((page) => page.page_hash) }) !== input.manifest.pages_hash) invalid();
  const nativeKeys = records.filter((record) => record.kind === "native").map((record) =>
    JSON.stringify([record.head.object_kind, record.head.object_id]));
  if (new Set(nativeKeys).size !== nativeKeys.length) invalid();
  return records;
}

function artifactsFrom(records: TakiApplicationRecordDescriptor[]): Map<string, TakiApplicationArtifact> {
  const artifacts = new Map<string, TakiApplicationArtifact>();
  for (const record of records) {
    if (record.kind !== "artifact") continue;
    const key = applicationArtifactVersionKey(record.artifact);
    if (artifacts.has(key)) invalid();
    artifacts.set(key, record.artifact);
  }
  return artifacts;
}

function verifyArtifactHistory(artifacts: Map<string, TakiApplicationArtifact>): void {
  const histories = new Map<string, number[]>();
  for (const artifact of artifacts.values()) {
    const key = JSON.stringify(artifact.key); const revisions = histories.get(key) ?? [];
    revisions.push(artifact.revision); histories.set(key, revisions);
  }
  for (const revisions of histories.values()) {
    revisions.sort((left, right) => left - right);
    if (revisions.some((revision, index) => revision !== index + 1)) invalid();
  }
}

export function applicationArtifactVersionKey(value: Pick<TakiApplicationArtifactVersion, "key" | "revision">): string {
  return JSON.stringify([value.key.artifact_kind, value.key.artifact_id, value.revision]);
}

function verifyClosure(closure: Closure, scope: HindsightApplicationScope): void {
  for (const [id, body] of closure.bodies) {
    if (id !== body.ref.body_id) invalid();
    verifyHindsightApplicationBody(body, scope);
  }
  for (const record of closure.records) {
    if (record.kind === "artifact") verifyArtifact(record.artifact, closure, scope);
    else if (record.kind === "native") verifyHead(record.head, closure);
  }
}

function requireBody(ref: TakiApplicationBodyRef, closure: Closure): HindsightApplicationBody {
  const body = closure.bodies.get(ref.body_id);
  if (!body || !sameApplicationValue(body.ref, ref)) invalid();
  return body;
}

function verifyHead(head: TakiApplicationNativeHead, closure: Closure): void {
  if (head.binding_state === "tombstoned") {
    if (head.version !== null || head.body_ref !== null || head.tombstone === null
      || head.tombstone.object_kind !== head.object_kind || head.tombstone.object_id !== head.object_id) invalid();
    return;
  }
  if (head.version === null || head.body_ref === null || head.tombstone !== null
    || head.version.object_kind !== head.object_kind || head.version.object_id !== head.object_id) invalid();
  const body = requireBody(head.body_ref, closure).content;
  if (body.body_schema !== "application-native-record.v1" || !sameApplicationValue(body.value.version, head.version)) invalid();
  if (body.value.source_evidence_ref !== null) {
    const source = requireBody(body.value.source_evidence_ref, closure).content;
    if (source.body_schema !== "application-native-source.v1" || !sameApplicationValue(source.value.document_version, head.version)) invalid();
  }
  if (head.bound_artifact === null) {
    if (head.binding_state === "bound" || head.binding_state === "rebind_required") invalid();
    return;
  }
  const artifact = requireArtifact(head.bound_artifact, closure);
  if (artifact && head.binding_state === "bound" && (artifact.tombstoned || artifact.binding.kind !== "exact_native"
    || !sameApplicationValue(artifact.binding.native, head.version))) invalid();
}

function verifyArtifact(artifact: TakiApplicationArtifact, closure: Closure, scope: HindsightApplicationScope): void {
  requireApplicationScope(artifact, scope);
  if (hindsightApplicationHash({ ...scope, domain: "record", value: withoutApplicationHash(artifact, "record_hash") }) !== artifact.record_hash) invalid();
  const body = requireBody(artifact.body_ref, closure).content;
  const kind = artifact.key.artifact_kind;
  if (body.body_schema !== `application-${kind}.v1`) invalid();
  if (kind === "block") {
    if (artifact.binding.kind !== "core_block") invalid();
  } else if (artifact.binding.kind === "exact_native") {
    const nativeKinds = { bank: "bank", source: "document", memory: "memory_unit" } as const;
    if (artifact.binding.native.object_kind !== nativeKinds[kind]
      || kind === "bank" && artifact.binding.native.object_id !== scope.bankId) invalid();
  } else if (kind !== "source" || artifact.binding.kind !== "awaiting_native") invalid();
  if (body.body_schema === "application-memory.v1") {
    if (artifact.binding.kind !== "exact_native" || !sameApplicationValue(body.value.assessment.target, artifact.binding.native)) invalid();
    for (const source of body.value.source_artifacts) {
      if (source.key.artifact_kind !== "source") invalid();
      requireArtifact(source, closure);
    }
  }
}

function requireArtifact(version: TakiApplicationArtifactVersion, closure: Closure): TakiApplicationArtifact | undefined {
  const artifact = closure.artifacts.get(applicationArtifactVersionKey(version));
  if (!artifact) { if (closure.full) invalid(); return; }
  if (artifact.record_hash !== version.record_hash) invalid();
  return artifact;
}
function invalid(): never { throw new Error("HINDSIGHT_APPLICATION_BUNDLE_INTEGRITY_ERROR"); }

export function verifyHindsightApplicationNativeBaseline(bundle: HindsightApplicationBundle, raw: HindsightLogicalSnapshotMetadata): void {
  const metadata = HindsightLogicalSnapshotMetadataSchema.parse(raw); const native = metadata.manifest;
  const joint = bundle.manifest;
  if (joint.kind !== "snapshot" || native.bankId !== joint.bank_id || native.providerLineage !== joint.namespace.provider_lineage
    || native.bankGeneration !== joint.namespace.bank_generation || native.endCursor !== joint.checkpoint.native_cursor
    || snapshotManifestHash(metadata) !== native.manifestDigest || Date.parse(metadata.expiresAt) <= Date.now()) invalid();
  const counts = { bank: 0, document: 0, memoryUnit: { valid: 0, invalidated: 0 }, mentalModel: 0, directive: 0, total: 0 };
  for (const page of bundle.pages) {
    for (const record of page.records) {
      if (record.kind !== "native" || record.head.version === null || record.head.body_ref === null) continue;
      const body = bundle.bodies.get(record.head.body_ref.body_id)?.content;
      if (!body || body.body_schema !== "application-native-record.v1") invalid();
      const kind = record.head.object_kind;
      if (kind === "memory_unit") {
        if (!("state" in body.value.payload)) invalid();
        counts.memoryUnit[body.value.payload.state]++;
      } else if (kind === "mental_model") counts.mentalModel++;
      else counts[kind]++;
      counts.total++;
    }
  }
  if (counts.total !== native.totalRecords || !sameApplicationValue(counts, native.counts)) invalid();
}
