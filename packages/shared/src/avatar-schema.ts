/**
 * INPUT:  candidate avatar.* params/event payloads (parsed WS frames from a Pet UI operator)
 * OUTPUT: AVATAR_METHODS + AvatarSubscribe/Report/Command/Outcome schemas (LLM-driven expression/motion push channel
 *         plus the Pet UI's per-command Presentation Outcome report)
 * POS:    shared/protocol — the avatar command contract (invariants 3, 7); operator-only, NO Rust mirror (webview↔core)
 */
import { z } from "zod";

export const AVATAR_METHODS = {
  subscribe: "avatar.subscribe", // operator → core: start receiving this character's avatar commands
  report: "avatar.report", // operator → core: Pet UI reports its loaded model's motion/expression vocabulary
  command: "avatar.command", // core → operator: play this expression/motion now (identified by commandId)
  outcome: "avatar.outcome", // operator → core: the Pet UI's Presentation Outcome for one received command
} as const;

export const AvatarSubscribeParamsSchema = z.object({
  characterId: z.string().min(1),
});
export type AvatarSubscribeParams = z.infer<typeof AvatarSubscribeParamsSchema>;

export const AvatarSubscribeResultSchema = z.object({
  status: z.literal("ok"),
});
export type AvatarSubscribeResult = z.infer<typeof AvatarSubscribeResultSchema>;

// The Pet UI reports its loaded model's available names on load / costume-swap; the Core stores them per character
// and injects the valid names into the turn instructions (Option A — no baked enum, names come from the manifest).
// `costume` is the worn costume's stable id (arbeit / arbeit_ring_01); the Core diffs it across turns to inject a
// one-shot costume-change reminder (1f). Optional + operator-only, NO Rust mirror — undefined = no formal id available
// (boot / drift self-heal report), which the Core treats as "keep the known id" rather than a change.
export const AvatarReportParamsSchema = z.object({
  characterId: z.string().min(1),
  motions: z.array(z.string()), // motion group names (Object.keys(motionManager.definitions))
  expressions: z.array(z.string()), // expression names (expressionManager.definitions.map(d => d.name ?? d.Name))
  costume: z.string().optional(), // worn costume id (1f change-detection key); absent when no formal id is available
});
export type AvatarReportParams = z.infer<typeof AvatarReportParamsSchema>;

export const AvatarReportResultSchema = z.object({
  status: z.literal("ok"),
});
export type AvatarReportResult = z.infer<typeof AvatarReportResultSchema>;

// Core → Pet UI push (mirrors the timeline.appended fan-out). `kind` selects the engine call: expression() vs motion().
// `name` is a free string (Option A); the Pet UI validates it against its live model and degrades gracefully on a miss.
// `commandId` is Core-generated per command; the Pet UI echoes it in avatar.outcome so the tool's bounded wait resolves.
export const AvatarCommandSchema = z.object({
  characterId: z.string().min(1),
  commandId: z.string().min(1),
  kind: z.enum(["expression", "motion"]),
  name: z.string().min(1),
  // Optional motion knobs — the engine's motion() takes a priority + loop; ignored for an expression command.
  priority: z.enum(["idle", "normal", "force"]).optional(),
  loop: z.boolean().optional(),
});
export type AvatarCommand = z.infer<typeof AvatarCommandSchema>;

// Presentation Outcome vocabulary (CONTEXT.md). The Pet reports only what its engine decided (applied / rejected /
// superseded); `not_rendered` (no subscriber) and `unknown` (deadline, abort) are Core-derived and never reported.
export const AvatarOutcomeSchema = z.enum(["applied", "rejected", "superseded", "not_rendered", "unknown"]);
export type AvatarOutcome = z.infer<typeof AvatarOutcomeSchema>;

export const AvatarRejectReasonSchema = z.enum(["motion_busy", "speaking", "already_active", "unknown_name", "unavailable"]);
export type AvatarRejectReason = z.infer<typeof AvatarRejectReasonSchema>;

export const AvatarOutcomeParamsSchema = z.object({
  characterId: z.string().min(1),
  commandId: z.string().min(1),
  outcome: z.enum(["applied", "rejected", "superseded"]),
  reason: AvatarRejectReasonSchema.optional(),
});
export type AvatarOutcomeParams = z.infer<typeof AvatarOutcomeParamsSchema>;

export const AvatarOutcomeResultSchema = z.object({
  status: z.literal("ok"),
});
export type AvatarOutcomeResult = z.infer<typeof AvatarOutcomeResultSchema>;
