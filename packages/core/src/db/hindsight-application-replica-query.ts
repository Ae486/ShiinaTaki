/**
 * INPUT:  scoped application checkpoints, exact native/artifact evidence and bounded reader requests
 * OUTPUT: integrity-checked Canonical reads, policy-filtered search and durable binding/assessment work
 * POS:    core/db — a consumer projection is usable only while its exact evidence and checkpoint pair still agree
 */
import { TakiApplicationTimeSchema, type CanonicalMemoryBank, type CanonicalMemoryRecord, type TakiApplicationArtifact,
  type HindsightApplicationReplicaRecord, type TakiApplicationNativeHead } from "@taki/shared";
import { hindsightPolicyAdmission } from "../memory/hindsight/hindsight-policy-admission.ts";
import { canonicalMemoryRow } from "../memory/canonical-memory-view.ts";
import { isPinnedEligible, selectPinned } from "../memory/pinned-block.ts";
import { projectHindsightApplicationNativeUnit, projectHindsightApplicationRecord,
  readHindsightApplicationNative } from "../memory/hindsight/hindsight-application-projection.ts";
import { sameApplicationValue, type HindsightApplicationScope } from "../memory/hindsight/hindsight-application-integrity.ts";
import { applicationObjectKey, applicationReplicaRecordHash } from "./hindsight-application-replica-codec.ts";
import { readApplicationCheckpoint, requireApplicationReadCheckpoint } from "./hindsight-application-replica-checkpoint.ts";
import { HindsightApplicationWorkCursorSchema, type HindsightApplicationBankBinding, type HindsightApplicationBindingWork,
  type HindsightApplicationEvidenceAccess, type HindsightApplicationReplicaCheckpoint, type HindsightApplicationReplicaState,
  type HindsightApplicationWorkCursor } from "./hindsight-application-replica-contract.ts";
import { createApplicationEvidenceAccess, latestApplicationArtifacts, requireApplicationArtifactClosure } from "./hindsight-application-replica-evidence.ts";
import { applicationWorkHeads, listApplicationHeads, readApplicationHead, validateApplicationHead,
  type ApplicationHeadEntry } from "./hindsight-application-replica-heads.ts";
import { getApplicationReplicaRecord } from "./hindsight-application-replica-records.ts";
import type { ReplicaRecordRead } from "./hindsight-replica-record-store.ts";

type ObjectKey = Pick<TakiApplicationNativeHead, "object_kind" | "object_id">;
interface ReadContext extends HindsightApplicationScope {
  state: HindsightApplicationReplicaState;
  checkpoint: HindsightApplicationReplicaCheckpoint;
  access: HindsightApplicationEvidenceAccess;
  bank: CanonicalMemoryBank | undefined;
}

export function readApplicationNativeHead(state: HindsightApplicationReplicaState, input: HindsightApplicationScope & ObjectKey):
TakiApplicationNativeHead | undefined {
  const checkpoint = requireApplicationReadCheckpoint(state, input, true);
  const context: ReadContext = { ...input, state, checkpoint, bank: undefined, access: createApplicationEvidenceAccess(state.db, input) };
  return checkedHead(context, input)?.head;
}

export function readApplicationBankBinding(state: HindsightApplicationReplicaState, bankId: string): HindsightApplicationBankBinding | undefined {
  const current = readApplicationCheckpoint(state.db, bankId);
  if (!current) return undefined;
  const scope = { bankId, namespace: current.namespace };
  const checkpoint = requireApplicationReadCheckpoint(state, scope, true);
  const context: ReadContext = { ...scope, state, checkpoint, bank: undefined, access: createApplicationEvidenceAccess(state.db, scope) };
  const entry = checkedHead(context, { object_kind: "bank", object_id: bankId });
  if (!entry || checkpoint.bankDeleted !== (entry.head.binding_state === "tombstoned")) invalid();
  const projected = checkedProjection(context, entry);
  return { ...scope, authorityEpochId: checkpoint.authorityEpochId, scope: checkpoint.bankScope,
    bindingState: entry.head.binding_state, bankDeleted: checkpoint.bankDeleted,
    bank: projected?.payload?.kind === "bank" ? projected.payload.value : undefined };
}

