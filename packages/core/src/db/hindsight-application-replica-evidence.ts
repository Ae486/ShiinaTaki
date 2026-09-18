/**
 * INPUT:  verified scoped D77 bodies, artifact versions and complete publication descriptors
 * OUTPUT: immutable evidence persistence and exact-reference reconstruction across restart
 * POS:    core/db — original bytes and historical associations survive native edits and Bank generation retirement
 */
import { TakiApplicationArtifactSchema, TakiApplicationBodyRefSchema, TakiApplicationRecordPageSchema,
  TakiApplicationReadBundleManifestSchema, TakiApplicationStateChangeManifestSchema,
  type TakiApplicationArtifact, type TakiApplicationArtifactKey, type TakiApplicationArtifactVersion,
  type TakiApplicationRecordPage } from "@taki/shared";
import { decodeHindsightApplicationBody, hindsightApplicationBytesHash, hindsightApplicationHash,
  requireApplicationScope, sameApplicationValue, withoutApplicationHash,
  type HindsightApplicationBody, type HindsightApplicationScope } from "../memory/hindsight/hindsight-application-integrity.ts";
import type { HindsightApplicationBundle, HindsightApplicationEvent } from "../memory/hindsight/hindsight-application-bundle.ts";
import { APPLICATION_SCOPE_WHERE, applicationArtifactKey, applicationScopeParams,
  applicationStoredBytes, parseApplicationStoredBytes } from "./hindsight-application-replica-codec.ts";
import type { HindsightApplicationEvidenceAccess } from "./hindsight-application-replica-contract.ts";
import type { Database, SqlRow } from "./sqlite.ts";

export function createApplicationEvidenceAccess(db: Database, scope: HindsightApplicationScope): HindsightApplicationEvidenceAccess {
  return {
    body: (ref) => {
      const body = readApplicationBody(db, { ...scope, bodyId: ref.body_id });
      if (!body || !sameApplicationValue(body.ref, ref)) missing();
      return body;
    },
    artifact: (version) => {
      const artifact = readApplicationArtifact(db, { ...scope, version });
      if (!artifact) missing();
      return artifact;
    },
  };
}

export function saveApplicationBody(db: Database, scope: HindsightApplicationScope, body: HindsightApplicationBody): void {
  const decoded = decodeHindsightApplicationBody({ ...scope, ref: body.ref, bytes: body.bytes });
  const previous = readApplicationBody(db, { ...scope, bodyId: body.ref.body_id });
  if (previous) {
    if (!sameApplicationValue(previous.ref, decoded.ref) || !sameApplicationValue(previous.content, decoded.content)) conflict();
    return;
  }
  db.prepare(`INSERT INTO hindsight_application_replica_bodies
    (provider_lineage,bank_generation,application_id,bank_id,body_id,body_schema,descriptor_json,body_bytes,total_bytes,bytes_sha256)
    VALUES (:lineage,:generation,:application,:bank,:id,:schema,:descriptor,:bytes,:size,:hash)`).run({ ...applicationScopeParams(scope),
    id: decoded.ref.body_id, schema: decoded.ref.body_schema, descriptor: JSON.stringify(decoded.ref), bytes: decoded.bytes,
    size: decoded.ref.total_bytes, hash: decoded.ref.bytes_sha256 });
}

export function readApplicationBody(db: Database, input: HindsightApplicationScope & { bodyId: string }): HindsightApplicationBody | undefined {
  const row = db.prepare(`SELECT * FROM hindsight_application_replica_bodies WHERE ${APPLICATION_SCOPE_WHERE} AND body_id=:id`)
    .get({ ...applicationScopeParams(input), id: input.bodyId });
  if (!row) return undefined;
  const ref = TakiApplicationBodyRefSchema.parse(JSON.parse(String(row.descriptor_json)));
  if (!(row.body_bytes instanceof Uint8Array) || ref.body_id !== input.bodyId || ref.body_schema !== row.body_schema
    || ref.total_bytes !== row.total_bytes || ref.bytes_sha256 !== row.bytes_sha256) invalid();
  return decodeHindsightApplicationBody({ ...input, ref, bytes: row.body_bytes });
}

