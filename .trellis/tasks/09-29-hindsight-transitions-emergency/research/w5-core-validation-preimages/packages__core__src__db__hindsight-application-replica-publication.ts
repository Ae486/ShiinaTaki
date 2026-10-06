/**
 * INPUT:  complete verified snapshots/events, captured checkpoint pairs and the current authority/Bank lease
 * OUTPUT: atomic evidence/head/Canonical/FTS/Block publication followed by the native/application checkpoint pair
 * POS:    core/db — application-aware synchronization beside B5; no provider mutation or authority activation
 */
import { type CanonicalMemoryBank, type TakiApplicationNativeHead, type TakiApplicationRecordDescriptor, type MemoryTransitionNativeEvidence } from "@taki/shared";
import { verifyTransitionNativeEvidence } from "../memory/transitions/transition-native-evidence.ts";
import { normalizeSnapshotMetadata } from "../memory/hindsight/hindsight-snapshot-contracts.ts";
import { verifyHindsightApplicationBundle, verifyHindsightApplicationEvent,
  verifyHindsightApplicationNativeBaseline, verifyHindsightApplicationNativeBaselineContents } from "../memory/hindsight/hindsight-application-bundle.ts";
import { sameApplicationValue } from "../memory/hindsight/hindsight-application-integrity.ts";
import { projectHindsightApplicationRecord } from "../memory/hindsight/hindsight-application-projection.ts";
import { applicationReplicaRecordHash, applicationObjectKey } from "./hindsight-application-replica-codec.ts";
import { restoreApplicationBlock } from "./hindsight-application-replica-blocks.ts";
import { applicationCheckpointHash, assertApplicationPublication, bankScope, buildApplicationEventCheckpoint,
  buildApplicationSnapshotCheckpoint, publishApplicationCheckpoint } from "./hindsight-application-replica-checkpoint.ts";
import { createApplicationEvidenceAccess, latestApplicationBlocks, requireApplicationArtifactClosure,
  saveApplicationArtifact, saveApplicationBody, saveApplicationPublication } from "./hindsight-application-replica-evidence.ts";
import { listApplicationHeads, markApplicationProjection, readApplicationHead, retainSnapshotHeads,
  saveApplicationHead } from "./hindsight-application-replica-heads.ts";
import { applicationReplicaRecordCas } from "./hindsight-application-replica-records.ts";
import type { HindsightApplicationEvidenceAccess, HindsightApplicationEventInput, HindsightApplicationPublicationInput,
  HindsightApplicationReplicaCheckpoint, HindsightApplicationReplicaState, HindsightApplicationSnapshotInput } from "./hindsight-application-replica-contract.ts";

export function publishApplicationSnapshot(state: HindsightApplicationReplicaState, input: HindsightApplicationSnapshotInput): HindsightApplicationReplicaCheckpoint {
  return publishSnapshot(state, input, false);
}

/** Retained W2 certificates outlive transport TTL; only their complete verified immutable closure grants this path. */
export function publishTransitionApplicationSnapshot(state: HindsightApplicationReplicaState,
  input: HindsightApplicationSnapshotInput & { transitionEvidence: MemoryTransitionNativeEvidence }): HindsightApplicationReplicaCheckpoint {
  const bundle = verifyTransitionNativeEvidence(input.transitionEvidence);
  const proof = input.transitionEvidence.status.proof!;
  if (!sameApplicationValue(bundle.manifest, input.bundle.manifest)
    || input.transitionEvidence.status.bank_id !== input.bankId
    || !sameApplicationValue(input.nativeBaseline, normalizeSnapshotMetadata(proof.native_snapshot))) invalid();
  // Use the independently reconstructed pages and original body bytes, not another bundle that merely repeats the
  // retained manifest. Only this exact W2 closure receives the transport-expiry exception.
  return publishSnapshot(state, { ...input, bundle }, true);
}

