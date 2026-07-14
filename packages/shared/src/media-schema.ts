/**
 * INPUT:  candidate media.* params/result payloads (parsed WS frames from a Pet UI operator)
 * OUTPUT: MEDIA_METHODS + MediaGet/Clear/Usage param & result schemas (attachment byte serving + lifecycle)
 * POS:    shared/protocol — the attachment media contract (invariants 3, 7); operator-only, NO Rust mirror (webview↔core)
 */
import { z } from "zod";
import { IMAGE_MEDIA_TYPES } from "./chat-schema.ts";

export const MEDIA_METHODS = {
  get: "media.get", // operator → core: fetch one attachment's bytes for scroll-back rendering
  clear: "media.clear", // operator → core: purge all retained attachment bytes on demand
  usage: "media.usage", // operator → core: cache-usage query (attachment + memory-text bytes); reserved for the M5 settings UI (D27)
} as const;

// `ref` is a workspace-relative attachment path; the core confines it with a strict whole-ref regex before any fs call.
export const MediaGetParamsSchema = z.object({ ref: z.string().min(1) });
export type MediaGetParams = z.infer<typeof MediaGetParamsSchema>;

export const MediaGetResultSchema = z.object({
  mediaType: z.enum(IMAGE_MEDIA_TYPES),
  dataBase64: z.string().min(1),
});
export type MediaGetResult = z.infer<typeof MediaGetResultSchema>;

export const MediaClearParamsSchema = z.object({});
export type MediaClearParams = z.infer<typeof MediaClearParamsSchema>;

export const MediaClearResultSchema = z.object({
  removedCount: z.int().min(0),
  freedBytes: z.int().min(0),
});
export type MediaClearResult = z.infer<typeof MediaClearResultSchema>;

export const MediaUsageParamsSchema = z.object({});
export type MediaUsageParams = z.infer<typeof MediaUsageParamsSchema>;

export const MediaUsageResultSchema = z.object({
  attachmentCount: z.int().min(0),
  attachmentBytes: z.int().min(0),
  memoryTextBytes: z.int().min(0),
});
export type MediaUsageResult = z.infer<typeof MediaUsageResultSchema>;
