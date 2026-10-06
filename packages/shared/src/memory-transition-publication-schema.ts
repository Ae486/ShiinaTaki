/**
 * INPUT:  persisted final candidate, exact source custody and ordered admitted obligations
 * OUTPUT: immutable transition publication and factual source disposition contracts
 * POS:    shared memory protocol — distinct from initial Local and first Hindsight activation receipts
 */
import { z } from "zod";

const Id = z.string().min(1).max(256);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
export const MemoryTransitionCustodySchema = z.strictObject({
  epochId: Id, provider: z.enum(["local", "hindsight"]),
  groups: z.array(z.strictObject({ groupId: Id, characterId: Id, state: z.enum(["open", "finalized"]),
    members: z.array(z.strictObject({ seq: z.int().positive(), entryId: Id, digest: Hash })) })),
  witnesses: z.array(z.strictObject({ seq: z.int().positive(), characterId: Id, entryId: Id, digest: Hash,
    throughSeq: z.int().positive(), runId: Id.nullable(), committedAt: z.iso.datetime({ offset: true }) })),
});
export type MemoryTransitionCustody = z.infer<typeof MemoryTransitionCustodySchema>;
export const MemoryTransitionSourceDispositionSchema = z.strictObject({
  sourceHash: Hash, operationId: Id, pendingHash: Hash, parentHash: Hash.nullable(),
  disposition: z.enum(["not-dispatched", "refused"]),
});
export type MemoryTransitionSourceDisposition = z.infer<typeof MemoryTransitionSourceDispositionSchema>;
export const MemoryTransitionPublicationSchema = z.strictObject({
  version: z.literal(1), publicationId: Hash, transitionId: z.uuid(), receiptId: Hash,
  candidateId: Hash, baselineId: Hash, proofId: Hash, sourceCustody: MemoryTransitionCustodySchema,
  custodyAssignmentHash: Hash, sourceDispositions: z.array(MemoryTransitionSourceDispositionSchema),
  queue: z.array(z.strictObject({ intentId: z.uuid(), replayId: z.uuid(), sequence: z.int().positive(), commandHash: Hash })),
  checkpoints: z.array(z.strictObject({ bankId: Id, evidenceId: Hash, nativeSnapshotId: Id,
    applicationSnapshotId: Id, nativeCursor: z.int().nonnegative(), applicationCursor: z.int().nonnegative(),
    checkpointHash: Hash.nullable() })),
});
export type MemoryTransitionPublication = z.infer<typeof MemoryTransitionPublicationSchema>;
