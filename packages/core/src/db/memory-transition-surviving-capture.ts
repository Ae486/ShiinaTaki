/**
 * INPUT:  the completed Core copy, original emergency capture and exact admitted Bank
 * OUTPUT: complete surviving paired-replica closure with a content-bound identity
 * POS:    core/db — local materialization only; never reads native or constructs a final native proof
 */
import { MemorySurvivingBankEvidenceSchema, TakiApplicationArtifactKeySchema,
  type MemoryEmergencyCapture, type MemoryTransitionIdentity } from "@taki/shared";
import { readApplicationCheckpoint, applicationCheckpointHash } from "./hindsight-application-replica-checkpoint.ts";
import { readReplicaCheckpoint } from "./hindsight-replica-checkpoint-store.ts";
import { listApplicationHeads } from "./hindsight-application-replica-heads.ts";
import { readApplicationArtifact, readApplicationBody } from "./hindsight-application-replica-evidence.ts";
import { APPLICATION_SCOPE_WHERE, applicationScopeParams } from "./hindsight-application-replica-codec.ts";
import { applicationReplicaDigest, getApplicationReplicaRecord } from "./hindsight-application-replica-records.ts";
import { transitionDocumentHash } from "./memory-transition-document-repo.ts";
import { transitionLocalHash } from "../memory/transitions/transition-local-encoding.ts";
import { verifySurvivingBankEvidence, verifyReplicaClosure } from "../memory/transitions/transition-surviving-evidence.ts";
import type { Database } from "./sqlite.ts";

export function captureSurvivingBankEvidence(db: Database, input: { capture: MemoryEmergencyCapture;
  bank: MemoryTransitionIdentity["banks"][number]; lineage: string }) {
  const closure = readCurrentReplicaClosure(db, { ...input, epochId: input.capture.predecessorEpochId });
  const value = { version: 1 as const, kind: "surviving-replica" as const, transitionId: input.capture.transitionId,
    captureId: input.capture.captureId, ...closure };
  const evidence = MemorySurvivingBankEvidenceSchema.parse({ ...value, evidenceId: transitionDocumentHash("surviving_evidence", value) });
  verifySurvivingBankEvidence(evidence); return evidence;
}

/** Read-only complete namespace inventory; no transition/capture identity is minted for restore preflight. */
export function readCurrentReplicaClosure(db: Database, input: { epochId: string;
  bank: Pick<MemoryTransitionIdentity["banks"][number], "nativeBankId" | "nativeGeneration" | "scope">; lineage: string }) {
  const bankId = input.bank.nativeBankId ?? invalid(); const checkpoint = readApplicationCheckpoint(db, bankId);
  if (!checkpoint || checkpoint.bankDeleted || checkpoint.authorityEpochId !== input.epochId
    || checkpoint.namespace.provider_lineage !== input.lineage || checkpoint.namespace.bank_generation !== input.bank.nativeGeneration
    || transitionLocalHash(checkpoint.bankScope) !== transitionLocalHash(input.bank.scope)
    || transitionLocalHash(checkpoint.native) !== transitionLocalHash(readReplicaCheckpoint(db, bankId))) invalid();
  const scope = { bankId, namespace: checkpoint.namespace }; const params = applicationScopeParams(scope);
  if (applicationReplicaDigest(db, scope) !== checkpoint.native.manifestDigest) invalid();
  const heads = listApplicationHeads(db, scope).map((entry) => entry.head);
  // Read every version. A current SourceSet may name an older artifact/body, and awaiting Native intents must survive.
  const artifacts = db.prepare(`SELECT artifact_key,revision,record_hash FROM hindsight_application_replica_artifacts
    WHERE ${APPLICATION_SCOPE_WHERE} ORDER BY artifact_key,revision`).all(params).map((row) => {
    const key = JSON.parse(String(row.artifact_key));
    const version = { key: TakiApplicationArtifactKeySchema.parse({ artifact_kind: key[0], artifact_id: key[1] }),
      revision: Number(row.revision), record_hash: String(row.record_hash) };
    return readApplicationArtifact(db, { ...scope, version }) ?? invalid();
  });
  const bodies = db.prepare(`SELECT body_id FROM hindsight_application_replica_bodies WHERE ${APPLICATION_SCOPE_WHERE} ORDER BY body_id`)
    .all(params).map((row) => {
      const body = readApplicationBody(db, { ...scope, bodyId: String(row.body_id) }) ?? invalid();
      return { ref: body.ref, base64: Buffer.from(body.bytes).toString("base64") };
    });
  const nativeRecords = heads.flatMap((head) => {
    if (!head.version) return [];
    const body = head.body_ref ? readApplicationBody(db, { ...scope, bodyId: head.body_ref.body_id })?.content : null;
    if (body?.body_schema !== "application-native-record.v1") invalid();
    // Validate every stored consumer record too, including invalidated rows. Its absence is not a projected success.
    const record = getApplicationReplicaRecord(db, { bankId, objectKind: head.object_kind, objectId: head.object_id, includeInvalidated: true });
    if (head.binding_state === "bound" && !record) invalid();
    return [{ object_kind: head.object_kind, object_id: head.object_id,
      object_revision: head.version.object_revision, payload: body.value.payload }];
  });
  const value = { bankId, namespace: checkpoint.namespace, checkpointHash: applicationCheckpointHash(checkpoint),
    nativeSnapshotId: checkpoint.native.snapshotId, applicationSnapshotId: checkpoint.snapshot.id,
    nativeCursor: checkpoint.checkpoint.native_cursor, applicationCursor: checkpoint.checkpoint.state_cursor,
    heads, artifacts, bodies, nativeRecords };
  verifyReplicaClosure(value); return value;
}
function invalid(): never { throw new Error("MEMORY_TRANSITION_PROOF_INVALID"); }
