/**
 * INPUT:  effective ConfigSource environment for the dedicated Hindsight policy curator
 * OUTPUT: validated curator timeout/instructions and independent daily/interval review settings
 * POS:    core/config — model selection, report cap and step cap remain existing Utility/Memory settings
 */
import { z } from "zod";

export const DEFAULT_HINDSIGHT_POLICY_TIMEOUT_MS = 60_000;
export const DEFAULT_HINDSIGHT_POLICY_PROMPT = "";
export const DEFAULT_HINDSIGHT_POLICY_REVIEW_MODE = "daily";
export const DEFAULT_HINDSIGHT_POLICY_REVIEW_TIME = "03:00";
export const DEFAULT_HINDSIGHT_POLICY_REVIEW_INTERVAL_MS = 86_400_000;
export const DEFAULT_HINDSIGHT_POLICY_REVIEW_THRESHOLD = 100;
export const HINDSIGHT_POLICY_REVIEW_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const ReviewConfigSchema = z.object({
  mode: z.enum(["daily", "interval"]).default(DEFAULT_HINDSIGHT_POLICY_REVIEW_MODE),
  time: z.string().regex(HINDSIGHT_POLICY_REVIEW_TIME_PATTERN).default(DEFAULT_HINDSIGHT_POLICY_REVIEW_TIME),
  intervalMs: z.coerce.number().int().min(60_000).max(2_147_483_647).default(DEFAULT_HINDSIGHT_POLICY_REVIEW_INTERVAL_MS),
  threshold: z.coerce.number().int().min(1).max(2_147_483_647).default(DEFAULT_HINDSIGHT_POLICY_REVIEW_THRESHOLD),
});
export type HindsightPolicyReviewConfig = z.infer<typeof ReviewConfigSchema>;
export function loadHindsightPolicyReviewConfig(env: Record<string, string | undefined>): HindsightPolicyReviewConfig {
  return ReviewConfigSchema.parse({ mode: env.TAKI_HINDSIGHT_POLICY_REVIEW_MODE || undefined,
    time: env.TAKI_HINDSIGHT_POLICY_REVIEW_TIME || undefined,
    intervalMs: env.TAKI_HINDSIGHT_POLICY_REVIEW_INTERVAL_MS || undefined,
    threshold: env.TAKI_HINDSIGHT_POLICY_REVIEW_THRESHOLD || undefined });
}
export const HindsightPolicyConfigSchema = z.object({
  TAKI_HINDSIGHT_POLICY_TIMEOUT_MS: z.coerce.number().int().min(1).max(2_147_483_647).default(DEFAULT_HINDSIGHT_POLICY_TIMEOUT_MS),
  TAKI_HINDSIGHT_POLICY_PROMPT: z.string().default(DEFAULT_HINDSIGHT_POLICY_PROMPT),
}).transform((value) => ({ timeoutMs: value.TAKI_HINDSIGHT_POLICY_TIMEOUT_MS, prompt: value.TAKI_HINDSIGHT_POLICY_PROMPT }));
export type HindsightPolicyConfig = z.infer<typeof HindsightPolicyConfigSchema>;
export function loadHindsightPolicyConfig(env: Record<string, string | undefined>): HindsightPolicyConfig {
  return HindsightPolicyConfigSchema.parse({
    TAKI_HINDSIGHT_POLICY_TIMEOUT_MS: env.TAKI_HINDSIGHT_POLICY_TIMEOUT_MS || undefined,
    TAKI_HINDSIGHT_POLICY_PROMPT: env.TAKI_HINDSIGHT_POLICY_PROMPT,
  });
}
