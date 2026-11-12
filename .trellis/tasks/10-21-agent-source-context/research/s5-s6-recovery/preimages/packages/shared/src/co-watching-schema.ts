/**
 * INPUT: explicit operator Co-Watching configuration/control and Core-produced state
 * OUTPUT: strict reference-only acceptance, bounded plan and disposable UI contracts
 * POS: shared/protocol — no media observation, model plan or catalog row creates publication authority
 */
import { z } from "zod";
import { BrowserMediaIdentitySchema, BrowserPlaybackViewSchema } from "./browser-playback-schema.ts";
import { McpServerIdSchema } from "./mcp-lifecycle-schema.ts";

export const CO_WATCHING_METHODS = { read: "coWatching.read", start: "coWatching.start", stop: "coWatching.stop",
  revise: "coWatching.revise", subscribe: "coWatching.subscribe", changed: "coWatching.changed",
  catalog: "coWatching.catalog.list", register: "coWatching.catalog.register", remove: "coWatching.catalog.remove" } as const;
export const CO_WATCHING_SKILL = "taki-co-watching";
const Id = z.uuid();
const Character = z.string().min(1).max(160);
export const CoWatchingAnalysisSchema = z.strictObject({
  analysisId: Id, revision: z.int().positive(), title: z.string().trim().min(1).max(240),
  media: BrowserMediaIdentitySchema, serverId: McpServerIdSchema,
  native: z.strictObject({ serviceInstanceId: Id, requestId: Id, jobId: Id, sha256: z.string().regex(/^[0-9a-f]{64}$/) }),
});
export type CoWatchingAnalysis = z.infer<typeof CoWatchingAnalysisSchema>;
// Retain original submission identity before dispatch. Native lifecycle/status remains owned by BiliNote.
export const CoWatchingAnalysisRequestSchema = z.strictObject({ analysisId: Id, requestId: Id,
  serverId: McpServerIdSchema, media: BrowserMediaIdentitySchema,
  identity: z.strictObject({ serviceInstanceId: Id, jobId: Id }).nullable() });
export type CoWatchingAnalysisRequest = z.infer<typeof CoWatchingAnalysisRequestSchema>;
export const CoWatchingCatalogSchema = z.strictObject({ schemaVersion: z.literal("co-watching.catalog.v1"),
  entries: z.array(CoWatchingAnalysisSchema).max(64), requests: z.array(CoWatchingAnalysisRequestSchema).max(64).default([]) });
export const CoWatchingRegisterSchema = CoWatchingAnalysisSchema.omit({ revision: true }).extend({ expectedRevision: z.int().nonnegative() });
export type CoWatchingRegister = z.infer<typeof CoWatchingRegisterSchema>;
export const CoWatchingRemoveSchema = z.strictObject({ analysisId: Id, expectedRevision: z.int().positive() });
export const CoWatchingReadParamsSchema = z.strictObject({ characterId: Character });
export const CoWatchingSubscribeSchema = CoWatchingReadParamsSchema;
export const CoWatchingStartSchema = z.strictObject({ characterId: Character, requestId: Id, sourceRef: Id,
  analysisId: Id, lifetimeMinutes: z.int().min(5).max(720) });
export type CoWatchingStart = z.infer<typeof CoWatchingStartSchema>;
export const CoWatchingInviteSchema = CoWatchingStartSchema.omit({ analysisId: true }).extend({ reanalyze: z.boolean().optional() });
export type CoWatchingInvite = z.infer<typeof CoWatchingInviteSchema>;
export const CoWatchingStopSchema = z.strictObject({ characterId: Character, sessionId: Id });
export const CoWatchingReviseSchema = CoWatchingStopSchema.extend({ instruction: z.string().trim().min(1).max(4_000) });
export const CoWatchingChangedSchema = z.strictObject({ characterId: Character, revision: z.int().positive() });
export type CoWatchingChanged = z.infer<typeof CoWatchingChangedSchema>;
export const CoWatchingSubscribeResultSchema = z.strictObject({ ok: z.literal(true) });
export const CoWatchingPlanSchema = z.strictObject({ revision: Id, candidates: z.array(z.strictObject({
  candidateRef: z.string().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/), momentId: z.string().min(1).max(160),
  text: z.string().min(1).max(2_000).refine((value) => value.trim() === value, "Text must be canonical"),
})).max(24) }).refine((value) => new Set(value.candidates.map((item) => item.candidateRef)).size === value.candidates.length,
  "Candidate references must be unique");
export type CoWatchingPlan = z.infer<typeof CoWatchingPlanSchema>;
export const CoWatchingStatusSchema = z.enum(["starting", "analyzing", "reading", "preparing", "ready", "revising", "stopped", "failed"]);
export const CoWatchingFailureSchema = z.enum(["source_lost", "authority_changed", "analysis_unavailable", "analysis_mismatch",
  "skill_unavailable", "analysis_failed", "analysis_unknown", "preparation_failed", "plan_invalid", "expired", "stopped", "shutdown"]);
export type CoWatchingFailure = z.infer<typeof CoWatchingFailureSchema>;
export const CoWatchingSessionSchema = z.strictObject({ sessionId: Id, sourceRef: Id, analysisId: Id, title: z.string(),
  status: CoWatchingStatusSchema, reason: CoWatchingFailureSchema.nullable(), expiresAt: z.iso.datetime(),
  preparedCount: z.int().nonnegative().nullable(), sentCount: z.int().nonnegative(), pendingRevision: z.boolean() });
export type CoWatchingSession = z.infer<typeof CoWatchingSessionSchema>;
export const CoWatchingReadResultSchema = z.strictObject({ characterId: Character, enabled: z.boolean(),
  sources: z.array(BrowserPlaybackViewSchema), analyses: z.array(CoWatchingAnalysisSchema.pick({ analysisId: true, title: true, media: true })),
  session: CoWatchingSessionSchema.nullable() });
export type CoWatchingReadResult = z.infer<typeof CoWatchingReadResultSchema>;
export const CoWatchingControlResultSchema = z.discriminatedUnion("accepted", [
  z.strictObject({ accepted: z.literal(true), session: CoWatchingSessionSchema }),
  z.strictObject({ accepted: z.literal(false), reason: z.enum(["not_ready", "already_active", "request_conflict", "not_found", "busy"]) }),
]);
export type CoWatchingControlResult = z.infer<typeof CoWatchingControlResultSchema>;