function publishSnapshot(state: HindsightApplicationReplicaState, input: HindsightApplicationSnapshotInput, retained: boolean): HindsightApplicationReplicaCheckpoint {
  verifyHindsightApplicationBundle(input.bundle, input);
  if (input.bundle.manifest.kind !== "snapshot") throw new Error("HINDSIGHT_APPLICATION_FULL_SNAPSHOT_REQUIRED");
  const descriptors = input.bundle.pages.flatMap((page) => page.records);
  assertSnapshotPredecessor(input);
  if (input.nativeBaseline) {
    if (retained) verifyHindsightApplicationNativeBaselineContents(input.bundle, input.nativeBaseline);
    else verifyHindsightApplicationNativeBaseline(input.bundle, input.nativeBaseline);
  }
  let result: HindsightApplicationReplicaCheckpoint | undefined;
  state.db.transaction(() => {
    assertApplicationPublication(state, input);
    if (!retained) assertSnapshotFresh(state, input);
    const access = storeEvidence(state, input, { descriptors, publication: input.bundle });
    const heads = descriptors.flatMap((descriptor) => descriptor.kind === "native" ? [descriptor.head] : []);
    if (heads.filter((head) => head.object_kind === "bank" && head.object_id === input.bankId).length !== 1) invalid();
    for (const head of heads) saveApplicationHead({ db: state.db, scope: input, access }, { head, checkpoint: input.bundle.manifest.checkpoint });
    retainSnapshotHeads(state.db, input, new Set(heads.map(applicationObjectKey)));
    // Both projections are derived. A verified full rebuild withdraws every former readable row in this Bank atomically.
    state.records.clear(input.bankId);
    state.db.prepare("DELETE FROM hindsight_application_replica_projections WHERE bank_id=:bank").run({ bank: input.bankId });
    publishProjections(state, input, { access, heads, bankDeleted: false });
    restoreBlocks(state, input, access);
    result = buildApplicationSnapshotCheckpoint(state, input);
    if (!retained) assertSnapshotFresh(state, input);
    assertApplicationPublication(state, input);
    publishApplicationCheckpoint(state, { previous: input.expectedCheckpoint, previousNative: input.expectedNativeCheckpoint, next: result });
  });
  if (!result) invalid();
  return result;
}

export function publishApplicationEvent(state: HindsightApplicationReplicaState, input: HindsightApplicationEventInput): HindsightApplicationReplicaCheckpoint {
  verifyHindsightApplicationEvent(input.event, input);
  assertEventPredecessor(input);
  const descriptors = input.event.pages.flatMap((page) => page.records);
  let result: HindsightApplicationReplicaCheckpoint | undefined;
  state.db.transaction(() => {
    assertApplicationPublication(state, input);
    const access = storeEvidence(state, input, { descriptors, publication: input.event });
    const heads = descriptors.flatMap((descriptor) => descriptor.kind === "native" ? [descriptor.head] : []);
    for (const head of heads) saveApplicationHead({ db: state.db, scope: input, access }, { head,
      checkpoint: input.event.manifest.to_checkpoint, fromNativeCursor: input.event.manifest.from_checkpoint.native_cursor });
    const bankChanged = heads.some((head) => head.object_kind === "bank");
    publishProjections(state, input, { access, heads: bankChanged ? listApplicationHeads(state.db, input).map((entry) => entry.head) : heads,
      bankDeleted: input.event.manifest.bank_deleted });
    if (!input.event.manifest.bank_deleted) restoreBlocks(state, input, access);
    result = buildApplicationEventCheckpoint(state, input);
    assertApplicationPublication(state, input);
    publishApplicationCheckpoint(state, { previous: input.expectedCheckpoint, previousNative: input.expectedNativeCheckpoint, next: result });
  });
  if (!result) invalid();
  return result;
}

function storeEvidence(state: HindsightApplicationReplicaState, input: HindsightApplicationPublicationInput, work: {
  descriptors: TakiApplicationRecordDescriptor[]; publication: HindsightApplicationSnapshotInput["bundle"] | HindsightApplicationEventInput["event"];
}) {
  const { publication, descriptors } = work;
  for (const body of publication.bodies.values()) saveApplicationBody(state.db, input, body);
  for (const descriptor of descriptors) if (descriptor.kind === "artifact") saveApplicationArtifact(state.db, input, descriptor.artifact);
  const access = createApplicationEvidenceAccess(state.db, input);
  for (const descriptor of descriptors) if (descriptor.kind === "artifact") requireApplicationArtifactClosure(access, descriptor.artifact);
  saveApplicationPublication(state.db, input, publication);
  return access;
}

