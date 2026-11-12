/**
 * INPUT: committed Core invitation projections and explicit operator accept/defer commands
 * OUTPUT: reference-only contextual controls with exact revision and command identity
 * POS: shared/protocol — playback, model text and UI visibility never constitute consent
 */
import { z } from "zod";
import { BrowserMediaIdentitySchema } from "./browser-playback-schema.ts";
import { CoWatchingSessionSchema } from "./co-watching-schema.ts";

export const CO_WATCHING_INVITATION_METHODS = {
  read: "coWatching.invitation.read", respond: "coWatching.invitation.respond",
} as const;
export const CoWatchingInvitationReadParamsSchema = z.strictObject({ characterId: z.string().min(1).max(160) });
export const CoWatchingInvitationSchema = z.strictObject({
  invitationId: z.uuid(), version: z.int().nonnegative(), characterId: z.string().min(1).max(160),
  media: BrowserMediaIdentitySchema, title: z.string().min(1).max(240),
  timelineSeq: z.int().positive(), expiresAt: z.iso.datetime(),
});
export type CoWatchingInvitation = z.infer<typeof CoWatchingInvitationSchema>;
export const CoWatchingInvitationReadResultSchema = z.strictObject({
  characterId: z.string().min(1).max(160), invitation: CoWatchingInvitationSchema.nullable(),
});
export type CoWatchingInvitationReadResult = z.infer<typeof CoWatchingInvitationReadResultSchema>;
export const CoWatchingInvitationRespondSchema = z.strictObject({
  characterId: z.string().min(1).max(160), invitationId: z.uuid(),
  expectedVersion: z.int().nonnegative(), commandId: z.uuid(), action: z.enum(["accept", "defer"]),
});
export type CoWatchingInvitationRespond = z.infer<typeof CoWatchingInvitationRespondSchema>;
export const CoWatchingInvitationRespondResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("applied"), action: z.enum(["accept", "defer"]), session: CoWatchingSessionSchema.nullable() })
    .refine((value) => value.action === "accept" ? value.session !== null : value.session === null,
      "Acceptance requires the actual resulting session; deferral creates none"),
  z.strictObject({ status: z.literal("refused"), reason: z.enum([
    "not_found", "stale", "already_handled", "not_ready", "command_conflict", "unavailable",
  ]) }),
]);
export type CoWatchingInvitationRespondResult = z.infer<typeof CoWatchingInvitationRespondResultSchema>;
