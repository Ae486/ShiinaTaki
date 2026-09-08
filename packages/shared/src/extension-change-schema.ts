/**
 * INPUT:  extension operator subscription requests and bounded producer invalidations
 * OUTPUT: strict subscription acknowledgement, change targets and process-local revision schemas/types
 * POS:    shared/protocol — operator-to-Core only; hints contain no catalog content or execution authority
 */
import { z } from "zod";

export const EXTENSION_CHANGE_TARGETS = ["mcp", "skills", "extension-status"] as const;
export const ExtensionChangeTargetSchema = z.enum(EXTENSION_CHANGE_TARGETS);
export type ExtensionChangeTarget = z.infer<typeof ExtensionChangeTargetSchema>;

export const ExtensionSubscribeParamsSchema = z.strictObject({});
export type ExtensionSubscribeParams = z.infer<typeof ExtensionSubscribeParamsSchema>;
export const ExtensionSubscribeResultSchema = z.strictObject({ status: z.literal("ok") });
export type ExtensionSubscribeResult = z.infer<typeof ExtensionSubscribeResultSchema>;

// Ordering belongs to this process/channel, not an atomic list/status snapshot, durable cursor or permission.
export const ExtensionChangedSchema = z.strictObject({
  revision: z.int().nonnegative(),
  targets: z.array(ExtensionChangeTargetSchema).min(1).max(EXTENSION_CHANGE_TARGETS.length)
    .refine((targets) => new Set(targets).size === targets.length, "extension change targets must be unique"),
});
export type ExtensionChanged = z.infer<typeof ExtensionChangedSchema>;
