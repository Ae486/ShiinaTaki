/**
 * INPUT:  verified native heads and a transactionally available immutable artifact/body closure
 * OUTPUT: exact bindings, native evolution and paged assessment indexes with explicit deferred-retry inclusion
 * POS:    core/db — native/application clocks remain separate; unresolved bindings never retain a consumer projection
 */
import { TakiApplicationNativeHeadSchema, type TakiApplicationCheckpoint, type TakiApplicationNativeHead,
  type TakiApplicationMemoryBody } from "@taki/shared";
import { hindsightApplicationBytesHash, sameApplicationValue, type HindsightApplicationScope } from "../memory/hindsight/hindsight-application-integrity.ts";
import { APPLICATION_SCOPE_WHERE, applicationArtifactKey, applicationObjectKey, applicationScopeParams,
  applicationStoredBytes, parseApplicationStoredBytes } from "./hindsight-application-replica-codec.ts";
import type { HindsightApplicationEvidenceAccess } from "./hindsight-application-replica-contract.ts";
import { requireApplicationArtifactClosure } from "./hindsight-application-replica-evidence.ts";
import type { Database, SqlRow } from "./sqlite.ts";

type HeadKey = Pick<TakiApplicationNativeHead, "object_kind" | "object_id">;
export interface ApplicationHeadEntry { head: TakiApplicationNativeHead; projectionHash: string | null; stateCursor: number }
interface HeadStoreContext { db: Database; scope: HindsightApplicationScope; access: HindsightApplicationEvidenceAccess }

export function saveApplicationHead(context: HeadStoreContext, input: {
  head: TakiApplicationNativeHead; checkpoint: TakiApplicationCheckpoint; fromNativeCursor?: number;
}): void {
  const head = TakiApplicationNativeHeadSchema.parse(input.head);
  const previous = readApplicationHead(context.db, { ...context.scope, ...head });
  const memory = validateApplicationHead(context.access, head);
  assertNativeEvolution(previous?.head, head, input);
  const bytes = applicationStoredBytes(head);
  context.db.prepare(`INSERT INTO hindsight_application_replica_heads
    (provider_lineage,bank_generation,application_id,bank_id,object_key,object_kind,head_bytes,bytes_sha256,body_id,
     binding_state,bound_artifact_key,bound_artifact_revision,assessment_state,next_attempt_at,observed_state_cursor,projection_hash)
    VALUES (:lineage,:generation,:application,:bank,:key,:kind,:bytes,:hash,:body,:binding,:artifact,:revision,:assessment,:retry,:cursor,NULL)
    ON CONFLICT(provider_lineage,bank_generation,application_id,bank_id,object_key) DO UPDATE SET
    head_bytes=excluded.head_bytes,bytes_sha256=excluded.bytes_sha256,body_id=excluded.body_id,binding_state=excluded.binding_state,
    bound_artifact_key=excluded.bound_artifact_key,bound_artifact_revision=excluded.bound_artifact_revision,
    assessment_state=excluded.assessment_state,next_attempt_at=excluded.next_attempt_at,observed_state_cursor=excluded.observed_state_cursor`)
    .run({ ...applicationScopeParams(context.scope), key: applicationObjectKey(head), kind: head.object_kind, bytes,
      hash: hindsightApplicationBytesHash(bytes), body: head.body_ref?.body_id ?? null, binding: head.binding_state,
      artifact: head.bound_artifact ? applicationArtifactKey(head.bound_artifact.key) : null,
      revision: head.bound_artifact?.revision ?? null, assessment: memory?.assessment.state ?? null,
      retry: memory?.assessment.next_attempt_at ?? null, cursor: input.checkpoint.state_cursor });
}

export function readApplicationHead(db: Database, input: HindsightApplicationScope & HeadKey): ApplicationHeadEntry | undefined {
  const row = db.prepare(`SELECT * FROM hindsight_application_replica_heads WHERE ${APPLICATION_SCOPE_WHERE} AND object_key=:key`)
    .get({ ...applicationScopeParams(input), key: applicationObjectKey(input) });
  return row ? parseHead(row) : undefined;
}

