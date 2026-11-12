/**
 * INPUT: committed model usage and the current primary-summary boundary.
 * OUTPUT: bounded whole-window cache statistics and their operator subscription protocol.
 * POS: shared/protocol — counts only; no prompts, provider payloads or execution authority.
 */
import { z } from "zod";
import { CharacterIdSchema } from "./character-schema.ts";
import { LatestPrimaryRequestSnapshotSchema } from "./request-attribution-schema.ts";

const Count = z.int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const Timestamp = z.iso.datetime({ offset: true });

export const CACHE_USAGE_METHODS = {
  subscribe: "observability.cacheUsageSubscribe",
  unsubscribe: "observability.cacheUsageUnsubscribe",
  changed: "observability.cacheUsageChanged",
} as const;

export const CacheUsageWindowSnapshotSchema = z.strictObject({
  scope: z.enum(["all-observed-model-requests", "regular-model-requests"]),
  characterId: CharacterIdSchema,
  summaryRevision: Count.nullable(),
  summaryCommittedAt: Timestamp.nullable(),
  boundary: z.enum(["before-first-summary", "captured", "historical"]).nullable(),
  status: z.enum(["ready", "empty", "unavailable"]),
  computedAt: Timestamp,
  observedRequests: Count.nullable(),
  pairedRequests: Count.nullable(),
  inputTokens: Count.nullable(),
  cacheReadTokens: Count.nullable(),
  ratio: z.number().finite().min(0).max(1).nullable(),
  reason: z.enum(["boundary-unknown", "data-inconsistent", "read-failed", "monitor-disabled"]).nullable(),
}).superRefine((value, context) => {
  const issue = (message: string) => context.addIssue({ code: "custom", message });
  const counts = [value.observedRequests, value.pairedRequests, value.inputTokens, value.cacheReadTokens];
  if (value.status === "unavailable") {
    if (counts.some((count) => count !== null) || value.ratio !== null || value.reason === null) {
      issue("unavailable statistics require a reason and unknown counts");
    }
    return;
  }
  if (counts.some((count) => count === null) || value.summaryRevision === null || value.boundary === null || value.reason !== null) {
    issue("available statistics require a complete boundary and counts");
    return;
  }
  if ((value.summaryRevision === 0) !== (value.boundary === "before-first-summary")
      || (value.summaryRevision === 0) !== (value.summaryCommittedAt === null)) {
    issue("summary identity must match its boundary");
  }
  const { observedRequests, pairedRequests, inputTokens, cacheReadTokens } = value;
  if (observedRequests === null || pairedRequests === null || inputTokens === null || cacheReadTokens === null) return;
  if (pairedRequests > observedRequests || cacheReadTokens > inputTokens) issue("paired counts exceed their population");
  if (value.status === "empty") {
    if (pairedRequests !== 0 || inputTokens !== 0 || cacheReadTokens !== 0 || value.ratio !== null) {
      issue("empty statistics have no eligible input");
    }
  } else if (pairedRequests === 0 || inputTokens === 0 || value.ratio === null
      || Math.abs(value.ratio - cacheReadTokens / inputTokens) > Number.EPSILON) {
    issue("ready ratio must equal paired cache divided by paired input");
  }
});
export type CacheUsageWindowSnapshot = z.infer<typeof CacheUsageWindowSnapshotSchema>;

export const CacheUsageUpdateSchema = z.strictObject({ revision: Count, snapshot: CacheUsageWindowSnapshotSchema,
  latestPrimaryRequest: LatestPrimaryRequestSnapshotSchema.optional() }).refine(
  (update) => update.latestPrimaryRequest === undefined || update.latestPrimaryRequest.characterId === update.snapshot.characterId,
  "cache and latest request projections require the same Character scope");
export type CacheUsageUpdate = z.infer<typeof CacheUsageUpdateSchema>;
export const CacheUsageSubscribeParamsSchema = z.strictObject({ characterId: CharacterIdSchema });
export type CacheUsageSubscribeParams = z.infer<typeof CacheUsageSubscribeParamsSchema>;
export const CacheUsageUnsubscribeParamsSchema = z.strictObject({});
export const CacheUsageUnsubscribeResultSchema = z.strictObject({ status: z.literal("ok") });