export function readApplicationLogicalRecord(state: HindsightApplicationReplicaState, input: HindsightApplicationScope & ReplicaRecordRead):
HindsightApplicationReplicaRecord | undefined {
  const record = readProjectedRecord(readContext(state, input), { object_kind: input.objectKind, object_id: input.objectId });
  if (record?.operation === "tombstone" && !input.includeTombstones) return undefined;
  if (record?.payload?.kind === "memory_unit" && record.payload.value.unit.state === "invalidated" && !input.includeInvalidated) return undefined;
  return record;
}

export function readApplicationMemoryRecord(state: HindsightApplicationReplicaState, input: HindsightApplicationScope & {
  memoryId: string; includeInvalidated?: boolean; includeHidden?: boolean;
}): CanonicalMemoryRecord | undefined {
  const record = readApplicationLogicalRecord(state, { ...input, objectKind: "memory_unit", objectId: input.memoryId });
  if (record?.payload?.kind !== "memory_unit") return undefined;
  if (record.payload.value.policy.visibility === "hidden" && !input.includeHidden) return undefined;
  return record.payload.value;
}

export function searchApplicationMemories(state: HindsightApplicationReplicaState, input: HindsightApplicationScope & {
  query: string; limit: number; at?: string; layerIds?: string[]; factTypes?: CanonicalMemoryRecord["unit"]["factType"][];
}): CanonicalMemoryRecord[] {
  const context = readContext(state, input);
  const at = TakiApplicationTimeSchema.parse(input.at ?? state.now());
  const seen = new Set<string>();
  return state.records.applicationSearch({ bankId: input.bankId, query: input.query, limit: input.limit, accept: (candidate) => {
    const id = candidate.unit.memoryId;
    if (seen.has(id)) return false;
    if (input.factTypes?.length && !input.factTypes.includes(candidate.unit.factType)) return false;
    const record = readProjectedRecord(context, { object_kind: "memory_unit", object_id: id });
    if (record?.payload?.kind !== "memory_unit" || !sameApplicationValue(record.payload.value, candidate)) invalid();
    const entry = checkedHead(context, { object_kind: "memory_unit", object_id: id });
    if (!entry || !memoryEligible(context, entry.head, { ...input, at })) return false;
    seen.add(id);
    return true;
  } });
}

export function readApplicationBindingWork(state: HindsightApplicationReplicaState, input: HindsightApplicationScope & {
  kind: "binding" | "assessment"; limit: number; at?: string; eligibleForMaintenance?: boolean; after?: HindsightApplicationWorkCursor;
  objectKind?: TakiApplicationNativeHead["object_kind"];
}): HindsightApplicationBindingWork[] {
  const checkpoint = requireApplicationReadCheckpoint(state, input);
  const access = createApplicationEvidenceAccess(state.db, input);
  const filter = input.kind === "assessment" && input.eligibleForMaintenance === true;
  const context: ReadContext = filter ? readContext(state, input) : { ...input, state, checkpoint, access, bank: undefined };
  const at = TakiApplicationTimeSchema.parse(input.at ?? state.now());
  const entries = applicationWorkHeads(state.db, input, { kind: input.kind, limit: input.limit, objectKind: input.objectKind,
    ...(input.after ? { after: workCursor(context, input.after) } : {}),
    at, ...(filter ? { accept: (entry: ApplicationHeadEntry) => {
      assertHeadCheckpoint(context, entry); validateApplicationHead(access, entry.head);
      checkedProjection(context, entry);
      return memoryEligible(context, entry.head, { query: "", at });
    } } : {}) });
  return entries.map((entry) => {
    assertHeadCheckpoint(context, entry);
    validateApplicationHead(access, entry.head);
    const artifact = entry.head.bound_artifact ? access.artifact(entry.head.bound_artifact) : null;
    const body = artifact ? access.body(artifact.body_ref).content : null;
    return { cursor: { namespace: checkpoint.namespace, bankId: checkpoint.bankId, stateCursor: entry.stateCursor,
      objectKind: entry.head.object_kind, objectId: entry.head.object_id },
    head: entry.head, artifact, memory: body?.body_schema === "application-memory.v1" ? body.value : null };
  });
}

