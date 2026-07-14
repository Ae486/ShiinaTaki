/**
 * INPUT:  candidate avatar.* params/event payloads (parsed WS frames from a Pet UI operator)
 * OUTPUT: AVATAR_METHODS + AvatarSubscribe/Report/Command schemas (LLM-driven expression/motion push channel)
 * POS:    shared/protocol — the avatar command contract (invariants 3, 7); operator-only, NO Rust mirror (webview↔core)
 */
import { z } from "zod";

export const AVATAR_METHODS = {
  subscribe: "avatar.subscribe", // operator → core: start receiving this character's avatar commands
  report: "avatar.report", // operator → core: Pet UI reports its loaded model's motion/expression vocabulary
  command: "avatar.command", // core → operator: play this expression/motion now (fire-and-forget push)
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
export const AvatarReportParamsSchema = z.object({
  characterId: z.string().min(1),
  motions: z.array(z.string()), // motion group names (Object.keys(motionManager.definitions))
  expressions: z.array(z.string()), // expression names (expressionManager.definitions.map(d => d.name ?? d.Name))
});
export type AvatarReportParams = z.infer<typeof AvatarReportParamsSchema>;

export const AvatarReportResultSchema = z.object({
  status: z.literal("ok"),
});
export type AvatarReportResult = z.infer<typeof AvatarReportResultSchema>;

// Core → Pet UI push (mirrors the timeline.appended fan-out). `kind` selects the engine call: expression() vs motion().
// `name` is a free string (Option A); the Pet UI validates it against its live model and degrades gracefully on a miss.
export const AvatarCommandSchema = z.object({
  characterId: z.string().min(1),
  kind: z.enum(["expression", "motion"]),
  name: z.string().min(1),
  // Optional motion knobs — the engine's motion() takes a priority + loop; ignored for an expression command.
  priority: z.enum(["idle", "normal", "force"]).optional(),
  loop: z.boolean().optional(),
});
export type AvatarCommand = z.infer<typeof AvatarCommandSchema>;