export function saveApplicationArtifact(db: Database, scope: HindsightApplicationScope, raw: TakiApplicationArtifact): void {
  const artifact = TakiApplicationArtifactSchema.parse(raw);
  validateArtifactEnvelope(artifact, scope);
  const previous = readArtifactByKey(db, { ...scope, key: artifact.key, revision: artifact.revision });
  if (previous) {
    if (!sameApplicationValue(previous, artifact)) conflict();
    return;
  }
  const bytes = applicationStoredBytes(artifact);
  db.prepare(`INSERT INTO hindsight_application_replica_artifacts
    (provider_lineage,bank_generation,application_id,bank_id,artifact_key,artifact_kind,revision,body_id,record_hash,artifact_bytes,bytes_sha256,tombstoned)
    VALUES (:lineage,:generation,:application,:bank,:key,:kind,:revision,:body,:hash,:bytes,:bytesHash,:tombstoned)`).run({
    ...applicationScopeParams(scope), key: applicationArtifactKey(artifact.key), kind: artifact.key.artifact_kind,
    revision: artifact.revision, body: artifact.body_ref.body_id, hash: artifact.record_hash, bytes,
    bytesHash: hindsightApplicationBytesHash(bytes), tombstoned: artifact.tombstoned ? 1 : 0 });
}

export function readApplicationArtifact(db: Database, input: HindsightApplicationScope & { version: TakiApplicationArtifactVersion }): TakiApplicationArtifact | undefined {
  const artifact = readArtifactByKey(db, { ...input, key: input.version.key, revision: input.version.revision });
  if (artifact && artifact.record_hash !== input.version.record_hash) invalid();
  return artifact;
}

export function latestApplicationArtifact(db: Database, input: HindsightApplicationScope & { key: TakiApplicationArtifactKey }): TakiApplicationArtifact | undefined {
  const row = db.prepare(`SELECT * FROM hindsight_application_replica_artifacts WHERE ${APPLICATION_SCOPE_WHERE}
    AND artifact_key=:key ORDER BY revision DESC LIMIT 1`).get({ ...applicationScopeParams(input), key: applicationArtifactKey(input.key) });
  return row ? parseArtifact(row, input) : undefined;
}

export function latestApplicationBlocks(db: Database, scope: HindsightApplicationScope): TakiApplicationArtifact[] {
  return latestApplicationArtifacts(db, scope, "block");
}

export function latestApplicationArtifacts(db: Database, scope: HindsightApplicationScope,
  kind: TakiApplicationArtifactKey["artifact_kind"]): TakiApplicationArtifact[] {
  const rows = db.prepare(`SELECT artifact_key,max(revision) AS revision FROM hindsight_application_replica_artifacts
    WHERE ${APPLICATION_SCOPE_WHERE} AND artifact_kind=:kind GROUP BY artifact_key ORDER BY artifact_key`)
    .all({ ...applicationScopeParams(scope), kind });
  return rows.map((row) => {
    if (typeof row.artifact_key !== "string" || typeof row.revision !== "number" || !Number.isSafeInteger(row.revision) || row.revision < 1) invalid();
    const artifact = db.prepare(`SELECT * FROM hindsight_application_replica_artifacts WHERE ${APPLICATION_SCOPE_WHERE}
      AND artifact_key=:key AND revision=:revision`).get({ ...applicationScopeParams(scope), key: row.artifact_key, revision: row.revision });
    if (!artifact) return missing();
    return parseArtifact(artifact, scope);
  });
}

/** Delta references may point at any retained historical version, but their exact hash/body must still exist. */
export function requireApplicationArtifactClosure(access: HindsightApplicationEvidenceAccess, artifact: TakiApplicationArtifact): void {
  const body = access.body(artifact.body_ref).content;
  if (body.body_schema !== `application-${artifact.key.artifact_kind}.v1`) invalid();
  if (body.body_schema !== "application-memory.v1") return;
  if (artifact.binding.kind !== "exact_native" || !sameApplicationValue(body.value.assessment.target, artifact.binding.native)) invalid();
  for (const version of body.value.source_artifacts) {
    const source = access.artifact(version);
    if (source.key.artifact_kind !== "source" || access.body(source.body_ref).content.body_schema !== "application-source.v1") invalid();
  }
}

