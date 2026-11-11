/**
 * INPUT:  captured authority/Bank leases, joint bundles/events and exact application evidence requests
 * OUTPUT: application publication, lexical snapshots and paged eligible assessment/deferred-work contracts
 * POS:    core/db — internal D77 repository API; shared native wire shapes remain the only transport contract
 */
import { z } from "zod";
import { MemoryBankScopeSchema, MemoryReplicaCheckpointSchema, TakiApplicationCheckpointSchema,
  TakiApplicationIdSchema, TakiApplicationNamespaceSchema, TakiApplicationNativeHeadSchema, TakiApplicationTimeSchema,
  type CanonicalMemoryBank, type CanonicalMemoryRecord,
  type HindsightLogicalSnapshotMetadata, type MemoryBankScope, type MemoryReplicaBank, type MemoryReplicaCheckpoint,
  type MemoryReplicaLease, type TakiApplicationArtifact, type TakiApplicationArtifactKey, type TakiApplicationArtifactVersion,
  type TakiApplicationBodyRef, type TakiApplicationMemoryBody, type TakiApplicationNativeHead,
  type HindsightApplicationReplicaRecord } from "@taki/shared";
import type { HindsightApplicationBody, HindsightApplicationBundle, HindsightApplicationEvent } from "../memory/hindsight/hindsight-application-bundle.ts";
import type { HindsightApplicationScope } from "../memory/hindsight/hindsight-application-integrity.ts";
import type { SearchTokenizer } from "../memory/search-tokenizer.ts";
import type { Database } from "./sqlite.ts";
import type { HindsightReplicaLeaseRepo } from "./hindsight-replica-lease-repo.ts";
import type { ReplicaRecordRead, ReplicaRecordStore } from "./hindsight-replica-record-store.ts";
import type { createApplicationEvidenceAccess } from "./hindsight-application-replica-evidence.ts";

const Id = z.string().min(1).max(256); const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const HindsightApplicationReplicaCheckpointSchema = z.strictObject({
  namespace: TakiApplicationNamespaceSchema, bankId: Id, authorityEpochId: Id, bankScope: MemoryBankScopeSchema,
  checkpoint: TakiApplicationCheckpointSchema, native: MemoryReplicaCheckpointSchema,
  snapshot: z.strictObject({ id: z.uuid(), manifestHash: Hash, checkpoint: TakiApplicationCheckpointSchema }),
  publication: z.strictObject({ kind: z.enum(["snapshot", "event"]), id: Id, hash: Hash }),
  verifiedAt: TakiApplicationTimeSchema, bankDeleted: z.boolean(),
}).superRefine((value, context) => {
  const native = value.native;
  if (native.bankId !== value.bankId || native.authorityEpochId !== value.authorityEpochId
    || native.providerLineageId !== value.namespace.provider_lineage || native.bankGeneration !== value.namespace.bank_generation
    || native.endCursor !== value.checkpoint.native_cursor || native.verifiedAt !== value.verifiedAt
    || value.snapshot.checkpoint.native_cursor > value.checkpoint.native_cursor
    || value.snapshot.checkpoint.state_cursor > value.checkpoint.state_cursor) {
    context.addIssue({ code: "custom", message: "application and native checkpoint identities disagree" });
  }
});
export type HindsightApplicationReplicaCheckpoint = z.infer<typeof HindsightApplicationReplicaCheckpointSchema>;

export interface HindsightApplicationPublicationInput extends HindsightApplicationScope {
  authorityEpochId: string;
  expectedBank: MemoryReplicaBank;
  expectedCheckpoint: HindsightApplicationReplicaCheckpoint | null;
  expectedNativeCheckpoint: MemoryReplicaCheckpoint | null;
  lease: MemoryReplicaLease;
  deadlineAt: string;
}
export interface HindsightApplicationSnapshotInput extends HindsightApplicationPublicationInput {
  bundle: HindsightApplicationBundle;
  nativeBaseline?: HindsightLogicalSnapshotMetadata;
  /** An explicit verified namespace/cursor reset, never an Authority activation. */
  reset?: boolean;
}
export interface HindsightApplicationEventInput extends HindsightApplicationPublicationInput {
  event: HindsightApplicationEvent;
  expectedCheckpoint: HindsightApplicationReplicaCheckpoint;
}

export const HindsightApplicationWorkCursorSchema = z.strictObject({
  namespace: TakiApplicationNamespaceSchema, bankId: Id, stateCursor: z.int().min(0),
  objectKind: TakiApplicationNativeHeadSchema.shape.object_kind, objectId: TakiApplicationIdSchema,
});
export type HindsightApplicationWorkCursor = z.infer<typeof HindsightApplicationWorkCursorSchema>;

export interface HindsightApplicationBindingWork {
  cursor: HindsightApplicationWorkCursor;
  head: TakiApplicationNativeHead;
  artifact: TakiApplicationArtifact | null;
  memory: TakiApplicationMemoryBody | null;
}
export interface HindsightApplicationBankBinding {
  namespace: HindsightApplicationScope["namespace"];
  bankId: string;
  authorityEpochId: string;
  scope: MemoryBankScope;
  bindingState: TakiApplicationNativeHead["binding_state"];
  bankDeleted: boolean;
  bank: CanonicalMemoryBank | undefined;
}