function workCursor(context: ReadContext, raw: HindsightApplicationWorkCursor): { stateCursor: number; objectKey: string } {
  const cursor = HindsightApplicationWorkCursorSchema.parse(raw);
  if (cursor.bankId !== context.bankId || !sameApplicationValue(cursor.namespace, context.namespace)
    || cursor.stateCursor > context.checkpoint.checkpoint.state_cursor) throw new Error("HINDSIGHT_APPLICATION_WORK_CURSOR_INVALID");
  return { stateCursor: cursor.stateCursor, objectKey: applicationObjectKey({ object_kind: cursor.objectKind, object_id: cursor.objectId }) };
}

export function readApplicationSourceArtifacts(state: HindsightApplicationReplicaState, input: HindsightApplicationScope & {
  documentId?: string; bindingKind?: "awaiting_native" | "exact_native";
}): TakiApplicationArtifact[] {
  requireApplicationReadCheckpoint(state, input);
  const access = createApplicationEvidenceAccess(state.db, input);
  return latestApplicationArtifacts(state.db, input, "source").filter((artifact) => {
    if (artifact.tombstoned) return false;
    if (artifact.binding.kind === "core_block") invalid();
    if (input.bindingKind !== undefined && artifact.binding.kind !== input.bindingKind) return false;
    const document = artifact.binding.kind === "awaiting_native" ? artifact.binding.document_id : artifact.binding.native.object_id;
    if (input.documentId !== undefined && input.documentId !== document) return false;
    // The exact envelope identifies the candidate. Loading every unrelated
    // Source body here made each memory binding scan the whole Bank again.
    requireApplicationArtifactClosure(access, artifact);
    return true;
  });
}

export function readApplicationBlockArtifacts(state: HindsightApplicationReplicaState, scope: HindsightApplicationScope): TakiApplicationArtifact[] {
  requireApplicationReadCheckpoint(state, scope);
  const access = createApplicationEvidenceAccess(state.db, scope);
  return latestApplicationArtifacts(state.db, scope, "block").filter((artifact) => {
    requireApplicationArtifactClosure(access, artifact);
    return !artifact.tombstoned;
  });
}

export function readApplicationPinnedRecords(state: HindsightApplicationReplicaState, input: HindsightApplicationScope & {
  limit: number; at?: string;
}): CanonicalMemoryRecord[] {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1000) throw new Error("HINDSIGHT_APPLICATION_PINNED_LIMIT_INVALID");
  const context = readContext(state, input);
  const at = TakiApplicationTimeSchema.parse(input.at ?? state.now());
  const rows = [];
  for (const entry of listApplicationHeads(state.db, input)) {
    if (entry.head.object_kind !== "memory_unit") continue;
    const record = readProjectedRecord(context, entry.head);
    if (record?.payload?.kind !== "memory_unit") continue;
    const row = { ...canonicalMemoryRow(record.payload.value, context.checkpoint.bankScope.characterId), record: record.payload.value };
    if (!isPinnedEligible(row) || !memoryEligible(context, entry.head, { query: "", at })) continue;
    rows.push(row);
    if (rows.length > input.limit) throw new Error("HINDSIGHT_APPLICATION_PINNED_OVERFLOW");
  }
  // Reuse the existing layer/chronological order. The captured assembly owns its real token-budget decision.
  return selectPinned(rows, Number.MAX_SAFE_INTEGER).map((row) => row.record);
}