export function listApplicationHeads(db: Database, scope: HindsightApplicationScope): ApplicationHeadEntry[] {
  return db.prepare(`SELECT * FROM hindsight_application_replica_heads WHERE ${APPLICATION_SCOPE_WHERE} ORDER BY object_key`)
    .all(applicationScopeParams(scope)).map(parseHead);
}

export function retainSnapshotHeads(db: Database, scope: HindsightApplicationScope, keys: Set<string>): void {
  const rows = db.prepare(`SELECT object_key FROM hindsight_application_replica_heads WHERE ${APPLICATION_SCOPE_WHERE}`).all(applicationScopeParams(scope));
  for (const row of rows) {
    if (typeof row.object_key !== "string") invalid();
    if (!keys.has(row.object_key)) db.prepare(`DELETE FROM hindsight_application_replica_heads WHERE ${APPLICATION_SCOPE_WHERE} AND object_key=:key`)
      .run({ ...applicationScopeParams(scope), key: row.object_key });
  }
}

export function markApplicationProjection(db: Database, scope: HindsightApplicationScope, input: HeadKey & { hash: string | null }): void {
  const changed = db.prepare(`UPDATE hindsight_application_replica_heads SET projection_hash=:hash
    WHERE ${APPLICATION_SCOPE_WHERE} AND object_key=:key`).run({ ...applicationScopeParams(scope), key: applicationObjectKey(input), hash: input.hash });
  if (changed.changes !== 1) invalid();
}

export function applicationWorkHeads(db: Database, scope: HindsightApplicationScope, input: {
  kind: "binding" | "assessment"; limit: number; at: string; accept?: (entry: ApplicationHeadEntry) => boolean;
  after?: { stateCursor: number; objectKey: string }; objectKind?: TakiApplicationNativeHead["object_kind"]; includeDeferred?: boolean;
}): ApplicationHeadEntry[] {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1000) throw new Error("HINDSIGHT_APPLICATION_WORK_LIMIT_INVALID");
  const predicate = input.kind === "binding" ? "binding_state IN ('binding_missing','rebind_required')"
    : "object_kind='memory_unit' AND binding_state='bound' AND assessment_state IN ('due','failed') AND (:deferred=1 OR next_attempt_at IS NULL OR julianday(next_attempt_at)<=julianday(:at))";
  const pageSize = Math.min(256, Math.max(32, input.limit));
  const params = { ...applicationScopeParams(scope), limit: pageSize, objectKind: input.objectKind ?? null,
    ...(input.kind === "assessment" ? { at: input.at, deferred: input.includeDeferred ? 1 : 0 } : {}) };
  const query = db.prepare(`SELECT * FROM hindsight_application_replica_heads WHERE ${APPLICATION_SCOPE_WHERE}
    AND ${predicate} AND (:objectKind IS NULL OR object_kind=:objectKind)
    AND (observed_state_cursor>:cursor OR (observed_state_cursor=:cursor AND object_key>:key))
    ORDER BY observed_state_cursor,object_key LIMIT :limit`);
  const accepted: ApplicationHeadEntry[] = [];
  let cursor = input.after?.stateCursor ?? -1; let key = input.after?.objectKey ?? "";
  while (accepted.length < input.limit) {
    const rows = query.all({ ...params, cursor, key });
    for (const row of rows) {
      const entry = parseHead(row); cursor = entry.stateCursor; key = applicationObjectKey(entry.head);
      if (input.accept && !input.accept(entry)) continue;
      accepted.push(entry);
      if (accepted.length === input.limit) return accepted;
    }
    if (rows.length < pageSize) break;
  }
  return accepted;
}

