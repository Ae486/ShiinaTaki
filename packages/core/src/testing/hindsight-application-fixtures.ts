/**
 * INPUT:  synthetic native payloads, immutable application artifacts and desired test checkpoints
 * OUTPUT: complete hash-consistent D77 bundles/events and V1 baseline manifest fixtures
 * POS:    core/testing — deterministic fixtures only; never used to establish production authority or provider proof
 */
import { randomUUID } from "node:crypto";
import {
  type TakiApplicationArtifact, type TakiApplicationArtifactKey, type TakiApplicationBinding,
  type TakiApplicationBodySchema, type TakiApplicationCheckpoint, type TakiApplicationNativePayload,
  type TakiApplicationNativeHead, type TakiApplicationNativeVersion, type TakiApplicationRecordDescriptor,
  type TakiApplicationRecordPage, type TakiApplicationStateChangeManifest, type HindsightLogicalSnapshotMetadata,
  type TakiApplicationMemoryBody,
} from "@taki/shared";
import { prepareHindsightApplicationBody } from "../memory/hindsight/hindsight-application-body-transfer.ts";
import { hindsightApplicationHash, hindsightApplicationNativeHash, withoutApplicationHash,
  type HindsightApplicationBody, type HindsightApplicationScope } from "../memory/hindsight/hindsight-application-integrity.ts";
import type { HindsightApplicationBundle, HindsightApplicationEvent } from "../memory/hindsight/hindsight-application-bundle.ts";
import { snapshotManifestHash } from "../memory/hindsight/hindsight-snapshot-validator.ts";

export const APPLICATION_TEST_AT = "2026-09-11T08:00:00.000Z";
export const APPLICATION_TEST_SCOPE: HindsightApplicationScope = { bankId: "bank-a", namespace: {
  provider_lineage: "11111111-1111-4111-8111-111111111111",
  bank_generation: "22222222-2222-4222-8222-222222222222", application_id: "taki",
} };
export interface ApplicationNativeFixture { head: TakiApplicationNativeHead; body: HindsightApplicationBody; bodies: HindsightApplicationBody[] }
export interface ApplicationArtifactFixture { artifact: TakiApplicationArtifact; body: HindsightApplicationBody }

export function applicationTestBody(schema: TakiApplicationBodySchema, value: unknown, scope = APPLICATION_TEST_SCOPE): HindsightApplicationBody {
  return prepareHindsightApplicationBody({ ...scope, schema, value });
}

export function applicationTestBankPayload(scope = APPLICATION_TEST_SCOPE): TakiApplicationNativePayload {
  return { bank_id: scope.bankId, name: "Fixture Bank", disposition: { skepticism: 3, literalism: 3, empathy: 3 },
    mission: "", config: {}, created_at: APPLICATION_TEST_AT, updated_at: APPLICATION_TEST_AT };
}
export function applicationTestSourcePayload(scope = APPLICATION_TEST_SCOPE): TakiApplicationNativePayload {
  return { bank_id: scope.bankId, document_id: "document-a", content_hash: null, tags: [], metadata: {},
    observation_scopes: "shared", created_at: APPLICATION_TEST_AT, updated_at: APPLICATION_TEST_AT };
}
export function applicationTestMemoryPayload(overrides: Partial<Extract<TakiApplicationNativePayload, { memory_id: string }>> = {}):
Extract<TakiApplicationNativePayload, { memory_id: string }> {
  return { bank_id: APPLICATION_TEST_SCOPE.bankId, memory_id: "memory-a", document_id: "document-a", chunk_id: null,
    text: "A verified fixture fact", context: null, fact_type: "world", state: "valid", revision: 1,
    tags: [], metadata: {}, entities: [], source_memory_ids: [], observation_scopes: "shared",
    event_date: null, occurred_start: null, occurred_end: null, mentioned_at: null,
    created_at: APPLICATION_TEST_AT, updated_at: APPLICATION_TEST_AT, edited_at: null, consolidated_at: null,
    consolidation_failed_at: null, invalidation_reason: null, invalidated_at: null, proof_count: 1, ...overrides };
}