function readContext(state: HindsightApplicationReplicaState, scope: HindsightApplicationScope): ReadContext {
  const checkpoint = requireApplicationReadCheckpoint(state, scope);
  const context: ReadContext = { ...scope, state, checkpoint, access: createApplicationEvidenceAccess(state.db, scope), bank: undefined };
  const bank = readProjectedRecord(context, { object_kind: "bank", object_id: scope.bankId });
  if (bank?.operation === "tombstone") invalid();
  context.bank = bank?.payload?.kind === "bank" ? bank.payload.value : undefined;
  return context;
}

function readProjectedRecord(context: ReadContext, key: ObjectKey): HindsightApplicationReplicaRecord | undefined {
  const entry = checkedHead(context, key);
  if (!entry) {
    if (getApplicationReplicaRecord(context.state.db, { bankId: context.bankId, objectKind: key.object_kind,
      objectId: key.object_id, includeInvalidated: true, includeTombstones: true })) invalid();
    return undefined;
  }
  return checkedProjection(context, entry);
}

function checkedHead(context: ReadContext, key: ObjectKey): ApplicationHeadEntry | undefined {
  const entry = readApplicationHead(context.state.db, { ...context, ...key });
  if (entry) {
    assertHeadCheckpoint(context, entry);
    validateApplicationHead(context.access, entry.head);
  }
  return entry;
}

function assertHeadCheckpoint(context: ReadContext, entry: ApplicationHeadEntry): void {
  const cursor = entry.head.version?.native_cursor ?? entry.head.tombstone?.native_cursor ?? null;
  if (entry.stateCursor > context.checkpoint.checkpoint.state_cursor
    || cursor !== null && cursor > context.checkpoint.checkpoint.native_cursor) invalid();
}

function checkedProjection(context: ReadContext, entry: ApplicationHeadEntry): HindsightApplicationReplicaRecord | undefined {
  const projected = projectHindsightApplicationRecord({ ...context, authorityEpochId: context.checkpoint.authorityEpochId,
    bankScope: context.checkpoint.bankScope, head: entry.head, evidence: context.access });
  const record = projected.status === "projected" ? projected.record : undefined;
  const stored = getApplicationReplicaRecord(context.state.db, { bankId: context.bankId, objectKind: entry.head.object_kind,
    objectId: entry.head.object_id, includeInvalidated: true, includeTombstones: true });
  if (entry.projectionHash !== (record ? applicationReplicaRecordHash(context, record) : null)
    || !sameApplicationValue(record ?? null, stored ?? null)) invalid();
  return record;
}

function memoryEligible(context: ReadContext, head: TakiApplicationNativeHead, query: {
  query: string; at: string; layerIds?: string[];
}): boolean {
  if (!context.bank || head.binding_state !== "bound" || !head.bound_artifact) return false;
  const native = readHindsightApplicationNative({ ...context, head, evidence: context.access });
  const unit = projectHindsightApplicationNativeUnit({ ...context, native, authorityEpochId: context.checkpoint.authorityEpochId });
  const artifact = context.access.artifact(head.bound_artifact);
  const body = context.access.body(artifact.body_ref).content;
  if (body.body_schema !== "application-memory.v1") invalid();
  return hindsightPolicyAdmission({ ...query, context: { namespace: context.namespace,
    authorityEpochId: context.checkpoint.authorityEpochId, bank: context.bank,
    activeCharacterId: context.checkpoint.bankScope.characterId,
    native: { status: "verified", namespace: context.namespace, bankId: context.bankId, native: native.version, unit } },
  state: { status: "present", namespace: context.namespace, bankId: context.bankId, native: native.version,
    artifact: head.bound_artifact, body: body.value } }).eligible;
}

function invalid(): never { throw new Error("HINDSIGHT_APPLICATION_REPLICA_READ_INVALID"); }
