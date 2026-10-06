/**
 * INPUT:  authenticated healthy previews and the original Core/native transition journals
 * OUTPUT: strict preview, progress and durable dispatch evidence for healthy operation drivers
 * POS:    shared/protocol — status remains readable under Local and committed-but-unbound authority
 */
import { z } from "zod";
import { MemoryTransitionIdentitySchema, MemoryTransitionStatusSchema } from "./memory-transition-schema.ts";
import { HindsightTransitionAcquireSchema, HindsightTransitionClaimSchema, HindsightTransitionOutcomeRequestSchema,
  HindsightTransitionStatusSchema } from "./hindsight-transition-schema.ts";
import { TakiApplicationSnapshotRequestSchema } from "./hindsight-application-read-schema.ts";
import { MemoryEmergencyBankCoverageSchema } from "./memory-transition-emergency-schema.ts";

const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Id = z.string().min(1).max(256);
const Time = z.iso.datetime({ offset: true });
export const MemoryHealthyTransitionKindSchema = z.enum(["transition.return-local", "transition.reenter-hindsight"]);
export const MEMORY_TRANSITION_METHODS = { preview: "memory.transitions.preview", status: "memory.transitions.status", overview: "memory.transitions.overview" } as const;
export const MemoryTransitionPreviewParamsSchema = z.strictObject({ kind: z.enum(["transition.return-local", "transition.reenter-hindsight", "transition.emergency-local"]),
  recoveryTransitionId: z.uuid().optional() });
export const MemoryHealthyTransitionPreviewSchema = z.strictObject({ version: z.literal(1), previewId: z.uuid(),
  kind: MemoryHealthyTransitionKindSchema, previewHash: Hash, expected: MemoryTransitionIdentitySchema,
  actorId: Id, createdAt: Time, expiresAt: Time, capabilityHash: Hash,
    recovery: z.strictObject({ transitionId: z.uuid(), expectedReceiptId: Hash.nullable(), expectedGeneration: z.int().min(1) }).nullable() });
/** Offline disclosure has no capability certificate or claimed remote loss bound. */
export const MemoryEmergencyTransitionPreviewSchema = z.strictObject({ ...MemoryHealthyTransitionPreviewSchema.shape,
  version: z.literal(2), kind: z.literal("transition.emergency-local"), capabilityHash: z.null(),
  expected: MemoryTransitionIdentitySchema.nullable(), takeover: z.enum(["eligible", "refused"]),
  inventory: z.enum(["complete", "unreadable"]),
  banks: z.array(MemoryEmergencyBankCoverageSchema.omit({ survivingEvidenceId: true }).extend({ bankId: Id.nullable() })).max(1024),
  lastVerifiedBackupId: z.uuid().nullable(), backupAgeSeconds: z.int().nonnegative().nullable(),
  blocking: z.array(z.enum(["source-unavailable", "scope-unmapped", "incomplete-replica", "inventory-unreadable"])),
  offline: z.literal(true), remoteHead: z.literal("unknown"), remoteLoss: z.literal("unknown"),
}).refine((value) => (value.takeover === "eligible") === (value.expected !== null && value.blocking.length === 0), "only complete identity permits confirmation");
export const MemoryTransitionPreviewSchema = z.union([MemoryHealthyTransitionPreviewSchema, MemoryEmergencyTransitionPreviewSchema]);
export type MemoryHealthyTransitionPreview = z.infer<typeof MemoryHealthyTransitionPreviewSchema>;
export type MemoryEmergencyTransitionPreview = z.infer<typeof MemoryEmergencyTransitionPreviewSchema>;
export type MemoryTransitionPreview = z.infer<typeof MemoryTransitionPreviewSchema>;
export const MemoryTransitionDriverBankSchema = z.strictObject({ version: z.literal(1), transitionId: z.uuid(),
  sourceBankId: Id, nativeBankId: Id, identityHash: Hash });
export type MemoryTransitionDriverBank = z.infer<typeof MemoryTransitionDriverBankSchema>;
const CommandBase = { version: z.literal(1), commandId: Hash, transitionId: z.uuid(), bankId: Id,
  slot: Id, preparedAt: Time };
export const MemoryTransitionNativeCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...CommandBase, kind: z.literal("acquire"), request: HindsightTransitionAcquireSchema }),
  z.strictObject({ ...CommandBase, kind: z.literal("claim"), request: HindsightTransitionClaimSchema }),
  z.strictObject({ ...CommandBase, kind: z.literal("decision"), request: HindsightTransitionOutcomeRequestSchema }),
  z.strictObject({ ...CommandBase, kind: z.literal("application-snapshot"), request: TakiApplicationSnapshotRequestSchema }),
]);
export type MemoryTransitionNativeCommand = z.infer<typeof MemoryTransitionNativeCommandSchema>;
export const MemoryTransitionNativeObservationSchema = z.strictObject({ version: z.literal(1), observationId: Hash,
  transitionId: z.uuid(), bankId: Id, observedAt: Time, status: HindsightTransitionStatusSchema });
export type MemoryTransitionNativeObservation = z.infer<typeof MemoryTransitionNativeObservationSchema>;
export const MemoryTransitionUndispatchedSchema = z.strictObject({ version: z.literal(1), evidenceId: Hash,
  transitionId: z.uuid(), bankId: Id, sourceBankId: Id, identityHash: Hash,
  disposition: z.literal("never-dispatched"), recordedAt: Time });
export type MemoryTransitionUndispatched = z.infer<typeof MemoryTransitionUndispatchedSchema>;
export const MemoryTransitionProgressSchema = z.strictObject({
  phase: z.enum(["admitted", "draining", "fenced", "proven", "committed", "binding", "settling", "terminal"]).nullable(),
  banks: z.array(z.strictObject({ sourceBankId: Id, nativeBankId: Id.nullable(),
    dispatch: z.enum(["unprepared", "prepared", "sent", "never-dispatched"]),
    nativePhase: HindsightTransitionStatusSchema.shape.phase.nullable(), activeWriters: z.int().nonnegative().nullable(),
    acceptedOperations: z.int().nonnegative().nullable(), finalProof: z.boolean(), finalized: z.boolean() })).max(1024),
  queue: z.strictObject({ admitted: z.int().nonnegative(), settled: z.int().nonnegative(), unknown: z.int().nonnegative() }),
  runtime: z.enum(["source", "ready", "unavailable"]), nativeReleasePending: z.boolean(),
});
export const MemoryTransitionReadParamsSchema = z.strictObject({ transitionId: z.uuid() });
export const MemoryTransitionReadSchema = z.strictObject({ transition: MemoryTransitionStatusSchema,
  progress: MemoryTransitionProgressSchema, recoverable: z.boolean() });
export type MemoryTransitionRead = z.infer<typeof MemoryTransitionReadSchema>;