export interface HindsightApplicationReplicaRepo {
  /** Read-only synchronous callback; captured guards/evidence expire when it returns or throws. */
  readSnapshot<T>(read: (replica: HindsightApplicationReplicaReader) => T): T;
  leases: HindsightReplicaLeaseRepo;
  seedVerifiedSnapshot(input: HindsightApplicationSnapshotInput): HindsightApplicationReplicaCheckpoint;
  reconcileVerifiedSnapshot(input: HindsightApplicationSnapshotInput): HindsightApplicationReplicaCheckpoint;
  applyEvent(input: HindsightApplicationEventInput): HindsightApplicationReplicaCheckpoint;
  checkpoint(bankId: string): HindsightApplicationReplicaCheckpoint | undefined;
  nativeCheckpoint(bankId: string): MemoryReplicaCheckpoint | undefined;
  nativeHead(input: HindsightApplicationScope & { objectKind: TakiApplicationNativeHead["object_kind"]; objectId: string }): TakiApplicationNativeHead | undefined;
  artifact(input: HindsightApplicationScope & { version: TakiApplicationArtifactVersion }): TakiApplicationArtifact | undefined;
  latestArtifact(input: HindsightApplicationScope & { key: TakiApplicationArtifactKey }): TakiApplicationArtifact | undefined;
  /** Candidate source evidence only: these envelopes do not prove successful or current native source association. */
  sourceArtifacts(input: HindsightApplicationScope & { documentId?: string; bindingKind?: "awaiting_native" | "exact_native" }): TakiApplicationArtifact[];
  blockArtifacts(input: HindsightApplicationScope): TakiApplicationArtifact[];
  body(input: HindsightApplicationScope & { bodyId: string }): HindsightApplicationBody | undefined;
  /** Immutable bytes may be resumed before publication; neither method publishes native heads or a checkpoint. */
  cachedBody(input: HindsightApplicationPublicationInput & { ref: TakiApplicationBodyRef }): HindsightApplicationBody | undefined;
  /** One independently guarded synchronous lookup over the existing immutable stores. */
  cachedBodies(input: HindsightApplicationPublicationInput & { refs: readonly TakiApplicationBodyRef[] }): Map<string, HindsightApplicationBody>;
  cacheBodies(input: HindsightApplicationPublicationInput & { bodies: readonly HindsightApplicationBody[] }): void;
  bankBinding(bankId: string): HindsightApplicationBankBinding | undefined;
  logicalRecord(input: HindsightApplicationScope & ReplicaRecordRead): HindsightApplicationReplicaRecord | undefined;
  record(input: HindsightApplicationScope & { memoryId: string; includeInvalidated?: boolean; includeHidden?: boolean }): CanonicalMemoryRecord | undefined;
  search(input: HindsightApplicationScope & {
    query: string; limit: number; at?: string; layerIds?: string[]; factTypes?: CanonicalMemoryRecord["unit"]["factType"][];
  }): CanonicalMemoryRecord[];
  /** Returns the complete eligible set or refuses overflow; never silently omits a non-truncatable pin. */
  pinned(input: HindsightApplicationScope & { limit: number; at?: string }): CanonicalMemoryRecord[];
  bindingWork(input: HindsightApplicationScope & { limit: number; after?: HindsightApplicationWorkCursor;
    objectKind?: TakiApplicationNativeHead["object_kind"] }): HindsightApplicationBindingWork[];
  duePolicyWork(input: HindsightApplicationScope & {
    limit: number; at?: string; eligibleForMaintenance?: boolean; includeDeferred?: boolean; after?: HindsightApplicationWorkCursor;
  }): HindsightApplicationBindingWork[];
}

export type HindsightApplicationReplicaReader = Pick<HindsightApplicationReplicaRepo,
  "readSnapshot" | "checkpoint" | "nativeCheckpoint" | "nativeHead" | "artifact" | "latestArtifact" |
  "sourceArtifacts" | "blockArtifacts" | "body" | "bankBinding" | "logicalRecord" | "record" |
  "search" | "pinned" | "bindingWork" | "duePolicyWork">;

export interface HindsightApplicationReplicaDeps {
  db: Database;
  tokenizer: SearchTokenizer;
  /** Reads current trusted routing on each call, including the final transaction guard after HTTP work. */
  bankScope(bankId: string): MemoryBankScope;
  now?: () => string;
}
export interface HindsightApplicationReplicaState extends Omit<HindsightApplicationReplicaDeps, "now"> {
  now(): string;
  leases: HindsightReplicaLeaseRepo;
  records: ReplicaRecordStore;
  /** Present only in a lexical read callback; never supplied to publication or command owners. */
  read?: {
    assertOpen(): void;
    checkpoint(bankId: string): HindsightApplicationReplicaCheckpoint | undefined;
    evidence(scope: HindsightApplicationScope): ReturnType<typeof createApplicationEvidenceAccess>;
  };
}

export interface HindsightApplicationEvidenceAccess {
  body(ref: TakiApplicationBodyRef): HindsightApplicationBody;
  artifact(version: TakiApplicationArtifactVersion): TakiApplicationArtifact;
}
