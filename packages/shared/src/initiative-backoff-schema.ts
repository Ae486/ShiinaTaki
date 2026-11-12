/**
 * INPUT: Core-owned qualified feedback and canonical Class B admission policy
 * OUTPUT: bounded semantic backoff status and explicit operator reset parameters
 * POS: shared/protocol — no message content, source identity or independent quota authority
 */
import { z } from "zod";

const Count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Timestamp = z.string().datetime({ offset: true });
const CharacterId = z.string().min(1).max(200);
export const INITIATIVE_BACKOFF_METHODS = {
  read: "observability.initiative-backoff",
  reset: "initiative.backoff.reset",
  changed: "observability.initiative-backoff-changed",
} as const;
export const InitiativeBackoffReadParamsSchema = z.strictObject({ characterId: CharacterId });
export type InitiativeBackoffReadParams = z.infer<typeof InitiativeBackoffReadParamsSchema>;
export const InitiativeBackoffChangedSchema = z.strictObject({ characterId: CharacterId });
export type InitiativeBackoffChanged = z.infer<typeof InitiativeBackoffChangedSchema>;
export const InitiativeBackoffStatusSchema = z.strictObject({
  stage: z.enum(["normal", "double", "quadruple", "daily"]),
  qualifiedWeakCount: Count,
  spacingMultiplier: z.union([z.literal(1), z.literal(2), z.literal(4)]),
  dailyJudgments: Count,
  nextEligibleAt: Timestamp.nullable(),
  refusal: z.enum(["backoff-spacing", "backoff-daily"]).nullable(),
  lastResetAt: Timestamp.nullable(),
  lastResetReason: z.enum(["user-engagement", "operator"]).nullable(),
  windowSince: Timestamp,
  observedAt: Timestamp,
});
export type InitiativeBackoffStatus = z.infer<typeof InitiativeBackoffStatusSchema>;
export const InitiativeBackoffResetParamsSchema = z.strictObject({ characterId: CharacterId });
export type InitiativeBackoffResetParams = z.infer<typeof InitiativeBackoffResetParamsSchema>;