export function validateApplicationHead(access: HindsightApplicationEvidenceAccess, head: TakiApplicationNativeHead): TakiApplicationMemoryBody | null {
  if (head.binding_state === "tombstoned") {
    if (head.version !== null || head.body_ref !== null || head.tombstone === null
      || head.tombstone.object_kind !== head.object_kind || head.tombstone.object_id !== head.object_id) invalid();
  } else {
    if (!head.version || !head.body_ref || head.tombstone !== null || head.version.object_kind !== head.object_kind
      || head.version.object_id !== head.object_id) invalid();
    const native = access.body(head.body_ref).content;
    if (native.body_schema !== "application-native-record.v1" || !sameApplicationValue(native.value.version, head.version)) invalid();
    if (native.value.source_evidence_ref) {
      const source = access.body(native.value.source_evidence_ref).content;
      if (source.body_schema !== "application-native-source.v1" || !sameApplicationValue(source.value.document_version, head.version)) invalid();
    }
  }
  if (!head.bound_artifact) {
    if (head.binding_state === "bound" || head.binding_state === "rebind_required") invalid();
    return null;
  }
  const artifact = access.artifact(head.bound_artifact);
  requireApplicationArtifactClosure(access, artifact);
  if (head.binding_state === "bound" && (artifact.tombstoned || artifact.binding.kind !== "exact_native"
    || !sameApplicationValue(artifact.binding.native, head.version))) invalid();
  if (head.binding_state === "rebind_required" && (artifact.binding.kind !== "exact_native" || head.previous_version === null
    || !sameApplicationValue(artifact.binding.native, head.previous_version)
    || head.previous_version.object_kind !== head.object_kind || head.previous_version.object_id !== head.object_id
    || head.version === null || head.previous_version.object_revision > head.version.object_revision
    || head.previous_version.object_revision === head.version.object_revision
      && !sameApplicationValue(head.previous_version, head.version))) invalid();
  const body = access.body(artifact.body_ref).content;
  return head.binding_state === "bound" && body.body_schema === "application-memory.v1" ? body.value : null;
}

function assertNativeEvolution(previous: TakiApplicationNativeHead | undefined, head: TakiApplicationNativeHead, input: {
  checkpoint: TakiApplicationCheckpoint; fromNativeCursor?: number;
}): void {
  const cursor = head.version?.native_cursor ?? head.tombstone?.native_cursor ?? null;
  if (cursor !== null && cursor > input.checkpoint.native_cursor) invalid();
  if (!previous) {
    if (input.fromNativeCursor !== undefined && (cursor === null || cursor <= input.fromNativeCursor)) invalid();
    return;
  }
  const oldRevision = previous.version?.object_revision ?? previous.tombstone?.object_revision;
  const newRevision = head.version?.object_revision ?? head.tombstone?.object_revision;
  if (oldRevision === undefined || newRevision === undefined || newRevision < oldRevision) invalid();
  if (head.version && previous.version && newRevision === oldRevision && head.version.payload_hash !== previous.version.payload_hash) invalid();
  const changed = !sameApplicationValue(previous.version, head.version) || !sameApplicationValue(previous.tombstone, head.tombstone);
  if (changed && input.fromNativeCursor !== undefined && (cursor === null || cursor <= input.fromNativeCursor)) invalid();
}

function parseHead(row: SqlRow): ApplicationHeadEntry {
  const head = TakiApplicationNativeHeadSchema.parse(parseApplicationStoredBytes(row.head_bytes, row.bytes_sha256));
  if (applicationObjectKey(head) !== row.object_key || head.object_kind !== row.object_kind || head.binding_state !== row.binding_state
    || (head.body_ref?.body_id ?? null) !== row.body_id || (head.bound_artifact?.revision ?? null) !== row.bound_artifact_revision
    || (head.bound_artifact ? applicationArtifactKey(head.bound_artifact.key) : null) !== row.bound_artifact_key
    || typeof row.observed_state_cursor !== "number" || !Number.isSafeInteger(row.observed_state_cursor)
    || row.observed_state_cursor < 0 || row.projection_hash !== null && typeof row.projection_hash !== "string") invalid();
  return { head, projectionHash: row.projection_hash, stateCursor: row.observed_state_cursor };
}
function invalid(): never { throw new Error("HINDSIGHT_APPLICATION_BINDING_INVALID"); }
