/**
 * INPUT: native BiliNote exact-part resolution and bounded video-byte access evidence
 * OUTPUT: strict media-access result shared by URL analysis and viewing invitation adapters
 * POS: shared/protocol — access evidence is neither analysis completion nor Co-Watching consent
 */
import { z } from "zod";
import { BrowserMediaIdentitySchema } from "./browser-playback-schema.ts";

export const MediaAccessProbeResultSchema = z.strictObject({
  schema_version: z.literal("bilinote.media-access.v1"),
  service_instance_id: z.uuid(),
  source: z.strictObject({
    platform: z.literal("bilibili"),
    bvid: BrowserMediaIdentitySchema.shape.bvid,
    cid: BrowserMediaIdentitySchema.shape.cid,
    page: BrowserMediaIdentitySchema.shape.page,
    canonical_url: z.string().max(2048),
  }).refine((source) => source.canonical_url === `https://www.bilibili.com/video/${source.bvid}?p=${source.page}`,
    { message: "Canonical URL must identify the resolved Bilibili part" }),
  title: z.string().min(1).max(512),
  duration_seconds: z.number().nonnegative().nullable(),
  access: z.strictObject({
    kind: z.literal("video_range"),
    byte_length: z.int().positive(),
    checked_at: z.int().nonnegative(),
  }),
});
export type MediaAccessProbeResult = z.infer<typeof MediaAccessProbeResultSchema>;