function publishProjections(state: HindsightApplicationReplicaState, input: HindsightApplicationPublicationInput, work: {
  access: HindsightApplicationEvidenceAccess; heads: TakiApplicationNativeHead[]; bankDeleted: boolean;
}): void {
  const bankHead = readApplicationHead(state.db, { ...input, object_kind: "bank", object_id: input.bankId })?.head;
  if (!bankHead) invalid();
  const context = { ...input, bankScope: bankScope(input), evidence: work.access, bank: undefined };
  const bankProjection = projectHindsightApplicationRecord({ ...context, head: bankHead });
  const bank: CanonicalMemoryBank | undefined = bankProjection.status === "projected" && bankProjection.record.payload?.kind === "bank"
    ? bankProjection.record.payload.value : undefined;
  if (work.bankDeleted) {
    state.records.clear(input.bankId);
    state.db.prepare("DELETE FROM hindsight_application_replica_projections WHERE bank_id=:bank").run({ bank: input.bankId });
  }
  for (const head of work.heads) {
    const projected = work.bankDeleted && head.object_kind !== "bank" ? null
      : projectHindsightApplicationRecord({ ...context, bank, head });
    const record = projected?.status === "projected" ? projected.record : null;
    const target = { bankId: input.bankId, objectKind: head.object_kind, objectId: head.object_id };
    state.records.applicationReproject({ ...target, namespace: input.namespace, record,
      expectedCheckpointHash: input.expectedCheckpoint ? applicationCheckpointHash(input.expectedCheckpoint) : null,
      expectedRecord: applicationReplicaRecordCas(state.db, target), sourceCursor: head.version?.native_cursor ?? head.tombstone?.native_cursor ?? null });
    markApplicationProjection(state.db, input, { ...head, hash: record ? applicationReplicaRecordHash(input, record) : null });
  }
}

function restoreBlocks(state: HindsightApplicationReplicaState, input: HindsightApplicationPublicationInput, access: HindsightApplicationEvidenceAccess): void {
  const identities = new Set<string>();
  for (const artifact of latestApplicationBlocks(state.db, input)) {
    if (artifact.tombstoned) continue;
    const body = access.body(artifact.body_ref).content;
    if (body.body_schema !== "application-block.v1" || !sameApplicationValue(body.value.scope, bankScope(input))) invalid();
    const key = JSON.stringify([body.value.block_id, body.value.scope]);
    if (identities.has(key)) throw new Error("HINDSIGHT_APPLICATION_BLOCK_BINDING_INVALID");
    identities.add(key);
    restoreApplicationBlock({ db: state.db, scope: input, access, artifact, bankScope: bankScope(input) });
  }
}

function assertSnapshotPredecessor(input: HindsightApplicationSnapshotInput): void {
  const previous = input.expectedCheckpoint; const next = input.bundle.manifest.checkpoint;
  const matching = previous !== null && sameApplicationValue(previous.namespace, input.namespace)
    && previous.authorityEpochId === input.authorityEpochId;
  if (!matching && !input.nativeBaseline) throw new Error("HINDSIGHT_APPLICATION_NATIVE_BASELINE_REQUIRED");
  if (previous !== null && !matching && !input.reset) throw new Error("HINDSIGHT_APPLICATION_RESET_REQUIRED");
  if (matching && (previous.bankDeleted || next.native_cursor < previous.checkpoint.native_cursor
    || next.state_cursor < previous.checkpoint.state_cursor)) throw new Error("HINDSIGHT_APPLICATION_CHECKPOINT_STALE");
  const native = input.expectedNativeCheckpoint;
  if (native && native.bankId === input.bankId && native.providerLineageId === input.namespace.provider_lineage
    && native.bankGeneration === input.namespace.bank_generation && next.native_cursor < native.endCursor) {
    throw new Error("HINDSIGHT_APPLICATION_CHECKPOINT_STALE");
  }
}

function assertEventPredecessor(input: HindsightApplicationEventInput): void {
  const previous = input.expectedCheckpoint;
  if (previous.bankDeleted || previous.bankId !== input.bankId || previous.authorityEpochId !== input.authorityEpochId
    || !sameApplicationValue(previous.namespace, input.namespace)
    || !sameApplicationValue(previous.checkpoint, input.event.manifest.from_checkpoint)
    || !sameApplicationValue(previous.native, input.expectedNativeCheckpoint)) throw new Error("HINDSIGHT_APPLICATION_CHECKPOINT_STALE");
}

function assertSnapshotFresh(state: HindsightApplicationReplicaState, input: HindsightApplicationSnapshotInput): void {
  const now = Date.parse(state.now());
  if (Date.parse(input.bundle.manifest.expires_at) <= now || input.nativeBaseline && Date.parse(input.nativeBaseline.expiresAt) <= now) {
    throw new Error("HINDSIGHT_SNAPSHOT_EXPIRED");
  }
}
function invalid(): never { throw new Error("HINDSIGHT_APPLICATION_REPLICA_PUBLICATION_INVALID"); }