export function applicationTestNative(input: {
  payload: TakiApplicationNativePayload; kind: TakiApplicationNativeVersion["object_kind"];
  scope?: HindsightApplicationScope; revision?: number; cursor?: number | null;
  bindingState?: TakiApplicationNativeHead["binding_state"]; boundArtifact?: TakiApplicationArtifact;
  source?: { text: string | null; context: string | null; metadata: Record<string, unknown> };
}): ApplicationNativeFixture {
  const scope = input.scope ?? APPLICATION_TEST_SCOPE;
  const keys = { bank: "bank_id", document: "document_id", memory_unit: "memory_id", mental_model: "mental_model_id", directive: "directive_id" };
  const objectId = (input.payload as Record<string, unknown>)[keys[input.kind]];
  if (typeof objectId !== "string") throw new Error("invalid test payload");
  const version: TakiApplicationNativeVersion = { object_kind: input.kind, object_id: objectId,
    object_revision: input.revision ?? ("revision" in input.payload ? input.payload.revision : 1),
    payload_hash: hindsightApplicationNativeHash(input.payload), native_cursor: input.cursor ?? null };
  const bodies: HindsightApplicationBody[] = [];
  if (input.kind === "document") {
    const source = { document_version: version, original_text: input.source?.text ?? null, context: input.source?.context ?? null,
      source_metadata: input.source?.metadata ?? {}, availability: input.source?.text == null ? "unavailable" : "available", source_evidence_hash: "" };
    source.source_evidence_hash = hindsightApplicationHash({ ...scope, domain: "source-evidence", value: withoutApplicationHash(source, "source_evidence_hash") });
    bodies.push(applicationTestBody("application-native-source.v1", source, scope));
  }
  const body = applicationTestBody("application-native-record.v1", {
    version, payload: input.payload, source_evidence_ref: bodies[0]?.ref ?? null,
  }, scope);
  bodies.push(body);
  const bound = input.boundArtifact;
  return { body, bodies, head: { object_kind: input.kind, object_id: objectId, version, tombstone: null, body_ref: body.ref,
    binding_state: input.bindingState ?? (bound ? "bound" : "binding_missing"), bound_artifact: bound ? {
      key: bound.key, revision: bound.revision, record_hash: bound.record_hash } : null, previous_version: null, cause: "baseline" } };
}

export function applicationTestArtifact(input: {
  key: TakiApplicationArtifactKey; body: HindsightApplicationBody; binding: TakiApplicationBinding;
  revision?: number; scope?: HindsightApplicationScope; tombstoned?: boolean;
}): ApplicationArtifactFixture {
  const scope = input.scope ?? APPLICATION_TEST_SCOPE;
  const artifact: TakiApplicationArtifact = { namespace: scope.namespace, bank_id: scope.bankId,
    key: input.key, revision: input.revision ?? 1, body_ref: input.body.ref, binding: input.binding,
    tombstoned: input.tombstoned ?? false, created_at: APPLICATION_TEST_AT, updated_at: APPLICATION_TEST_AT, record_hash: "" };
  artifact.record_hash = hindsightApplicationHash({ ...scope, domain: "record", value: withoutApplicationHash(artifact, "record_hash") });
  return { artifact, body: input.body };
}

export function applicationTestMemoryBody(version: TakiApplicationNativeVersion, overrides: Partial<TakiApplicationMemoryBody> = {}): TakiApplicationMemoryBody {
  return { policy_basis: "neutral", policy: { authorityEpochId: "epoch", bankId: APPLICATION_TEST_SCOPE.bankId,
    memoryId: version.object_id, layerId: "unclassified", importance: 5, visibility: "retrieved", disclosure: null,
    origin: "observed", emotionalWeight: null, retention: { kind: "permanent" }, policyVersion: 1, updatedAt: APPLICATION_TEST_AT },
  assessment: { state: "due", target: version, attempts: 0, next_attempt_at: null, last_failure_code: null,
    prompt_version: null, prompt_hash: null, completed_at: null }, provenance: { actor: "provider", origin: "provider-derived",
    characterId: null, timelineFromSeq: null, timelineToSeq: null, capturedAt: APPLICATION_TEST_AT, sanitized: true,
    sourceRef: `hindsight:${version.object_id}` }, source_artifacts: [], original_record: null, encoded_metadata: null, ...overrides };
}

interface ApplicationFixtureRecords {
  native?: ApplicationNativeFixture[];
  artifacts?: ApplicationArtifactFixture[];
  extraBodies?: HindsightApplicationBody[];
  extraRecords?: TakiApplicationRecordDescriptor[];
  scope?: HindsightApplicationScope;
  pageSize?: number;
}

export function applicationTestSnapshot(input: ApplicationFixtureRecords & {
  checkpoint?: TakiApplicationCheckpoint; kind?: "snapshot" | "hydrate";
} = {}): HindsightApplicationBundle {
  const scope = input.scope ?? APPLICATION_TEST_SCOPE;
  const pages = fixturePages(input); const now = Date.now();
  const manifest = { contract_version: "1.0.0" as const, snapshot_id: randomUUID(), request_id: randomUUID(),
    namespace: scope.namespace, bank_id: scope.bankId, kind: input.kind ?? "snapshot",
    checkpoint: input.checkpoint ?? { native_cursor: fixtureNativeCursor(input), state_cursor: 0 },
    native_schema_version: 1 as const, application_schema_version: 1 as const,
    total_records: pages.reduce((sum, page) => sum + page.records.length, 0), total_pages: pages.length,
    pages_hash: hindsightApplicationHash({ ...scope, domain: "pages", value: pages.map((page) => page.page_hash) }),
    manifest_hash: "", created_at: new Date(now).toISOString(), expires_at: new Date(now + 3_600_000).toISOString() };
  manifest.manifest_hash = hindsightApplicationHash({ ...scope, domain: "snapshot", value: withoutApplicationHash(manifest, "manifest_hash") });
  return { manifest, pages, bodies: fixtureBodies(input) };
}

