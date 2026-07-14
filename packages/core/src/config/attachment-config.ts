/**
 * INPUT:  process env (TAKI_ATTACHMENT_TTL_DAYS)
 * OUTPUT: loadAttachmentConfig(env) -> { ttlDays, ttlMs }; default 14 days; garbage/zero/negative = fatal at boot
 * POS:    core/config — the user-editable image-retention TTL (D11-style); only raw bytes are GC'd, the description-memory never
 */
import { z } from "zod";

const DEFAULT_TTL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

// Env-var name IS the schema key so a fatal boot error names it. Coerce + int + positive: "abc"/"0"/"-1"/"3.5" all throw
// at boot (fail-closed — a garbage TTL must never silently disable expiry); absent falls back to the 14-day default.
export const AttachmentConfigSchema = z
  .object({
    TAKI_ATTACHMENT_TTL_DAYS: z.coerce.number().int().positive().default(DEFAULT_TTL_DAYS),
  })
  .transform((env) => ({
    ttlDays: env.TAKI_ATTACHMENT_TTL_DAYS,
    ttlMs: env.TAKI_ATTACHMENT_TTL_DAYS * DAY_MS,
  }));

export type AttachmentConfig = z.infer<typeof AttachmentConfigSchema>;

export function loadAttachmentConfig(env: Record<string, string | undefined>): AttachmentConfig {
  return AttachmentConfigSchema.parse({ TAKI_ATTACHMENT_TTL_DAYS: env.TAKI_ATTACHMENT_TTL_DAYS });
}