export function saveApplicationPublication(db: Database, scope: HindsightApplicationScope, publication: HindsightApplicationBundle | HindsightApplicationEvent): void {
  const event = "state_cursor" in publication.manifest;
  const manifest = event ? TakiApplicationStateChangeManifestSchema.parse(publication.manifest)
    : TakiApplicationReadBundleManifestSchema.parse(publication.manifest);
  const kind = event ? "event" : "snapshot";
  const id = "state_cursor" in manifest ? String(manifest.state_cursor) : manifest.snapshot_id;
  const hash = "event_hash" in manifest ? manifest.event_hash : manifest.manifest_hash;
  const params = { ...applicationScopeParams(scope), kind, id };
  const previous = db.prepare(`SELECT * FROM hindsight_application_replica_publications WHERE ${APPLICATION_SCOPE_WHERE}
    AND publication_kind=:kind AND publication_id=:id`).get(params);
  const bytes = applicationStoredBytes(manifest);
  if (previous) {
    if (previous.record_hash !== hash || !sameApplicationValue(parseApplicationStoredBytes(previous.manifest_bytes, previous.bytes_sha256), manifest)) conflict();
  } else {
    db.prepare(`INSERT INTO hindsight_application_replica_publications
      (provider_lineage,bank_generation,application_id,bank_id,publication_kind,publication_id,record_hash,manifest_bytes,bytes_sha256)
      VALUES (:lineage,:generation,:application,:bank,:kind,:id,:hash,:bytes,:bytesHash)`).run({ ...params, hash, bytes, bytesHash: hindsightApplicationBytesHash(bytes) });
  }
  for (const page of publication.pages) savePublicationPage(db, { ...scope, kind, id }, page);
}

function savePublicationPage(db: Database, publication: HindsightApplicationScope & { kind: string; id: string }, raw: TakiApplicationRecordPage): void {
  const page = TakiApplicationRecordPageSchema.parse(raw);
  const params = { ...applicationScopeParams(publication), kind: publication.kind, id: publication.id, page: page.page_number };
  const previous = db.prepare(`SELECT * FROM hindsight_application_replica_publication_pages WHERE ${APPLICATION_SCOPE_WHERE}
    AND publication_kind=:kind AND publication_id=:id AND page_number=:page`).get(params);
  if (previous) {
    if (!sameApplicationValue(parseApplicationStoredBytes(previous.page_bytes, previous.bytes_sha256), page)) conflict();
    return;
  }
  const bytes = applicationStoredBytes(page);
  db.prepare(`INSERT INTO hindsight_application_replica_publication_pages
    (provider_lineage,bank_generation,application_id,bank_id,publication_kind,publication_id,page_number,page_bytes,bytes_sha256)
    VALUES (:lineage,:generation,:application,:bank,:kind,:id,:page,:bytes,:bytesHash)`).run({ ...params, bytes, bytesHash: hindsightApplicationBytesHash(bytes) });
}

function readArtifactByKey(db: Database, input: HindsightApplicationScope & { key: TakiApplicationArtifactKey; revision: number }): TakiApplicationArtifact | undefined {
  const row = db.prepare(`SELECT * FROM hindsight_application_replica_artifacts WHERE ${APPLICATION_SCOPE_WHERE}
    AND artifact_key=:key AND revision=:revision`).get({ ...applicationScopeParams(input), key: applicationArtifactKey(input.key), revision: input.revision });
  return row ? parseArtifact(row, input) : undefined;
}

function parseArtifact(row: SqlRow, scope: HindsightApplicationScope): TakiApplicationArtifact {
  const artifact = TakiApplicationArtifactSchema.parse(parseApplicationStoredBytes(row.artifact_bytes, row.bytes_sha256));
  validateArtifactEnvelope(artifact, scope);
  if (artifact.revision !== row.revision || artifact.record_hash !== row.record_hash || artifact.key.artifact_kind !== row.artifact_kind
    || applicationArtifactKey(artifact.key) !== row.artifact_key || artifact.body_ref.body_id !== row.body_id
    || artifact.tombstoned !== (row.tombstoned === 1)) invalid();
  return artifact;
}

function validateArtifactEnvelope(artifact: TakiApplicationArtifact, scope: HindsightApplicationScope): void {
  requireApplicationScope(artifact, scope);
  if (hindsightApplicationHash({ ...scope, domain: "record", value: withoutApplicationHash(artifact, "record_hash") }) !== artifact.record_hash) invalid();
  const kind = artifact.key.artifact_kind;
  if (kind === "block") { if (artifact.binding.kind !== "core_block") invalid(); return; }
  if (artifact.binding.kind === "awaiting_native") { if (kind !== "source") invalid(); return; }
  if (artifact.binding.kind !== "exact_native") invalid();
  const kinds = { bank: "bank", source: "document", memory: "memory_unit" } as const;
  if (artifact.binding.native.object_kind !== kinds[kind] || kind === "bank" && artifact.binding.native.object_id !== scope.bankId) invalid();
}
function missing(): never { throw new Error("HINDSIGHT_APPLICATION_EVIDENCE_MISSING"); }
function invalid(): never { throw new Error("HINDSIGHT_APPLICATION_REPLICA_INTEGRITY_ERROR"); }
function conflict(): never { throw new Error("HINDSIGHT_APPLICATION_EVIDENCE_CONFLICT"); }