export function applicationTestEvent(input: ApplicationFixtureRecords & {
  from: TakiApplicationCheckpoint; to?: TakiApplicationCheckpoint; bankDeleted?: boolean;
}): HindsightApplicationEvent {
  const scope = input.scope ?? APPLICATION_TEST_SCOPE; const pages = fixturePages(input);
  const to = input.to ?? { native_cursor: Math.max(input.from.native_cursor, fixtureNativeCursor(input)), state_cursor: input.from.state_cursor + 1 };
  const manifest: TakiApplicationStateChangeManifest = { namespace: scope.namespace, bank_id: scope.bankId,
    state_cursor: to.state_cursor, from_checkpoint: input.from, to_checkpoint: to,
    native_batches: to.native_cursor === input.from.native_cursor ? [] : [{ batch_id: randomUUID(),
      first_cursor: input.from.native_cursor + 1, last_cursor: to.native_cursor, size: to.native_cursor - input.from.native_cursor }],
    total_records: pages.reduce((sum, page) => sum + page.records.length, 0), total_pages: pages.length,
    pages_hash: hindsightApplicationHash({ ...scope, domain: "pages", value: pages.map((page) => page.page_hash) }),
    event_hash: "", bank_deleted: input.bankDeleted ?? false, created_at: new Date().toISOString() };
  manifest.event_hash = hindsightApplicationHash({ ...scope, domain: "event", value: withoutApplicationHash(manifest, "event_hash") });
  return { manifest, pages, bodies: fixtureBodies(input) };
}

export function applicationTestNativeBaseline(bundle: HindsightApplicationBundle): HindsightLogicalSnapshotMetadata {
  const heads = bundle.pages.flatMap((page) => page.records).filter((record): record is Extract<TakiApplicationRecordDescriptor, { kind: "native" }> =>
    record.kind === "native" && record.head.version !== null);
  const counts = { bank: 0, document: 0, memoryUnit: { valid: 0, invalidated: 0 }, mentalModel: 0, directive: 0, total: heads.length };
  for (const { head } of heads) {
    if (head.object_kind === "memory_unit") {
      const payload = head.body_ref ? bundle.bodies.get(head.body_ref.body_id)?.content : undefined;
      if (payload?.body_schema !== "application-native-record.v1" || !("state" in payload.value.payload)) throw new Error("invalid test memory");
      counts.memoryUnit[payload.value.payload.state]++;
    } else if (head.object_kind === "mental_model") counts.mentalModel++;
    else counts[head.object_kind]++;
  }
  const manifest = bundle.manifest;
  const result: HindsightLogicalSnapshotMetadata = { snapshotId: randomUUID(), createdAt: manifest.created_at, expiresAt: manifest.expires_at,
    manifest: { schemaVersion: 1, bankId: manifest.bank_id, providerLineage: manifest.namespace.provider_lineage,
      bankGeneration: manifest.namespace.bank_generation, endCursor: manifest.checkpoint.native_cursor, pageSize: 1,
      totalPages: heads.length, totalRecords: heads.length, counts,
      pageHashes: heads.map((record) => hindsightApplicationNativeHash(record.head)), manifestDigest: "" } };
  result.manifest.manifestDigest = snapshotManifestHash(result);
  return result;
}

function fixturePages(input: ApplicationFixtureRecords): TakiApplicationRecordPage[] {
  const scope = input.scope ?? APPLICATION_TEST_SCOPE; const size = input.pageSize ?? 100;
  const records: TakiApplicationRecordDescriptor[] = [
    ...(input.native ?? []).map((node) => ({ kind: "native" as const, head: node.head })),
    ...(input.artifacts ?? []).map((value) => ({ kind: "artifact" as const, artifact: value.artifact })), ...(input.extraRecords ?? []),
  ];
  const pages: TakiApplicationRecordPage[] = [];
  for (let offset = 0; offset < records.length; offset += size) {
    const page = { namespace: scope.namespace, bank_id: scope.bankId, page_number: pages.length,
      records: records.slice(offset, offset + size), page_hash: "" };
    page.page_hash = hindsightApplicationHash({ ...scope, domain: "page", value: withoutApplicationHash(page, "page_hash") });
    pages.push(page);
  }
  return pages;
}
function fixtureBodies(input: ApplicationFixtureRecords): Map<string, HindsightApplicationBody> {
  const bodies = [...(input.native ?? []).flatMap((node) => node.bodies), ...(input.artifacts ?? []).map((item) => item.body), ...(input.extraBodies ?? [])];
  return new Map(bodies.map((body) => [body.ref.body_id, body]));
}
function fixtureNativeCursor(input: ApplicationFixtureRecords): number {
  return (input.native ?? []).reduce((cursor, node) => Math.max(cursor, node.head.version?.native_cursor ?? 0, node.head.tombstone?.native_cursor ?? 0), 0);
}
